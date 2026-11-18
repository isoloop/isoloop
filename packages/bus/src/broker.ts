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
  type RequestVia,
  type SeedEvent,
  type StartPosition,
} from '@isoloop/protocol';
import type { AppendId, LogEngine, NewRecord } from './engine/types';
import { estimateSize } from './size';
import {
  copySeed,
  mapRecord,
  SEED_REJECTED,
  SEED_REPORTS_PER_SEC,
  seedDone,
  seedOrder,
  seedPending,
  type SeedVerdict,
} from './seed';
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
  /** Seeding news for the host: rejected source records and ended seeds (ADR 0003, decision 18). */
  onSeed?: (e: SeedEvent) => void;
};

/**
 * Gets each record appended to a tapped topic (ADR 0020, decision 3), with
 * its estimated size. A tap is not a consumer: it has no cursor or credit.
 */
export type TapSink = (topic: string, rec: BusRecord, bytes: number) => void;

/** Who is publishing: an isolate (grants apply), the host (`kernel.publish`), or the kernel itself (system topics). */
export type Publisher =
  | { kind: 'isolate'; isolateId: string }
  | { kind: 'host' }
  | { kind: 'kernel' };

type Topic = {
  def: AnyTopicDef;
  maxBytes: number;
  queue: Pending[];
  /**
   * Set while the topic seeds from an older one (ADR 0003, decision 18): its
   * publishes wait in `queue`, and subscribes wait here, until the seed ends.
   */
  seeding: HeldSubscribe[] | undefined;
  /** Records appended since the broker started, and their estimated bytes. */
  records: number;
  bytes: number;
};

/** Cumulative counters for metrics (design §6.3); the bus worker turns them into rates. */
export type BrokerStats = {
  /** `head` and `retained` are the engine's, at the time of the sample (ADR 0020, decision 2). */
  topics: { topic: string; records: number; bytes: number; head: number; retained: number }[];
  /** `lag` is `head − cursor`: records not yet delivered. */
  subscriptions: { consumer: string; topic: string; lag: number; credit: number }[];
  /** Rejected publishes and requests, by error code. */
  rejected: Partial<Record<ErrorCode, number>>;
};

type Validated = StandardSchemaV1.Result<unknown> | { thrown: unknown };

/** A subscribe to a seeding topic, answered when the seed ends. */
type HeldSubscribe = {
  conn: Connection;
  from: unknown;
  group: unknown;
  reply: (r: CallResult) => void;
};

/** A publish waiting for its (possibly async) validation, in publish order per topic. */
type Pending = {
  producer: string;
  /** Estimated size of the published value. */
  bytes: number;
  key: string | undefined;
  req: { from: Connection; id: string; timeoutMs: number; via?: RequestVia } | undefined;
  /** A record `follow` forwards keeps its source's `ts`; publishes get the time of append. */
  ts?: number;
  /** The publisher's `(epoch, seq)`, for deduplicating re-sends on persistent topics. */
  id?: AppendId;
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
  /**
   * Records delivered to this isolate and not yet committed, with the `seq`
   * of the delivery each went out in. Ascending by offset, except in a
   * group, where a redelivered record can follow higher ones.
   */
  unacked: Delivered[];
  /** `deliver`s sent on this subscription: the last one's `seq` (ADR 0016, point 10). */
  seq: number;
  /** A pump is queued for the next microtask. */
  scheduled: boolean;
};

/** A delivered record's offset, the `seq` of the delivery it went out in, and its place in it. */
type Delivered = { offset: number; seq: number; i: number };

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
  /**
   * Delivered and not yet committed, ascending. `member` is unset while
   * waiting for redelivery; `seq` is that of the delivery it last went out
   * in, to its current member.
   */
  unacked: { offset: number; member: Subscription | undefined; seq: number; i: number }[];
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
  /**
   * A `kernel.request`'s caller (ADR 0018): not attached, answered through
   * the control port, and alive as long as the bus is.
   */
  host?: true;
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

/** A commit's `seq`: a non-negative integer, 0 before any delivery is settled whole. */
const isSeq = isOffset;

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

/** A message's `(epoch, seq)`, when it carries both as numbers. */
export function publishId(p: { epoch?: unknown; seq?: unknown }): AppendId | undefined {
  const { epoch, seq } = p;
  return typeof epoch === 'number' && typeof seq === 'number' ? { epoch, seq } : undefined;
}

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
  readonly #onSeed: (e: SeedEvent) => void;
  /** Seed sources the contracts don't list: in the engine, so seeds can read them, but not open to isolates. */
  readonly #sources = new Set<string>();
  readonly #followReports = new Map<
    string,
    (offset: number, v: Extract<SeedVerdict, { ok: false }>) => void
  >();
  #dropped = 0;
  /** Inspection taps, with the topic patterns each one matches. */
  readonly #taps = new Map<TapSink, readonly string[]>();

  constructor(opts: BrokerOptions) {
    this.#engine = opts.engine;
    this.#now = opts.now ?? Date.now;
    this.#dev = opts.dev ?? false;
    this.#batch = opts.batchSize ?? 64;
    this.#inboxLimit = opts.inboxLimit ?? 1000;
    this.#timers = opts.timers ?? { set: (fn, ms) => void setTimeout(fn, ms) };
    this.#durable = opts.durable ?? ((topic) => this.#engine.durable(topic));
    this.#onWake = opts.onWake ?? (() => {});
    this.#onSeed = opts.onSeed ?? (() => {});
    for (const def of [...(opts.systemTopics ?? SYSTEM_TOPICS), ...opts.contracts.topics]) {
      this.#engine.createTopic(topicConfig(def));
      this.#topics.set(def.name, {
        def,
        maxBytes: def.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES,
        queue: [],
        seeding: undefined,
        records: 0,
        bytes: 0,
      });
    }
    for (const def of opts.contracts.topics) {
      const from = def.seed?.from;
      if (!from || this.#topics.has(from.name) || this.#sources.has(from.name)) continue;
      this.#engine.createTopic(topicConfig(from));
      this.#sources.add(from.name);
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
        head: this.#engine.head(topic),
        retained: this.#engine.retained(topic),
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

  /**
   * Starts every declared seed whose topic is empty and whose source has
   * records, or is seeding itself (ADR 0003, decision 18). The topics are
   * marked seeding before this returns, so call it before any connection is
   * attached. Resolves when every seed has ended. The bus worker calls it
   * only when it holds the files: elsewhere persistent topics start empty.
   */
  seed(): Promise<void> {
    const runs = new Map<string, Promise<void>>();
    for (const def of seedOrder([...this.#topics.values()].map((t) => t.def))) {
      const topic = this.#topics.get(def.name);
      const seed = def.seed;
      if (!topic || !seed) continue;
      const from = seed.from.name;
      const before = runs.get(from);
      const hasData = this.#engine.head(from) > this.#engine.tail(from);
      if (seedDone(this.#engine, def.name)) continue;
      // A seed cut short resumes; otherwise only an empty topic seeds, from a source with records.
      if (!seedPending(this.#engine, def.name)) {
        if (this.#engine.head(def.name) > 0 || (!hasData && !before)) continue;
      }
      topic.seeding = [];
      const run = (before ?? Promise.resolve())
        .then(() =>
          copySeed({
            engine: this.#engine,
            to: def.name,
            from,
            map: seed.map,
            accept: (value) => {
              const v = validate(def.schema, value);
              const verdict = (r: Validated): SeedVerdict => {
                const c = this.#check(def.name, r, def.durability === 'persistent');
                if (c.ok) return { ok: true, value: c.value };
                return {
                  ok: false,
                  code: c.error.code,
                  issues: c.error.issues ?? [{ message: c.error.message, path: [] }],
                };
              };
              return v instanceof Promise ? v.then(verdict) : verdict(v);
            },
            onReject: this.#seedReporter(def.name, from),
          }),
        )
        .then(
          (r) => {
            this.#onSeed({ kind: 'seeded', topic: def.name, ...r });
            this.#open(def.name, topic);
          },
          (e: unknown) => {
            console.warn(`[isoloop] seeding ${def.name} from ${from} failed`, e);
            this.#open(def.name, topic);
          },
        );
      runs.set(def.name, run);
    }
    return Promise.all(runs.values()).then(() => {});
  }

  /**
   * `follow` (ADR 0003, decision 18): a record appended to a seed source goes
   * on, through `map` and the topic's schema, to each topic that follows it
   * and isn't seeding (a seed in progress copies it itself).
   */
  #follow(source: string, rec: BusRecord): void {
    for (const topic of this.#topics.values()) {
      const seed = topic.def.seed;
      if (!seed?.follow || seed.from.name !== source || topic.seeding) continue;
      const name = topic.def.name;
      let report = this.#followReports.get(name);
      if (!report) this.#followReports.set(name, (report = this.#seedReporter(name, source)));
      const rejected = report;
      const mapped = mapRecord(seed.map, rec);
      if (!mapped.ok) {
        rejected(rec.offset, mapped);
        continue;
      }
      const pending: Pending = {
        bytes: 0,
        producer: rec.producer,
        key: rec.key,
        req: undefined,
        ts: rec.ts,
        done: false,
        result: undefined,
        settle: (r) => {
          if (!r.ok) {
            const issues = r.error.issues ?? [{ message: r.error.message, path: [] }];
            rejected(rec.offset, { ok: false, code: r.error.code, issues });
          }
        },
      };
      this.#enqueue(name, topic, pending, validate(topic.def.schema, mapped.value));
    }
  }

  /**
   * Why `kernel.dropTopic(name)` may not delete `name`, if it may not (ADR
   * 0003, decision 19): the contracts list it, a declared seed that reads it
   * hasn't ended, or seed records rejected from it are recorded and `force`
   * isn't set.
   */
  dropRefusal(name: string, force: boolean): CallResult | undefined {
    if (this.#topics.has(name)) return fail('invalid', `${name} is in the contracts`);
    for (const t of this.#topics.values()) {
      if (t.def.seed?.from.name !== name) continue;
      if (!seedDone(this.#engine, t.def.name))
        return fail('seed_pending', `${t.def.name} still seeds from ${name}`);
      if (!force && (this.#engine.committed(t.def.name, SEED_REJECTED) ?? 0) > 0) {
        return fail(
          'invalid',
          `${t.def.name} has rejected seed records from ${name}; pass { force: true } to drop them`,
        );
      }
    }
    return undefined;
  }

  /** Persistent topics a declared seed reads that the contracts don't list. */
  get seedSources(): readonly string[] {
    return [...this.#sources];
  }

  /** Reports rejected seed records, at most `SEED_REPORTS_PER_SEC` a second. */
  #seedReporter(
    topic: string,
    from: string,
  ): (offset: number, v: Extract<SeedVerdict, { ok: false }>) => void {
    let windowStart = -Infinity;
    let sent = 0;
    return (offset, v) => {
      const now = this.#now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        sent = 0;
      }
      if (sent >= SEED_REPORTS_PER_SEC) return;
      sent++;
      this.#onSeed({ kind: 'rejected', topic, from, offset, code: v.code, issues: v.issues });
    };
  }

  /** A seed ended: the topic takes its waiting publishes, then its waiting subscribes. */
  #open(name: string, topic: Topic): void {
    const held = topic.seeding ?? [];
    topic.seeding = undefined;
    this.#drain(name, topic);
    for (const h of held) {
      if (this.#conns.get(h.conn.isolateId) !== h.conn) continue; // detached meanwhile
      h.reply(this.#subscribe(h.conn, name, h.from, h.group));
    }
    if (this.#engine.durable(name)) void this.#engine.flush();
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
    id?: AppendId,
  ): Promise<CallResult> {
    return new Promise((resolve) => this.#publish(from, topic, key, value, undefined, resolve, id));
  }

  /**
   * A request from the host (`kernel.request`, ADR 0018, decision 4): like
   * an isolate's `bus.request`, with `req: { from: 'host', id, via }` on the
   * record. `answer` gets one result: a failure to append, or the first
   * valid reply (or `reply_invalid`). Nothing, if no reply comes before the
   * caller's timeout; the request is forgotten after `timeoutMs`.
   */
  request(
    topic: string,
    key: string | undefined,
    value: unknown,
    opts: { id: string; timeoutMs: number; via?: RequestVia },
    answer: (r: CallResult) => void,
    appendId?: AppendId,
  ): void {
    let answered = false;
    const once = (r: CallResult): void => {
      if (answered) return;
      answered = true;
      answer(r);
    };
    const caller: Connection = {
      isolateId: HOST_PRODUCER,
      grants: { publish: [], subscribe: [] },
      port: {
        post: (m) => {
          if (m.t === 'result') once(m.p);
        },
        onMessage: () => {},
        close: () => {},
      },
      subs: new Map(),
      reset: undefined,
      host: true,
    };
    const req = {
      from: caller,
      id: opts.id,
      timeoutMs: opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS,
      ...(opts.via === undefined ? {} : { via: opts.via }),
    };
    // Only failures answer here; success is the reply.
    this.#publish(
      { kind: 'host' },
      topic,
      key,
      value,
      req,
      (r) => {
        if (!r.ok) once(r);
      },
      appendId,
    );
  }

  #receive(conn: Connection, msg: unknown): void {
    // Every message names its topic, except `commits`, whose entries each do (ADR 0016).
    if (!isIsolateToBus(msg) || (msg.t !== 'commits' && !hasTopic(msg.p))) {
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
        this.#publish(self, msg.p.topic, key, msg.p.value, undefined, reply, publishId(msg.p));
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
          publishId(msg.p),
        );
        return;
      }
      case 'reply':
        this.#reply(conn, msg.p.topic, msg.p.offset, msg.p.value, reply);
        return;
      case 'subscribe': {
        const held = this.#topics.get(msg.p.topic)?.seeding;
        if (held && (isSystemTopic(msg.p.topic) || matchAny(conn.grants.subscribe, msg.p.topic))) {
          // Answered once the seed ends, so history comes before anything new.
          held.push({ conn, from: msg.p.from, group: msg.p.group, reply });
          return;
        }
        reply(this.#subscribe(conn, msg.p.topic, msg.p.from, msg.p.group));
        return;
      }
      case 'unsubscribe': {
        const held = this.#topics.get(msg.p.topic)?.seeding;
        if (held) {
          for (let i = held.length - 1; i >= 0; i--) {
            const h = held[i];
            if (h?.conn !== conn) continue;
            held.splice(i, 1);
            h.reply(fail('invalid', 'unsubscribed before the seed ended'));
          }
        }
        const sub = conn.subs.get(msg.p.topic);
        if (sub) this.#leave(sub);
        conn.subs.delete(msg.p.topic);
        reply({ ok: true, value: null });
        return;
      }
      case 'commits': {
        // Each entry stands alone (ADR 0016, decision 1): one that fails
        // doesn't stop the others. With an id, the reply is the first failure.
        const offsets: unknown = msg.p.offsets;
        if (!Array.isArray(offsets)) {
          reply(fail('invalid', 'commits needs an offsets array'));
          return;
        }
        let first: CallResult = { ok: true, value: null };
        for (const e of offsets as unknown[]) {
          const r =
            typeof e === 'object' && e !== null && 'topic' in e && typeof e.topic === 'string'
              ? this.#commit(
                  conn,
                  e.topic,
                  'offset' in e ? e.offset : undefined,
                  'seq' in e ? e.seq : undefined,
                  'partial' in e ? e.partial : undefined,
                )
              : fail('invalid', 'each commit needs a topic, an offset and a seq');
          if (!r.ok && first.ok) first = r;
        }
        reply(first);
        return;
      }
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
    id?: AppendId,
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
      ...(id ? { id } : {}),
      done: false,
      result: undefined,
      settle,
    };
    this.#enqueue(name, topic, pending, validate(topic.def.schema, value));
  }

  /** Appends `pending` once its validation is done and everything ahead of it on the topic is. */
  #enqueue(
    name: string,
    topic: Topic,
    pending: Pending,
    result: Validated | Promise<Validated>,
  ): void {
    if (!(result instanceof Promise) && topic.queue.length === 0 && !topic.seeding) {
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
    if (topic.seeding) return;
    while (topic.queue[0]?.done) {
      const next = topic.queue.shift();
      if (next) this.#finish(name, topic, next);
    }
  }

  #finish(name: string, topic: Topic, p: Pending): void {
    if (p.id && this.#engine.durable(name)) {
      // A re-send after a bus crash of a publish already on disk (ADR 0007,
      // step 5): answered with the original offset, not appended again.
      const prior = this.#engine.appended(name, p.producer, p.id);
      if (prior !== undefined) {
        if (p.req) this.#openRequest(name, prior, p.req);
        this.#ackDurable(name, prior, p);
        return;
      }
    }
    const checked = this.#check(name, p.result, topic.def.durability === 'persistent');
    if (!checked.ok) {
      p.settle(checked);
      return;
    }
    if (this.#storageFull && this.#engine.durable(name)) {
      p.settle(fail('quota_exceeded', `${name}: the origin's storage is full`));
      return;
    }
    let rec: NewRecord = { value: checked.value, ts: p.ts ?? this.#now(), producer: p.producer };
    if (p.key !== undefined) rec = { ...rec, key: p.key };
    if (p.req) {
      const { via } = p.req;
      rec = {
        ...rec,
        req: { from: p.req.from.isolateId, id: p.req.id, ...(via === undefined ? {} : { via }) },
      };
    }
    const offset = this.#engine.append(name, rec, p.id);
    topic.records++;
    topic.bytes += p.bytes;
    if (p.req) this.#openRequest(name, offset, p.req);
    if (this.#engine.durable(name)) this.#ackDurable(name, offset, p);
    else p.settle({ ok: true, value: { offset } });
    this.#fanOut(name);
    this.#wake(name);
    this.#follow(name, { ...rec, offset });
    if (this.#taps.size > 0) this.#toTaps(name, { ...rec, offset }, p.bytes);
  }

  #toTaps(name: string, rec: BusRecord, bytes: number): void {
    for (const [sink, patterns] of this.#taps) {
      if (!matchAny(patterns, name)) continue;
      try {
        sink(name, rec, bytes);
      } catch (e) {
        console.error('[isoloop] bus: a tap threw', e);
      }
    }
  }

  /**
   * The inspection feed's tap (ADR 0020, decision 3): `sink` gets every
   * record appended to a topic matching one of `patterns` from now on,
   * through the publish pipeline. Seeds copying into a topic before it opens
   * aren't tapped. Returns the function that ends it.
   */
  tap(patterns: readonly string[], sink: TapSink): () => void {
    this.#taps.set(sink, [...patterns]);
    return () => {
      this.#taps.delete(sink);
    };
  }

  /**
   * The last `last` retained records of `topic`, oldest first (ADR 0020,
   * decision 3), paging evicted records in from disk when needed. Seed
   * sources the contracts don't list are unknown here, as to isolates.
   */
  async read(
    name: string,
    last: number,
  ): Promise<{ ok: true; records: BusRecord[] } | { ok: false; error: CallError }> {
    if (!this.#topics.has(name))
      return { ok: false, error: { code: 'unknown_topic', message: `unknown topic ${name}` } };
    if (!Number.isInteger(last) || last < 1)
      return {
        ok: false,
        error: { code: 'invalid', message: 'last must be a positive whole number' },
      };
    const tail = this.#engine.tail(name);
    const head = this.#engine.head(name);
    // Compaction and expiry leave gaps, so widen the window until it holds
    // `last` records or reaches the tail.
    let span = last;
    for (;;) {
      const from = Math.max(tail, head - span);
      // Each wider window depends on what the last one held, so the pages load in turn.
      // oxlint-disable-next-line eslint/no-await-in-loop -- see above
      if (!this.#engine.readable(name, from)) await this.#engine.page(name, from);
      const got = this.#engine.read(name, from, Number.MAX_SAFE_INTEGER);
      if (got.length >= last || from <= this.#engine.tail(name))
        return { ok: true, records: got.slice(-last) };
      span *= 2;
    }
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

  /** Acknowledged once its batch is on disk (ADR 0007, decision 2). */
  #ackDurable(name: string, offset: number, p: Pending): void {
    this.#engine.flush().then(
      () => p.settle({ ok: true, value: { offset } }),
      (e: unknown) =>
        p.settle(
          e instanceof DOMException && e.name === 'QuotaExceededError'
            ? fail('quota_exceeded', `${name}: the origin's storage is full`)
            : fail('bus_unavailable', `${name}: write failed: ${String(e)}`),
        ),
    );
  }

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
      const callerAlive =
        req.caller.host === true || this.#conns.get(req.caller.isolateId) === req.caller;
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
    // A reattached subscription to a persistent topic resumes after what it
    // committed on the old bus (ADR 0007, step 3), not at its `from` again:
    // its handlers already saw the records before that.
    const consumer = group === undefined ? conn.isolateId : `group:${group}`;
    const start: StartPosition =
      conn.reset && this.#durable(name) && this.#committed(name, consumer) !== undefined
        ? 'committed'
        : from;
    const old = conn.subs.get(name);
    if (old) this.#leave(old);
    const sub: Subscription = {
      conn,
      topic: name,
      group: undefined,
      cursor: 0,
      credit: this.#inboxLimit,
      unacked: [],
      seq: 0,
      scheduled: false,
    };
    conn.subs.set(name, sub);
    if (group === undefined) {
      sub.cursor = this.#start(name, conn.isolateId, start);
      this.#schedule(sub);
      return { ok: true, value: { from: sub.cursor } };
    }
    const g = this.#join(sub, group, start);
    return { ok: true, value: { from: g.cursor, group } };
  }

  /**
   * Adds a member to a group. A group with no members starts after its
   * committed offset when it has one, whatever `from` says, and at `from`
   * only before its first commit (ADR 0016, point 14). A member joining a
   * group that has members takes records from where the group is.
   */
  #join(sub: Subscription, name: string, from: StartPosition): Group {
    const id = `${sub.topic}\u0000${name}`;
    let g = this.#groups.get(id);
    if (!g) {
      const consumer = `group:${name}`;
      const committed = this.#committed(sub.topic, consumer) !== undefined;
      g = {
        topic: sub.topic,
        name,
        consumer,
        cursor: this.#start(sub.topic, consumer, committed ? 'committed' : from),
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

  /**
   * A commit covers the records delivered up to `offset`. In a group it also
   * needs their delivery's `seq` at or below `seq`: a record redelivered to
   * this member after the deliveries the commit settled has a higher one,
   * whatever its offset (ADR 0016, point 12). `partial` also covers the
   * first records of delivery `seq + 1`, the ones settled before a member
   * stops partway through it (point 17). An own subscription's deliveries
   * are in order, so the offset alone decides there.
   */
  #commit(
    conn: Connection,
    name: string,
    offset: unknown,
    seq: unknown,
    partial: unknown,
  ): CallResult {
    const sub = conn.subs.get(name);
    if (!sub) return fail('forbidden', `not subscribed to ${name}`);
    if (!isOffset(offset)) return fail('invalid', 'offset must be a non-negative integer');
    if (!isSeq(seq)) return fail('invalid', 'seq must be a non-negative integer');
    if (partial !== undefined && !isSeq(partial))
      return fail('invalid', 'partial must be a non-negative integer');
    const part = isSeq(partial) ? partial : 0;
    if (offset >= this.#engine.head(name)) {
      return fail('invalid', `offset ${offset} is not in ${name} yet`);
    }
    const g = sub.group;
    const covers = (d: Delivered): boolean =>
      g
        ? (d.offset <= offset && d.seq <= seq) || (d.seq === seq + 1 && d.i < part)
        : d.offset <= offset;
    // A commit restores credit for the delivered records it covers.
    const before = sub.unacked.length;
    if (g) sub.unacked = sub.unacked.filter((d) => !covers(d));
    else while (sub.unacked[0] && covers(sub.unacked[0])) sub.unacked.shift();
    const freed = before - sub.unacked.length;
    sub.credit += freed;
    if (g) {
      g.unacked = g.unacked.filter((u) => !(u.member === sub && covers(u)));
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

  /** Sends one `deliver`, numbered with the subscription's next `seq`, and returns it. */
  #deliver(sub: Subscription, records: BusRecord[], gap?: { from: number; to: number }): number {
    const seq = ++sub.seq;
    for (const [i, r] of records.entries()) {
      sub.unacked.push({ offset: r.offset, seq, i });
      if (r.req)
        this.#requests.get(reqKey(sub.topic, r.offset))?.recipients.add(sub.conn.isolateId);
    }
    sub.credit -= records.length;
    sub.conn.port.post({
      v: 1,
      t: 'deliver',
      p: gap ? { topic: sub.topic, records, gap, seq } : { topic: sub.topic, records, seq },
    });
    return seq;
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
    type Entry = Group['unacked'][number];
    const batches = new Map<
      Subscription,
      { records: BusRecord[]; entries: { entry: Entry; i: number }[] }
    >();
    const flush = (m: Subscription): void => {
      const b = batches.get(m);
      batches.delete(m);
      if (!b || b.records.length === 0) return;
      // Each entry keeps the seq it went out in, a redelivered one included.
      const seq = this.#deliver(m, b.records);
      for (const { entry, i } of b.entries) {
        entry.seq = seq;
        entry.i = i;
      }
    };
    /** Credit left once the records batched for it go out. */
    const room = (m: Subscription | undefined): number =>
      m ? m.credit - (batches.get(m)?.records.length ?? 0) : 0;
    const give = (m: Subscription, rec: BusRecord, entry: Entry | undefined): void => {
      const b = batches.get(m) ?? { records: [], entries: [] };
      if (entry) b.entries.push({ entry, i: b.records.length });
      b.records.push(rec);
      batches.set(m, b);
      if (rec.key === undefined) g.rr++;
      if (b.records.length >= this.#batch) flush(m);
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
      give(m, rec, entry);
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
        const entry = { offset: rec.offset, member: m, seq: 0, i: 0 };
        g.unacked.push(entry);
        give(m, rec, entry);
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
