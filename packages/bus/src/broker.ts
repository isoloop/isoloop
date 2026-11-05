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
import type { LogEngine } from './engine/types';
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
  /** Built-in `isoloop.*` topics. Default `SYSTEM_TOPICS` from `@isoloop/protocol`. */
  systemTopics?: readonly AnyTopicDef[];
};

/** Who is publishing: an isolate (grants apply), the host (`kernel.publish`), or the kernel itself (system topics). */
export type Publisher =
  | { kind: 'isolate'; isolateId: string }
  | { kind: 'host' }
  | { kind: 'kernel' };

type Topic = { def: AnyTopicDef; maxBytes: number; queue: Pending[] };

/** A publish waiting for its (possibly async) validation, in publish order per topic. */
type Pending = {
  producer: string;
  key: string | undefined;
  done: boolean;
  result: StandardSchemaV1.Result<unknown> | { thrown: unknown } | undefined;
  settle: (r: CallResult) => void;
};

type Subscription = {
  isolateId: string;
  topic: string;
  /** Whose offsets: the isolate id. */
  consumer: string;
  /** Next offset to deliver. */
  cursor: number;
};

type Connection = {
  isolateId: string;
  grants: Grants;
  port: BusPort;
  subs: Map<string, Subscription>;
};

const fail = (code: ErrorCode, message: string, extra?: Partial<CallError>): CallResult => ({
  ok: false,
  error: { code, message, ...extra },
});

const isStartPosition = (x: unknown): x is StartPosition =>
  x === 'latest' || x === 'earliest' || x === 'committed';

const hasTopic = (p: unknown): boolean =>
  typeof p === 'object' && p !== null && 'topic' in p && typeof p.topic === 'string';

/** Producer id for records the host publishes through `kernel.publish`. */
export const HOST_PRODUCER = 'host';
/** Producer id for records the kernel publishes to system topics. */
export const KERNEL_PRODUCER = 'kernel';

/**
 * The bus core (design §6.3): runs the publish pipeline, keeps subscriptions
 * and delivers from the log. Knows nothing about workers; the bus worker
 * entry wires ports to it.
 */
export class Broker {
  readonly #engine: LogEngine;
  readonly #now: () => number;
  readonly #dev: boolean;
  readonly #batch: number;
  readonly #topics = new Map<string, Topic>();
  readonly #conns = new Map<string, Connection>();
  /** Consumers whose offsets were dropped by `detach { keepOffsets: false }`, per topic. */
  readonly #forgotten = new Set<string>();
  #dropped = 0;

  constructor(opts: BrokerOptions) {
    this.#engine = opts.engine;
    this.#now = opts.now ?? Date.now;
    this.#dev = opts.dev ?? false;
    this.#batch = opts.batchSize ?? 64;
    for (const def of [...(opts.systemTopics ?? SYSTEM_TOPICS), ...opts.contracts.topics]) {
      this.#engine.createTopic(topicConfig(def));
      this.#topics.set(def.name, {
        def,
        maxBytes: def.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES,
        queue: [],
      });
    }
  }

  /** Messages dropped as malformed or unknown (design §3: dropped and counted). */
  get dropped(): number {
    return this.#dropped;
  }

  /** Connects an isolate. A second attach for the same id replaces the first. */
  attach(isolateId: string, grants: Grants, port: BusPort): void {
    this.detach(isolateId, true);
    const conn: Connection = { isolateId, grants, port, subs: new Map() };
    this.#conns.set(isolateId, conn);
    port.onMessage((msg) => {
      if (this.#conns.get(isolateId) === conn) this.#receive(conn, msg);
    });
  }

  /**
   * Disconnects an isolate and drops its subscriptions. With `keepOffsets`
   * its commits stay, so a restart with `from: 'committed'` resumes (I6).
   */
  detach(isolateId: string, keepOffsets: boolean): void {
    const conn = this.#conns.get(isolateId);
    if (!conn) return;
    this.#conns.delete(isolateId);
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
    return new Promise((resolve) => this.#publish(from, topic, key, value, resolve));
  }

  #receive(conn: Connection, msg: unknown): void {
    if (!isIsolateToBus(msg)) {
      this.#dropped++;
      return;
    }
    const reply = (r: CallResult): void => {
      if (msg.id !== undefined) conn.port.post({ v: 1, t: 'result', re: msg.id, p: r });
    };
    this.#handle(conn, msg, reply);
  }

  #handle(conn: Connection, msg: IsolateToBus, reply: (r: CallResult) => void): void {
    if (!hasTopic(msg.p)) {
      this.#dropped++;
      return;
    }
    switch (msg.t) {
      case 'publish': {
        const key: unknown = msg.p.key;
        if (key !== undefined && typeof key !== 'string') {
          reply(fail('invalid', 'key must be a string'));
          return;
        }
        const from: Publisher = { kind: 'isolate', isolateId: conn.isolateId };
        this.#publish(from, msg.p.topic, key, msg.p.value, reply);
        return;
      }
      case 'subscribe':
        reply(this.#subscribe(conn, msg.p.topic, msg.p.from));
        return;
      case 'unsubscribe':
        conn.subs.delete(msg.p.topic);
        reply({ ok: true, value: null });
        return;
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
    settle: (r: CallResult) => void,
  ): void {
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
    const size = estimateSize(value, topic.maxBytes);
    if (size > topic.maxBytes) {
      settle(fail('too_large', `record is over ${topic.maxBytes} bytes`));
      return;
    }

    const pending: Pending = {
      producer:
        from.kind === 'isolate'
          ? from.isolateId
          : from.kind === 'host'
            ? HOST_PRODUCER
            : KERNEL_PRODUCER,
      key,
      done: false,
      result: undefined,
      settle,
    };
    let result: StandardSchemaV1.Result<unknown> | Promise<StandardSchemaV1.Result<unknown>>;
    try {
      result = topic.def.schema['~standard'].validate(value);
    } catch (thrown) {
      result = { issues: [{ message: `schema threw: ${String(thrown)}` }] };
    }
    if (!(result instanceof Promise) && topic.queue.length === 0) {
      // Fast path: nothing ahead of this publish on the topic.
      pending.result = result;
      this.#finish(name, topic, pending);
      return;
    }
    topic.queue.push(pending);
    const done = (r: Pending['result']): void => {
      pending.result = r;
      pending.done = true;
      this.#drain(name, topic);
    };
    if (result instanceof Promise) {
      result.then(done, (thrown: unknown) => done({ thrown }));
    } else {
      done(result);
    }
  }

  /** Finishes queued publishes in order, stopping at the first still validating. */
  #drain(name: string, topic: Topic): void {
    while (topic.queue[0]?.done) {
      const next = topic.queue.shift();
      if (next) this.#finish(name, topic, next);
    }
  }

  #finish(name: string, topic: Topic, p: Pending): void {
    const r = p.result;
    if (!r || 'thrown' in r) {
      const thrown = r ? String(r.thrown) : 'no result';
      p.settle(
        fail('invalid', `schema threw: ${thrown}`, { issues: [{ message: thrown, path: [] }] }),
      );
      return;
    }
    if (r.issues) {
      p.settle(fail('invalid', `invalid record for ${name}`, { issues: toIssues(r.issues) }));
      return;
    }
    if (this.#dev) {
      // M2b: persistent topics are checked by the codec instead (not_encodable).
      try {
        structuredClone(r.value);
      } catch (e) {
        p.settle(fail('not_encodable', `schema output can't be cloned: ${String(e)}`));
        return;
      }
    }
    const rec = { value: r.value, ts: this.#now(), producer: p.producer };
    const offset = this.#engine.append(name, p.key === undefined ? rec : { ...rec, key: p.key });
    p.settle({ ok: true, value: { offset } });
    this.#fanOut(name);
  }

  #subscribe(conn: Connection, name: string, from: unknown): CallResult {
    if (!isStartPosition(from))
      return fail('invalid', 'from must be latest, earliest or committed');
    if (!isSystemTopic(name) && !matchAny(conn.grants.subscribe, name)) {
      return fail('forbidden', `no subscribe grant for ${name}`);
    }
    if (!this.#topics.has(name)) return fail('unknown_topic', `unknown topic ${name}`);
    const consumer = conn.isolateId;
    const sub: Subscription = {
      isolateId: conn.isolateId,
      topic: name,
      consumer,
      cursor: this.#start(name, consumer, from),
    };
    conn.subs.set(name, sub);
    this.#pump(conn, sub);
    return { ok: true, value: { from: sub.cursor } };
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
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
      return fail('invalid', 'offset must be a non-negative integer');
    }
    if (offset >= this.#engine.head(name))
      return fail('invalid', `offset ${offset} is not in ${name} yet`);
    this.#forgotten.delete(`${name}\u0000${sub.consumer}`);
    this.#engine.commit(name, sub.consumer, offset);
    return { ok: true, value: null };
  }

  #fanOut(name: string): void {
    for (const conn of this.#conns.values()) {
      const sub = conn.subs.get(name);
      if (sub) this.#pump(conn, sub);
    }
  }

  /** Delivers everything from the subscription's cursor to the head, in batches. */
  #pump(conn: Connection, sub: Subscription): void {
    const head = this.#engine.head(sub.topic);
    while (sub.cursor < head) {
      const records: BusRecord[] = this.#engine.read(sub.topic, sub.cursor, this.#batch);
      const last = records.at(-1);
      if (!last) {
        sub.cursor = head;
        return;
      }
      sub.cursor = last.offset + 1;
      conn.port.post({ v: 1, t: 'deliver', p: { topic: sub.topic, records } });
    }
  }
}
