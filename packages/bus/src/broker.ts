import { CodecError, encode } from '@isoloop/codec';
import {
  SYSTEM_TOPICS,
  isIsolateToBus,
  isSystemTopic,
  matchAny,
  type BusRecord,
  type BusToIsolate,
  type CallError,
  type CallResult,
  type ErrorCode,
  type Grants,
  type IsolateToBus,
  type StartPosition,
} from '@isoloop/protocol';
import type { LogEngine, NewRecord } from './engine/types';
import { estimateSize } from './size';
import { toIssues, type StandardSchemaV1 } from './standard-schema';
import { DEFAULT_MAX_RECORD_BYTES, topicConfig, type AnyTopicDef, type Contracts } from './topic';

/**
 * One isolate's bus connection, as the broker sees it. The bus worker wraps a
 * `MessagePort`; tests use in-memory ports.
 */
export interface BusPort {
  post(msg: BusToIsolate): void;
  /** Sets the handler for messages from the isolate. */
  onMessage(handler: (msg: unknown) => void): void;
  close(): void;
}

/** Timer functions, injectable for tests. */
export type Timers = {
  set(fn: () => void, ms: number): void;
};

export type BrokerOptions = {
  contracts: Contracts;
  engine: LogEngine;
  /** Default `Date.now`. Stamps `ts` on every record. */
  now?: () => number;
  /**
   * Dev builds check that every validated output survives `structuredClone`
   * (ADR 0003, decision 11). Off in production.
   */
  dev?: boolean;
  /** Records delivered per `deliver` message. Default 64. */
  batchSize?: number;
  /**
   * Credit per subscription: records delivered and not yet committed before
   * delivery pauses (design §6.3). Default 1,000.
   */
  inboxLimit?: number;
  /** Built-in `isoloop.*` topics. Default `SYSTEM_TOPICS` from `@isoloop/protocol`. */
  systemTopics?: readonly AnyTopicDef[];
  /** Default `setTimeout`. Used to forget requests after their timeout. */
  timers?: Timers;
  /**
   * True for topics whose log survived a bus restart. Default: the engine's
   * `durable`, persistent topics on storage that keeps them. A reattached
   * isolate subscribing to any other topic gets `reset` first (ADR 0007).
   */
  durable?: (topic: string) => boolean;
  /**
   * A record arrived on a topic a suspended isolate subscribed to (ADR 0001).
   * The bus worker sends `wake` on the control port. Called once per sleep.
   */
  onWake?: (isolateId: string, topic: string) => void;
};

/** Who is publishing: an isolate (grants apply), the host (`kernel.publish`), or the kernel itself (system topics). */
export type Publisher =
  | { kind: 'isolate'; isolateId: string }
  | { kind: 'host' }
  | { kind: 'kernel' };

type Topic = {
  def: AnyTopicDef;
  maxBytes: number;
  queue: Pending[];
  /** Records appended since the broker started, and their estimated bytes. */
  records: number;
  bytes: number;
};

/** Cumulative counters for metrics (design §6.3); the bus worker turns them into rates. */
export type BrokerStats = {
  topics: { topic: string; records: number; bytes: number }[];
  /** `lag` is `head − cursor`: records not yet delivered. */
  subscriptions: { consumer: string; topic: string; lag: number; credit: number }[];
  /** Rejected publishes and requests, by error code. */
  rejected: Partial<Record<ErrorCode, number>>;
};

type Validated = StandardSchemaV1.Result<unknown> | { thrown: unknown };

/** A publish waiting for its (possibly async) validation, in publish order per topic. */
type Pending = {
  producer: string;
  /** Estimated size of the published value. */
  bytes: number;
  key: string | undefined;
  req: { from: Connection; id: string; timeoutMs: number } | undefined;
  done: boolean;
  result: Validated | undefined;
  settle: (r: CallResult) => void;
};

/** A request record waiting for its first valid reply (design §6.3). */
type Request = {
  caller: Connection;
  id: string;
  /** Isolates the record was delivered to: only they may reply. */
  recipients: Set<string>;
  done: boolean;
};

/** One isolate's subscription to one topic, on its own or as a group member. */
type Subscription = {
  conn: Connection;
  topic: string;
  group: Group | undefined;
  /** Next offset to read from the log (own subscriptions; a group keeps its own). */
  cursor: number;
  /** Records that may still be delivered before the next commit. */
  credit: number;
  /** Offsets delivered to this isolate and not yet committed, ascending. */
  unacked: number[];
  /** A pump is queued for the next microtask. */
  scheduled: boolean;
};

/**
 * Subscribers sharing a group name on a topic: each record goes to one
 * member, by hash of key (round-robin when keyless), so per-key order holds
 * while membership is stable. Offsets belong to the group.
 */
type Group = {
  topic: string;
  name: string;
  consumer: string;
  cursor: number;
  /** Sorted by isolate id, so the key → member mapping is deterministic. */
  members: Subscription[];
  rr: number;
  /** Delivered and not yet committed, ascending. `member` is unset while waiting for redelivery. */
  unacked: { offset: number; member: Subscription | undefined }[];
  /** Offsets a departed member left uncommitted, delivered again before anything new. */
  redeliver: number[];
  scheduled: boolean;
};

type Connection = {
  isolateId: string;
  grants: Grants;
  port: BusPort;
  subs: Map<string, Subscription>;
  /** Set when attached after a bus restart: memory topics not yet reset on this connection. */
  reset: Set<string> | undefined;
};

const fail = (code: ErrorCode, message: string, extra?: Partial<CallError>): CallResult => ({
  ok: false,
  error: { code, message, ...extra },
});

const isStartPosition = (x: unknown): x is StartPosition =>
  x === 'latest' || x === 'earliest' || x === 'committed';

const hasTopic = (p: unknown): boolean =>
  typeof p === 'object' && p !== null && 'topic' in p && typeof p.topic === 'string';

const isOffset = (x: unknown): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= 0;

/** FNV-1a: a small, stable string hash for key → group member. */
function hash(s: string): number {
  let h = 0x81_1c_9d_c5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01_00_01_93);
  }
  return h >>> 0;
}

const reqKey = (topic: string, offset: number): string => `${topic}\u0000${offset}`;

/** Producer id for records the host publishes through `kernel.publish`. */
export const HOST_PRODUCER = 'host';
/** Producer id for records the kernel publishes to system topics. */
export const KERNEL_PRODUCER = 'kernel';
/** Requests are forgotten after this long when the caller gives no timeout. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * The bus core (design §6.3): runs the publish pipeline, keeps subscriptions
 * and consumer groups, delivers from the log under credit, and routes
 * request replies. Knows nothing about workers; the bus worker entry wires
 * ports to it.
 */
export class Broker {
  readonly #engine: LogEngine;
  readonly #now: () => number;
  readonly #dev: boolean;
  readonly #batch: number;
  readonly #inboxLimit: number;
  readonly #timers: Timers;
  readonly #durable: (topic: string) => boolean;
  #storageFull = false;
  readonly #topics = new Map<string, Topic>();
  readonly #conns = new Map<string, Connection>();
  readonly #groups = new Map<string, Group>();
  readonly #requests = new Map<string, Request>();
  /** Consumers whose offsets were dropped by `detach { keepOffsets: false }`, per topic. */
  readonly #forgotten = new Set<string>();
  readonly #rejected: Partial<Record<ErrorCode, number>> = {};
  /** Suspended isolates by topic: who to wake when a record arrives there. */
  readonly #sleepers = new Map<string, Set<string>>();
  readonly #onWake: (isolateId: string, topic: string) => void;
  #dropped = 0;

  constructor(opts: BrokerOptions) {
    this.#engine = opts.engine;
    this.#now = opts.now ?? Date.now;
    this.#dev = opts.dev ?? false;
    this.#batch = opts.batchSize ?? 64;
    this.#inboxLimit = opts.inboxLimit ?? 1000;
    this.#timers = opts.timers ?? { set: (fn, ms) => void setTimeout(fn, ms) };
    this.#durable = opts.durable ?? ((topic) => this.#engine.durable(topic));
    this.#onWake = opts.onWake ?? (() => {});
    for (const def of [...(opts.systemTopics ?? SYSTEM_TOPICS), ...opts.contracts.topics]) {
      this.#engine.createTopic(topicConfig(def));
      this.#topics.set(def.name, {
        def,
        maxBytes: def.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES,
        queue: [],
        records: 0,
        bytes: 0,
      });
    }
  }

  #sleep(topic: string, isolateId: string): void {
    let set = this.#sleepers.get(topic);
    if (!set) this.#sleepers.set(topic, (set = new Set()));
    set.add(isolateId);
  }

  #unsleep(isolateId: string): void {
    for (const set of this.#sleepers.values()) set.delete(isolateId);
  }

  /** Wakes every isolate sleeping on `topic`, once. */
  #wake(topic: string): void {
    const set = this.#sleepers.get(topic);
    if (!set || set.size === 0) return;
    for (const id of set) {
      this.#unsleep(id);
      this.#onWake(id, topic);
    }
  }

  /** Messages dropped as malformed or unknown (design §3: dropped and counted). */
  get dropped(): number {
    return this.#dropped;
  }

  /** Counters for the 1 s metrics sample. */
  stats(): BrokerStats {
    const subscriptions: BrokerStats['subscriptions'] = [];
    const groups = new Set<Group>();
    for (const conn of this.#conns.values()) {
      for (const sub of conn.subs.values()) {
        const head = this.#engine.head(sub.topic);
        const g = sub.group;
        if (g) {
          if (groups.has(g)) continue;
          groups.add(g);
          const credit = g.members.reduce((n, m) => n + m.credit, 0);
          subscriptions.push({
            consumer: g.consumer,
            topic: g.topic,
            lag: head - g.cursor,
            credit,
          });
          continue;
        }
        subscriptions.push({
          consumer: conn.isolateId,
          topic: sub.topic,
          lag: head - sub.cursor,
          credit: sub.credit,
        });
      }
    }
    return {
      topics: [...this.#topics].map(([topic, t]) => ({
        topic,
        records: t.records,
        bytes: t.bytes,
      })),
      subscriptions,
      rejected: { ...this.#rejected },
    };
  }

  /**
   * The origin's storage is full (M2b task 14): publishes to persistent
   * topics reject with `quota_exceeded`, memory topics carry on.
   */
  setStorageFull(full: boolean): void {
    this.#storageFull = full;
  }

  /**
   * Writes what persistent topics have pending at once: the page is freezing
   * or going away (ADR 0001, what the browser still controls).
   */
  flush(): Promise<void> {
    return this.#engine.flush({ now: true });
  }

  /** Retention pass over every topic (`time` and `compacted`); the bus worker runs it every second. */
  compact(): void {
    for (const name of this.#topics.keys()) this.#engine.compact(name);
  }

  /**
   * Connects an isolate. A second attach for the same id replaces the first.
   * With `reattach`, the isolate was connected to a bus that restarted: its
   * first subscribe to each memory topic is answered with `reset` (ADR 0007).
   */
  attach(
    isolateId: string,
    grants: Grants,
    port: BusPort,
    opts: { reattach?: boolean } = {},
  ): void {
    this.detach(isolateId, true);
    const conn: Connection = {
      isolateId,
      grants,
      port,
      subs: new Map(),
      reset: opts.reattach ? new Set() : undefined,
    };
    this.#conns.set(isolateId, conn);
    port.onMessage((msg) => {
      if (this.#conns.get(isolateId) === conn) this.#receive(conn, msg);
    });
  }

  /**
   * Disconnects an isolate, drops its subscriptions and leaves its groups,
   * which rebalance. With `keepOffsets` its commits stay, so a restart with
   * `from: 'committed'` resumes (I6). Replies to its pending requests are dropped.
   */
  detach(isolateId: string, keepOffsets: boolean, opts: { wake?: boolean } = {}): void {
    if (!opts.wake) this.#unsleep(isolateId);
    const conn = this.#conns.get(isolateId);
    if (!conn) return;
    this.#conns.delete(isolateId);
    for (const sub of conn.subs.values()) {
      // A suspended isolate is woken by records on its own subscriptions, and
      // on a group's only when nobody else is left to take them (ADR 0001).
      const g = sub.group;
      if (opts.wake && (!g || g.members.length === 1)) this.#sleep(sub.topic, isolateId);
      this.#leave(sub);
    }
    conn.subs.clear();
    if (!keepOffsets) {
      for (const name of this.#topics.keys()) this.#forgotten.add(`${name}\u0000${isolateId}`);
    }
    conn.port.close();
  }

  /**
   * Publishes for the host (`kernel.publish`) or the kernel (system topics).
   * The host can't publish system topics; the kernel can only publish them.
   */
  publish(
    from: Publisher,
    topic: string,
    key: string | undefined,
    value: unknown,
  ): Promise<CallResult> {
    return new Promise((resolve) => this.#publish(from, topic, key, value, undefined, resolve));
  }

  #receive(conn: Connection, msg: unknown): void {
    if (!isIsolateToBus(msg) || !hasTopic(msg.p)) {
      this.#dropped++;
      return;
    }
    const reply = (r: CallResult): void => {
      if (msg.id !== undefined) conn.port.post({ v: 1, t: 'result', re: msg.id, p: r });
    };
    this.#handle(conn, msg, reply);
  }

  #handle(conn: Connection, msg: IsolateToBus, reply: (r: CallResult) => void): void {
    const self: Publisher = { kind: 'isolate', isolateId: conn.isolateId };
    switch (msg.t) {
      case 'publish': {
        const key: unknown = msg.p.key;
        if (key !== undefined && typeof key !== 'string') {
          reply(fail('invalid', 'key must be a string'));
          return;
        }
        this.#publish(self, msg.p.topic, key, msg.p.value, undefined, reply);
        return;
      }
      case 'request': {
        const { id } = msg;
        const key: unknown = msg.p.key;
        const timeoutMs: unknown = msg.p.timeoutMs;
        if (id === undefined) {
          this.#dropped++; // nowhere to send the answer
          return;
        }
        if (key !== undefined && typeof key !== 'string') {
          reply(fail('invalid', 'key must be a string'));
          return;
        }
        const ms =
          typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS;
        // Only failures answer the request here; success is the reply.
        const onFail = (r: CallResult): void => {
          if (!r.ok) reply(r);
        };
        this.#publish(
          self,
          msg.p.topic,
          key,
          msg.p.value,
          { from: conn, id, timeoutMs: ms },
          onFail,
        );
        return;
      }
      case 'reply':
        this.#reply(conn, msg.p.topic, msg.p.offset, msg.p.value, reply);
        return;
      case 'subscribe':
        reply(this.#subscribe(conn, msg.p.topic, msg.p.from, msg.p.group));
        return;
      case 'unsubscribe': {
        const sub = conn.subs.get(msg.p.topic);
        if (sub) this.#leave(sub);
        conn.subs.delete(msg.p.topic);
        reply({ ok: true, value: null });
        return;
      }
      case 'commit':
        reply(this.#commit(conn, msg.p.topic, msg.p.offset));
        return;
      default: {
        const never: never = msg;
        this.#dropped++;
        return never;
      }
    }
  }

  // Publish pipeline (design §6.3): ACL, topic, size, schema, append, reply, fan-out.
  #publish(
    from: Publisher,
    name: string,
    key: string | undefined,
    value: unknown,
    req: Pending['req'],
    done: (r: CallResult) => void,
  ): void {
    const settle = (r: CallResult): void => {
      if (!r.ok) this.#rejected[r.error.code] = (this.#rejected[r.error.code] ?? 0) + 1;
      done(r);
    };
    const system = isSystemTopic(name);
    if (from.kind === 'kernel' ? !system : system) {
      settle(fail('forbidden', `${from.kind} may not publish to ${name}`));
      return;
    }
    if (from.kind === 'isolate') {
      const conn = this.#conns.get(from.isolateId);
      if (!conn || !matchAny(conn.grants.publish, name)) {
        settle(fail('forbidden', `no publish grant for ${name}`));
        return;
      }
    }
    const topic = this.#topics.get(name);
    if (!topic) {
      settle(fail('unknown_topic', `unknown topic ${name}`));
      return;
    }
    if (req && !topic.def.reply) {
      settle(fail('not_requestable', `${name} has no reply schema`));
      return;
    }
    const bytes = estimateSize(value, topic.maxBytes);
    if (bytes > topic.maxBytes) {
      settle(fail('too_large', `record is over ${topic.maxBytes} bytes`));
      return;
    }

    const pending: Pending = {
      bytes,
      producer:
        from.kind === 'isolate'
          ? from.isolateId
          : from.kind === 'host'
            ? HOST_PRODUCER
            : KERNEL_PRODUCER,
      key,
      req,
      done: false,
      result: undefined,
      settle,
    };
    const result = validate(topic.def.schema, value);
    if (!(result instanceof Promise) && topic.queue.length === 0) {
      // Fast path: nothing ahead of this publish on the topic.
      pending.result = result;
      this.#finish(name, topic, pending);
      return;
    }
    topic.queue.push(pending);
    void Promise.resolve(result).then((r) => {
      pending.result = r;
      pending.done = true;
      this.#drain(name, topic);
    });
  }

  /** Finishes queued publishes in order, stopping at the first still validating. */
  #drain(name: string, topic: Topic): void {
    while (topic.queue[0]?.done) {
      const next = topic.queue.shift();
      if (next) this.#finish(name, topic, next);
    }
  }

  #finish(name: string, topic: Topic, p: Pending): void {
    const checked = this.#check(name, p.result, topic.def.durability === 'persistent');
    if (!checked.ok) {
      p.settle(checked);
      return;
    }
    if (this.#storageFull && this.#engine.durable(name)) {
      p.settle(fail('quota_exceeded', `${name}: the origin's storage is full`));
      return;
    }
    let rec: NewRecord = { value: checked.value, ts: this.#now(), producer: p.producer };
    if (p.key !== undefined) rec = { ...rec, key: p.key };
    if (p.req) rec = { ...rec, req: { from: p.req.from.isolateId, id: p.req.id } };
    const offset = this.#engine.append(name, rec);
    topic.records++;
    topic.bytes += p.bytes;
    if (p.req) this.#openRequest(name, offset, p.req);
    if (this.#engine.durable(name)) {
      // Acknowledged once its batch is on disk (ADR 0007, decision 2).
      this.#engine.flush().then(
        () => p.settle({ ok: true, value: { offset } }),
        (e: unknown) =>
          p.settle(
            e instanceof DOMException && e.name === 'QuotaExceededError'
              ? fail('quota_exceeded', `${name}: the origin's storage is full`)
              : fail('bus_unavailable', `${name}: write failed: ${String(e)}`),
          ),
      );
    } else p.settle({ ok: true, value: { offset } });
    this.#fanOut(name);
    this.#wake(name);
  }

  /**
   * Turns a schema result into the value to store, or the error to send. A
   * persistent topic's value must also encode (ADR 0007, consequences).
   */
  #check(name: string, r: Validated | undefined, persistent = false): CallResult {
    if (!r || 'thrown' in r) {
      const thrown = r ? String(r.thrown) : 'no result';
      return fail('invalid', `schema threw: ${thrown}`, {
        issues: [{ message: thrown, path: [] }],
      });
    }
    if (r.issues)
      return fail('invalid', `invalid value for ${name}`, { issues: toIssues(r.issues) });
    if (persistent) {
      try {
        encode(r.value);
      } catch (e) {
        if (e instanceof CodecError) return fail('not_encodable', `${name}: ${e.message}`);
        throw e;
      }
    } else if (this.#dev) {
      try {
        structuredClone(r.value);
      } catch (e) {
        return fail('not_encodable', `schema output can't be cloned: ${String(e)}`);
      }
    }
    return { ok: true, value: r.value };
  }

  // Request/response (design §6.3, ADR 0003 decisions 15–16).

  #openRequest(topic: string, offset: number, req: NonNullable<Pending['req']>): void {
    const key = reqKey(topic, offset);
    // Kept after the first reply until the timeout, so later replies get already_replied.
    this.#timers.set(() => this.#requests.delete(key), req.timeoutMs);
    this.#requests.set(key, {
      caller: req.from,
      id: req.id,
      recipients: new Set(),
      done: false,
    });
  }

  #reply(
    conn: Connection,
    name: string,
    offset: unknown,
    value: unknown,
    settle: (r: CallResult) => void,
  ): void {
    const topic = this.#topics.get(name);
    if (!topic) return settle(fail('unknown_topic', `unknown topic ${name}`));
    const schema = topic.def.reply;
    if (!schema) return settle(fail('not_requestable', `${name} has no reply schema`));
    if (!isOffset(offset)) return settle(fail('invalid', 'offset must be a non-negative integer'));
    const req = this.#requests.get(reqKey(name, offset));
    if (!req) {
      const rec = this.#engine.read(name, offset, 1)[0];
      return settle(
        rec?.offset === offset && rec.req
          ? fail('timeout', `request ${name}@${offset} has expired`)
          : fail('invalid', `${name}@${offset} is not a request`),
      );
    }
    if (!req.recipients.has(conn.isolateId)) {
      return settle(fail('forbidden', `request ${name}@${offset} was not delivered to you`));
    }
    if (req.done) return settle(fail('already_replied', `request ${name}@${offset} has an answer`));
    if (estimateSize(value, topic.maxBytes) > topic.maxBytes) {
      return settle(fail('too_large', `reply is over ${topic.maxBytes} bytes`));
    }
    const answer = (r: Validated): void => {
      if (req.done)
        return settle(fail('already_replied', `request ${name}@${offset} has an answer`));
      req.done = true;
      const checked = this.#check(name, r);
      const callerAlive = this.#conns.get(req.caller.isolateId) === req.caller;
      if (!checked.ok) {
        settle(checked);
        if (callerAlive) {
          const issues = checked.error.issues;
          this.#post(
            req.caller,
            req.id,
            fail('reply_invalid', `invalid reply on ${name}`, issues ? { issues } : {}),
          );
        }
        return;
      }
      // A caller that died meanwhile gets nothing; the reply is dropped.
      if (callerAlive) this.#post(req.caller, req.id, checked);
      settle({ ok: true, value: { delivered: callerAlive } });
    };
    const result = validate(schema, value);
    if (result instanceof Promise) void result.then(answer);
    else answer(result);
  }

  #post(conn: Connection, re: string, r: CallResult): void {
    conn.port.post({ v: 1, t: 'result', re, p: r });
  }

  // Subscriptions, groups and commits.

  #subscribe(conn: Connection, name: string, from: unknown, group: unknown): CallResult {
    if (!isStartPosition(from)) {
      return fail('invalid', 'from must be latest, earliest or committed');
    }
    if (group !== undefined && (typeof group !== 'string' || group === '')) {
      return fail('invalid', 'group must be a non-empty string');
    }
    if (!isSystemTopic(name) && !matchAny(conn.grants.subscribe, name)) {
      return fail('forbidden', `no subscribe grant for ${name}`);
    }
    if (!this.#topics.has(name)) return fail('unknown_topic', `unknown topic ${name}`);
    if (conn.reset && !conn.reset.has(name) && !this.#durable(name)) {
      // Exactly one reset per memory topic per reattached connection (I11).
      conn.reset.add(name);
      conn.port.post({ v: 1, t: 'reset', p: { topic: name, reason: 'bus_restart' } });
    }
    const old = conn.subs.get(name);
    if (old) this.#leave(old);
    const sub: Subscription = {
      conn,
      topic: name,
      group: undefined,
      cursor: 0,
      credit: this.#inboxLimit,
      unacked: [],
      scheduled: false,
    };
    conn.subs.set(name, sub);
    if (group === undefined) {
      sub.cursor = this.#start(name, conn.isolateId, from);
      this.#schedule(sub);
      return { ok: true, value: { from: sub.cursor } };
    }
    const g = this.#join(sub, group, from);
    return { ok: true, value: { from: g.cursor, group } };
  }

  /** Adds a member to a group, creating it at `from` if it has none. */
  #join(sub: Subscription, name: string, from: StartPosition): Group {
    const id = `${sub.topic}\u0000${name}`;
    let g = this.#groups.get(id);
    if (!g) {
      const consumer = `group:${name}`;
      g = {
        topic: sub.topic,
        name,
        consumer,
        cursor: this.#start(sub.topic, consumer, from),
        members: [],
        rr: 0,
        unacked: [],
        redeliver: [],
        scheduled: false,
      };
      this.#groups.set(id, g);
    }
    sub.group = g;
    g.members.push(sub);
    g.members.sort((a, b) => (a.conn.isolateId < b.conn.isolateId ? -1 : 1));
    this.#scheduleGroup(g);
    return g;
  }

  /** Ends a subscription. A group member's uncommitted records go to the others. */
  #leave(sub: Subscription): void {
    const g = sub.group;
    if (!g) return;
    sub.group = undefined;
    g.members = g.members.filter((m) => m !== sub);
    if (g.members.length === 0) {
      // Offsets are kept under the group's consumer id; the next member resumes from them.
      this.#groups.delete(`${g.topic}\u0000${g.name}`);
      return;
    }
    for (const u of g.unacked) {
      if (u.member === sub) {
        u.member = undefined;
        g.redeliver.push(u.offset);
      }
    }
    g.redeliver.sort((a, b) => a - b);
    this.#scheduleGroup(g);
  }

  /** `latest` → head, `earliest` → tail, `committed` → committed + 1, else earliest. */
  #start(name: string, consumer: string, from: StartPosition): number {
    if (from === 'latest') return this.#engine.head(name);
    if (from === 'committed') {
      const c = this.#committed(name, consumer);
      if (c !== undefined) return c + 1;
    }
    return this.#engine.tail(name);
  }

  #committed(name: string, consumer: string): number | undefined {
    if (this.#forgotten.has(`${name}\u0000${consumer}`)) return undefined;
    return this.#engine.committed(name, consumer);
  }

  #commit(conn: Connection, name: string, offset: unknown): CallResult {
    const sub = conn.subs.get(name);
    if (!sub) return fail('forbidden', `not subscribed to ${name}`);
    if (!isOffset(offset)) return fail('invalid', 'offset must be a non-negative integer');
    if (offset >= this.#engine.head(name)) {
      return fail('invalid', `offset ${offset} is not in ${name} yet`);
    }
    // A commit restores credit for the delivered records it covers.
    let freed = 0;
    while (sub.unacked.length > 0 && (sub.unacked[0] ?? Infinity) <= offset) {
      sub.unacked.shift();
      freed++;
    }
    sub.credit += freed;
    const g = sub.group;
    if (g) {
      g.unacked = g.unacked.filter((u) => !(u.member === sub && u.offset <= offset));
      // The group's offset only moves past records every member has committed.
      const upTo = (g.unacked[0]?.offset ?? g.cursor) - 1;
      const prev = this.#engine.committed(name, g.consumer) ?? -1;
      if (upTo > prev) this.#engine.commit(name, g.consumer, upTo);
      if (freed > 0) this.#scheduleGroup(g);
    } else {
      this.#forgotten.delete(`${name}\u0000${conn.isolateId}`);
      this.#engine.commit(name, conn.isolateId, offset);
      if (freed > 0) this.#schedule(sub);
    }
    return { ok: true, value: null };
  }

  // Delivery.

  #fanOut(name: string): void {
    for (const conn of this.#conns.values()) {
      const sub = conn.subs.get(name);
      if (!sub) continue;
      if (sub.group) this.#scheduleGroup(sub.group);
      else this.#schedule(sub);
    }
  }

  /**
   * Queues one pump per subscription per microtask, so records published in
   * the same task go out together.
   */
  #schedule(sub: Subscription): void {
    if (sub.scheduled) return;
    sub.scheduled = true;
    queueMicrotask(() => {
      sub.scheduled = false;
      // The subscription may have been replaced, dropped or detached meanwhile.
      if (
        this.#conns.get(sub.conn.isolateId) === sub.conn &&
        sub.conn.subs.get(sub.topic) === sub
      ) {
        this.#pump(sub);
      }
    });
  }

  /**
   * Reads evicted records back from disk (M2b task 11), then calls `then`
   * to pump again. A page that fails is retried by the next pump: the next
   * publish or commit.
   */
  #pageIn(topic: string, offset: number, then: () => void): void {
    this.#engine.page(topic, offset).then(then, (e: unknown) => {
      console.warn(`[isoloop] reading ${topic}@${offset} back from disk failed`, e);
    });
  }

  #scheduleGroup(g: Group): void {
    if (g.scheduled) return;
    g.scheduled = true;
    queueMicrotask(() => {
      g.scheduled = false;
      if (this.#groups.get(`${g.topic}\u0000${g.name}`) === g) this.#pumpGroup(g);
    });
  }

  /** Expired records between the cursor and the tail, as a gap. Compaction is not a gap. */
  #gap(topic: string, cursor: number): { from: number; to: number } | undefined {
    const tail = this.#engine.tail(topic);
    if (cursor >= tail) return undefined;
    if (this.#topics.get(topic)?.def.retention.kind === 'compacted') return undefined;
    return { from: cursor, to: tail - 1 };
  }

  #deliver(sub: Subscription, records: BusRecord[], gap?: { from: number; to: number }): void {
    for (const r of records) {
      sub.unacked.push(r.offset);
      if (r.req)
        this.#requests.get(reqKey(sub.topic, r.offset))?.recipients.add(sub.conn.isolateId);
    }
    sub.credit -= records.length;
    sub.conn.port.post({
      v: 1,
      t: 'deliver',
      p: gap ? { topic: sub.topic, records, gap } : { topic: sub.topic, records },
    });
  }

  /**
   * Delivers from the cursor while there is credit, in batches. At 0 credit
   * the subscription is paused: nothing is queued, only the cursor is kept,
   * and a commit resumes it from the log. Records that expired meanwhile are
   * reported as `gap`.
   */
  #pump(sub: Subscription): void {
    if (sub.credit <= 0) return;
    let gap = this.#gap(sub.topic, sub.cursor);
    if (gap) sub.cursor = gap.to + 1;
    const head = this.#engine.head(sub.topic);
    while (sub.credit > 0 && sub.cursor < head) {
      if (!this.#engine.readable(sub.topic, sub.cursor)) {
        // Evicted to disk: read back in, then go on from here.
        this.#pageIn(sub.topic, sub.cursor, () => this.#schedule(sub));
        break;
      }
      const records = this.#engine.read(sub.topic, sub.cursor, Math.min(this.#batch, sub.credit));
      const last = records.at(-1);
      if (!last) {
        sub.cursor = head;
        break;
      }
      sub.cursor = last.offset + 1;
      this.#deliver(sub, records, gap);
      gap = undefined;
    }
    if (gap) this.#deliver(sub, [], gap);
  }

  /** The member a record goes to: by key hash, or round-robin when keyless. */
  #owner(g: Group, rec: BusRecord): Subscription | undefined {
    const n = g.members.length;
    return g.members[rec.key === undefined ? g.rr % n : hash(rec.key) % n];
  }

  /**
   * Hands records to group members: first those a departed member left
   * uncommitted, then new ones from the group cursor. If a record's member is
   * out of credit the group waits for it, which keeps per-key order.
   */
  #pumpGroup(g: Group): void {
    if (g.members.length === 0) return;
    const batches = new Map<Subscription, BusRecord[]>();
    const flush = (m: Subscription): void => {
      const b = batches.get(m);
      batches.delete(m);
      if (b && b.length > 0) this.#deliver(m, b);
    };
    /** Credit left once the records batched for it go out. */
    const room = (m: Subscription | undefined): number =>
      m ? m.credit - (batches.get(m)?.length ?? 0) : 0;
    const give = (m: Subscription, rec: BusRecord): void => {
      const b = batches.get(m) ?? [];
      b.push(rec);
      batches.set(m, b);
      if (rec.key === undefined) g.rr++;
      if (b.length >= this.#batch) flush(m);
    };

    const gap = this.#gap(g.topic, g.cursor);
    if (gap) {
      g.cursor = gap.to + 1;
      for (const m of g.members) this.#deliver(m, [], gap);
    }
    const tail = this.#engine.tail(g.topic);
    let blocked = false;
    while (g.redeliver.length > 0) {
      const offset = g.redeliver[0] ?? 0;
      if (offset >= tail && !this.#engine.readable(g.topic, offset)) {
        this.#pageIn(g.topic, offset, () => this.#scheduleGroup(g));
        blocked = true;
        break;
      }
      const rec = offset >= tail ? this.#engine.read(g.topic, offset, 1)[0] : undefined;
      if (rec?.offset !== offset) {
        // Gone from the log meanwhile: nothing left to hand over.
        g.redeliver.shift();
        g.unacked = g.unacked.filter((u) => u.offset !== offset);
        continue;
      }
      const m = this.#owner(g, rec);
      if (!m || room(m) <= 0) {
        blocked = true;
        break;
      }
      g.redeliver.shift();
      const entry = g.unacked.find((u) => u.offset === offset);
      if (entry) entry.member = m;
      give(m, rec);
    }
    const head = this.#engine.head(g.topic);
    let more = !blocked;
    while (more && g.cursor < head) {
      if (!this.#engine.readable(g.topic, g.cursor)) {
        this.#pageIn(g.topic, g.cursor, () => this.#scheduleGroup(g));
        break;
      }
      const records = this.#engine.read(g.topic, g.cursor, this.#batch);
      if (records.length === 0) {
        g.cursor = head;
        break;
      }
      for (const rec of records) {
        const m = this.#owner(g, rec);
        if (!m || room(m) <= 0) {
          more = false;
          break;
        }
        g.unacked.push({ offset: rec.offset, member: m });
        give(m, rec);
        g.cursor = rec.offset + 1;
      }
    }
    for (const m of batches.keys()) flush(m);
  }
}

/** Runs a Standard Schema, turning a throw or a rejection into a result. */
function validate(schema: StandardSchemaV1, value: unknown): Validated | Promise<Validated> {
  let r: StandardSchemaV1.Result<unknown> | Promise<StandardSchemaV1.Result<unknown>>;
  try {
    r = schema['~standard'].validate(value);
  } catch (thrown) {
    return { thrown };
  }
  if (!(r instanceof Promise)) return r;
  return r.then(
    (x): Validated => x,
    (thrown: unknown): Validated => ({ thrown }),
  );
}
