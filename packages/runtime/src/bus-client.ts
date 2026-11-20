/*
 * The isolate's bus client (design §5, §6.3, ADR 0007). Talks to the bus
 * worker over the port from `init`, never through the main thread (ADR 0005).
 *
 * - `publish` resolves on the broker's `result`, or rejects with a `BusError`.
 * - `subscribe` runs handlers one record at a time, in order. With
 *   `autoCommit` (default) a record counts as settled once its handler
 *   returns, so delivery is at least once. A handler that throws stops the
 *   subscription's commits: the record and those after it are redelivered on
 *   the next start.
 * - Settled offsets go out together, one `commits` per commit interval, or
 *   earlier at half a subscription's credit and on `close` (ADR 0016,
 *   decision 1). A crash can redeliver up to one interval of records. Each
 *   entry carries the delivery `seq` settled whole so far, so a group
 *   commit can't cover a record redelivered to this member after it
 *   (ADR 0016, points 10–12), and how many records of the next delivery
 *   are settled, so a crash partway through a delivery keeps them (point
 *   17). Records settle in the order they arrived: a commit by hand settles
 *   that record and every one delivered before it.
 * - On `reattach` (a bus restart) it swaps the port, drops the commits still
 *   pending (the new broker would reject them before the subscriptions, so a
 *   persistent topic redelivers up to one interval, as after a crash; ADR
 *   0016, decision point 3), sends every subscription again and re-sends
 *   every publish the old bus never answered, in order.
 *   Each publish and request carries `(epoch, seq)`, so a persistent topic
 *   doesn't append a re-send the old bus already wrote (ADR 0007, step 5).
 */
import {
  BusError,
  createCommitter,
  deliveryPoints,
  isBusToIsolate,
  type BusRecord,
  type BusToIsolate,
  type CallResult,
  type CommitPoint,
  type IsolateToBus,
  type StartPosition,
  type TopicRef,
  type TypedRecord,
} from '@isoloop/protocol';

/** `bus.request`'s options. @experimental */
export type RequestOptions = {
  /** The request record's key. Default: none. */
  key?: string;
  /** How long to wait for a reply, in ms; the call then rejects with `BusError('timeout')`. Default 30 000 (30 s). */
  timeoutMs?: number;
};

/** `bus.subscribe`'s options. */
export type SubscribeOptions = {
  /**
   * Where to start. Default `latest`. With `group`, it applies only while the
   * group has no committed offset: a group that has committed resumes after
   * it, and a member joining a group that has members takes records from
   * where the group is.
   */
  from?: StartPosition;
  /** Share the topic with other subscribers of the same group: each record goes to one of them. Default: none. @experimental */
  group?: string;
  /** Commit each record once its handler settles. Default true. @experimental */
  autoCommit?: boolean;
  /**
   * A bus restart lost this memory topic. Clear what was built from it;
   * records from the new bus follow. Default: none.
   */
  onReset?: () => void;
  /**
   * Records in `[from, to]` were dropped by retention before they reached
   * this subscription, for example while the isolate was suspended. Default: none.
   */
  onGap?: (gap: { from: number; to: number }) => void;
};

/** An isolate's side of the bus: `ctx.bus`, on its own port to the bus worker. */
export interface BusClient {
  /**
   * Appends a record to a topic.
   * @param topic The topic, from the contracts.
   * @param rec The record's `value`, and its `key` if any.
   * @returns Resolves once the broker has appended the record.
   * @throws Rejects with a `BusError`, for example `forbidden` without a
   *   publish grant, `invalid` when the value fails the schema, or
   *   `bus_unavailable` while 1,000 calls wait for an answer.
   */
  publish<In>(topic: TopicRef<In, any, any, any>, rec: { key?: string; value: In }): Promise<void>;
  /**
   * Delivers a topic's records to `fn`, one at a time, in order: the next
   * waits until `fn`'s promise settles. One subscription per topic:
   * subscribing again replaces the last one.
   * @param topic The topic, from the contracts.
   * @param fn Called with each record.
   * @param opts Where to start, the group, and the reset and gap handlers.
   * @returns The function that unsubscribes.
   */
  subscribe<Out>(
    topic: TopicRef<any, Out, any, any>,
    fn: (r: TypedRecord<Out>) => void | Promise<void>,
    opts?: SubscribeOptions,
  ): () => void;
  /**
   * Appends a request record to a topic with a `reply` schema and waits for
   * the first valid reply.
   * @param topic A topic with a `reply` schema.
   * @param value The request's value, checked against the topic's schema.
   * @param opts The key and the timeout.
   * @returns The reply's value, checked against the `reply` schema.
   * @throws Rejects with a `BusError`: `timeout` after `timeoutMs` (default
   *   30 s); `dropped` at once when the topic's retention removed the request
   *   before the bus delivered it to any subscriber; `not_requestable`,
   *   `forbidden`, `invalid` or `reply_invalid` from the broker.
   * @experimental
   */
  request<In, ROut>(
    topic: TopicRef<In, any, any, ROut>,
    value: In,
    opts?: RequestOptions,
  ): Promise<ROut>;
  /**
   * Answers a request record delivered to this isolate.
   * @param record The request, as the subscription delivered it.
   * @param value The answer; the broker checks it against the topic's `reply` schema.
   * @returns Resolves once the broker has the reply.
   * @throws `Error` for a record not delivered to this isolate; rejects with a
   *   `BusError` (`reply_invalid`, …) from the broker.
   * @experimental
   */
  reply(record: TypedRecord<unknown>, value: unknown): Promise<void>;
  /**
   * Commits a record by hand, for `autoCommit: false`: that record and every
   * one delivered before it on its subscription count as settled.
   * @param record A record this isolate's subscription delivered.
   * @throws `Error` for a record not delivered to this isolate.
   * @experimental
   */
  commit(record: TypedRecord<unknown>): void;
}

export type BusClientOptions = {
  /** Unanswered publishes and requests before new ones reject with `bus_unavailable`. Default 1,000. */
  inboxLimit?: number;
  /** A handler threw: reported to the host as a non-fatal error. */
  onError?: (err: unknown) => void;
  /**
   * Woken from suspension (ADR 0001): `latest` subscriptions start from
   * `committed`, so the isolate replays what it missed while asleep.
   */
  wake?: boolean;
  now?: () => number;
  /** This instance's `epoch` for publish ids. Default: random, new per client. */
  epoch?: number;
  /** `KernelConfig.bus.commitIntervalMs`: 0 is every task. Default 100. */
  commitIntervalMs?: number;
  /** The broker's credit per subscription; commits go out early at half of it. Default 1,000. */
  credit?: number;
};

/** A random epoch: a new isolate instance, so a new one per client. */
const randomEpoch = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

const check = (r: CallResult): void => {
  if (!r.ok) throw new BusError(r.error);
};

/** Default request timeout, the broker's too. */
const REQUEST_TIMEOUT_MS = 30_000;

type Pending = {
  msg: IsolateToBus & { id: string };
  settle: (r: CallResult) => void;
};

type Sub = {
  topic: string;
  fn: (r: BusRecord) => void | Promise<void>;
  opts: SubscribeOptions;
  /** Records waiting for their handler, in order. */
  queue: BusRecord[];
  running: boolean;
  /** A handler threw: no more commits until the isolate restarts. */
  stuck: boolean;
  /** The highest offset delivered on this subscription and port, `-1` before any. */
  highest: number;
};

/** What a delivered record settles, and where it came from. */
type Delivered = {
  topic: string;
  sub: Sub;
  /** The port it came on: a record from before a bus restart commits nothing. */
  port: number;
  at: CommitPoint;
};

export type BusClientHandle = {
  client: BusClient;
  /** For the idle report: time since the last delivery, and calls waiting for an answer. */
  idle(): { sinceDeliveryMs: number; inFlight: number };
  /** Swaps to a new bus port after a bus restart. */
  reattach(port: MessagePort): void;
  /**
   * Sends pending commits and stops the commit timer: shutdown, for every
   * reason. Resolves once the broker has them, so the host's `detach`, which
   * reaches the bus on another channel, can't overtake them.
   */
  close(): Promise<void>;
};

export function createBusClient(first: MessagePort, o: BusClientOptions = {}): BusClientHandle {
  const limit = o.inboxLimit ?? 1000;
  const now = o.now ?? (() => performance.now());
  let lastDelivery = now();
  let port = first;
  let nextId = 0;
  const epoch = o.epoch ?? randomEpoch();
  /** Publishes and requests sent by this instance: the `seq` of publish ids. */
  let seq = 0;
  const pending = new Map<string, Pending>();
  const subs = new Map<string, Sub>();
  /** Where each delivered record came from and what it settles, for `reply` and `commit`. */
  const delivered = new WeakMap<object, Delivered>();
  /** Counts bus ports: a new one after each bus restart. */
  let ports = 0;

  const send = (msg: IsolateToBus): void => {
    port.postMessage(msg);
  };

  const call = (msg: IsolateToBus): Promise<CallResult> => {
    if (pending.size >= limit) {
      return Promise.resolve({
        ok: false,
        error: { code: 'bus_unavailable', message: 'Too many bus calls waiting for an answer' },
      });
    }
    const id = `b${++nextId}`;
    return new Promise((settle) => {
      const withId = { ...msg, id };
      pending.set(id, { msg: withId, settle });
      send(withId);
    });
  };

  const committer = createCommitter({
    send: (offsets) => {
      send({ v: 1, t: 'commits', p: { offsets } });
    },
    ...(o.commitIntervalMs === undefined ? {} : { intervalMs: o.commitIntervalMs }),
    ...(o.credit === undefined ? {} : { credit: o.credit }),
  });
  /**
   * Settles a record, and with it every record delivered before it on its
   * subscription. One from a replaced subscription or an old port is
   * dropped: its delivery `seq` means nothing to the broker now.
   */
  const commit = (d: Delivered): void => {
    if (subs.get(d.topic) !== d.sub || d.port !== ports) return;
    committer.settle(d.topic, d.at);
  };

  const drain = async (sub: Sub): Promise<void> => {
    if (sub.running) return;
    sub.running = true;
    while (sub.queue.length > 0 && subs.get(sub.topic) === sub) {
      const r = sub.queue.shift();
      if (!r) break;
      try {
        const done = sub.fn(r);
        // A synchronous handler settles in the same microtask: awaiting its
        // plain return value would yield once per record for nothing.
        // oxlint-disable-next-line no-await-in-loop -- one record at a time, in order, by design
        if (isThenable(done)) await done;
      } catch (err) {
        sub.stuck = true;
        o.onError?.(err);
      }
      const d = delivered.get(r);
      if (sub.opts.autoCommit !== false && !sub.stuck && d) commit(d);
    }
    sub.running = false;
  };

  const sendSubscribe = (sub: Sub): void => {
    const p: Extract<IsolateToBus, { t: 'subscribe' }>['p'] = {
      topic: sub.topic,
      from: sub.opts.from ?? 'latest',
    };
    if (o.wake && p.from === 'latest') p.from = 'committed';
    if (sub.opts.group !== undefined) p.group = sub.opts.group;
    void call({ v: 1, t: 'subscribe', p }).then((r) => {
      if (!r.ok) o.onError?.(new BusError(r.error));
    });
  };

  const receive = (msg: BusToIsolate): void => {
    switch (msg.t) {
      case 'result': {
        const p = msg.re === undefined ? undefined : pending.get(msg.re);
        if (!p || msg.re === undefined) return;
        pending.delete(msg.re);
        p.settle(msg.p);
        return;
      }
      case 'deliver': {
        const sub = subs.get(msg.p.topic);
        if (!sub) return;
        lastDelivery = now();
        const { gap } = msg.p;
        if (gap) {
          try {
            sub.opts.onGap?.(gap);
          } catch (err) {
            o.onError?.(err);
          }
        }
        const { records } = msg.p;
        const points = deliveryPoints(
          msg.p.seq,
          records.map((r) => r.offset),
          sub.highest,
        );
        records.forEach((r, i) => {
          const at = points[i];
          if (at) delivered.set(r, { topic: sub.topic, sub, port: ports, at });
        });
        sub.highest = points.at(-1)?.offset ?? sub.highest;
        sub.queue.push(...records);
        void drain(sub);
        return;
      }
      case 'reset': {
        const sub = subs.get(msg.p.topic);
        if (!sub) return;
        sub.queue.length = 0;
        sub.highest = -1;
        // Offsets from the lost log mean nothing in the new one.
        committer.drop(msg.p.topic);
        try {
          sub.opts.onReset?.();
        } catch (err) {
          o.onError?.(err);
        }
        return;
      }
      default: {
        const never: never = msg;
        return never;
      }
    }
  };

  const listen = (p: MessagePort): void => {
    p.addEventListener('message', (e: MessageEvent<unknown>) => {
      if (port === p && isBusToIsolate(e.data)) receive(e.data);
    });
    p.start();
  };
  listen(first);

  const client: BusClient = {
    async publish(topic, rec) {
      const p: Extract<IsolateToBus, { t: 'publish' }>['p'] = {
        topic: topic.name,
        value: rec.value,
        epoch,
        seq: ++seq,
      };
      if (rec.key !== undefined) p.key = rec.key;
      check(await call({ v: 1, t: 'publish', p }));
    },

    subscribe(topic, fn, opts = {}) {
      subs.get(topic.name)?.queue.splice(0);
      const sub: Sub = {
        topic: topic.name,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the broker validated every record against the topic's schema
        fn: fn as (r: BusRecord) => void | Promise<void>,
        opts,
        queue: [],
        running: false,
        stuck: false,
        highest: -1,
      };
      subs.set(topic.name, sub);
      sendSubscribe(sub);
      return () => {
        if (subs.get(topic.name) !== sub) return;
        subs.delete(topic.name);
        // What it settled still counts: committed before it leaves.
        committer.flush();
        send({ v: 1, t: 'unsubscribe', p: { topic: topic.name } });
      };
    },

    async request(topic, value, opts = {}) {
      const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
      const p: Extract<IsolateToBus, { t: 'request' }>['p'] = {
        topic: topic.name,
        value,
        timeoutMs,
        epoch,
        seq: ++seq,
      };
      if (opts.key !== undefined) p.key = opts.key;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<CallResult>((resolve) => {
        timer = setTimeout(() => {
          resolve({
            ok: false,
            error: { code: 'timeout', message: `No reply on ${topic.name} within ${timeoutMs} ms` },
          });
        }, timeoutMs);
      });
      const r = await Promise.race([call({ v: 1, t: 'request', p }), timeout]);
      clearTimeout(timer);
      check(r);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the broker validated the reply against the topic's reply schema
      return (r as { value: unknown }).value as never;
    },

    async reply(record, value) {
      const topic = delivered.get(record)?.topic;
      if (topic === undefined)
        throw new Error('reply: this record was not delivered to this isolate');
      check(await call({ v: 1, t: 'reply', p: { topic, offset: record.offset, value } }));
    },

    commit(record) {
      const d = delivered.get(record);
      if (d === undefined) throw new Error('commit: this record was not delivered to this isolate');
      commit(d);
    },
  };

  return {
    client,
    idle: () => ({ sinceDeliveryMs: now() - lastDelivery, inFlight: pending.size }),
    reattach(next) {
      const old = port;
      port = next;
      ports++;
      old.close();
      listen(next);
      const unanswered = [...pending.values()];
      for (const p of unanswered) {
        if (p.msg.t !== 'subscribe') continue;
        // Superseded by the subscribe sent below.
        pending.delete(p.msg.id);
        p.settle({ ok: true, value: null });
      }
      // Pending commits are dropped, not sent: the new broker accepts a
      // commit only for a topic this connection subscribes to, and these
      // would arrive first. A persistent topic redelivers up to one interval
      // instead, the same window as after a crash (ADR 0016, decision point
      // 3). Then subscriptions, then everything the old bus never answered,
      // in the order it was sent. Its memory log is gone, so nothing
      // duplicates there; a persistent topic answers what it already holds
      // by its id.
      committer.take();
      for (const sub of subs.values()) {
        sub.queue.length = 0;
        // A new connection numbers its deliveries from 1 again (ADR 0016, point 13).
        sub.highest = -1;
        sendSubscribe(sub);
      }
      for (const p of unanswered) if (p.msg.t !== 'subscribe') send(p.msg);
    },
    async close() {
      const offsets = committer.take();
      committer.dispose();
      if (offsets) await call({ v: 1, t: 'commits', p: { offsets } });
    },
  };
}

function isThenable(x: unknown): x is PromiseLike<unknown> {
  return (
    (typeof x === 'object' || typeof x === 'function') &&
    x !== null &&
    typeof (x as { then?: unknown }).then === 'function'
  );
}
