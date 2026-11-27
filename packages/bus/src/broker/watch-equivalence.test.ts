/*
 * The equivalence property of watchers (ADR 0023, point 4; M8 Watchers W1,
 * task 6): on a quiet bus, a watcher holds the same value per key as a stream
 * reader that started from `earliest` ends up with, for the keys it watches.
 *
 * The watcher here is the real client (`createWatches` from
 * `@isoloop/protocol`, the code `ctx.bus.watch` and `kernel.watch` run) on a
 * real broker, over an in-memory port. Random publishes with random keys,
 * clock moves and retention passes run on every retention kind, on memory and
 * persistent topics, with watches added, replaced and removed on the way, a
 * bus restart (the client reattaches with `have`) and a wake (a new client
 * watches from scratch).
 */
import {
  createWatches,
  type BusToIsolate,
  type CallResult,
  type Grants,
  type IsolateToBus,
  type WatchKey,
  type Watches,
} from '@isoloop/protocol';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FakeDisk } from '../../test/fake-disk';
import { connect, flush } from '../../test/memory-port';
import { contracts, topic, unchecked } from '../contracts/topic';
import { TsEngine } from '../engine/ts-engine';
import { Broker, type BusPort } from './broker';

const TOPICS = [
  topic('lastn.v1', { schema: unchecked<number>(), retention: { kind: 'last-n', n: 4 } }),
  topic('lastn-disk.v1', {
    schema: unchecked<number>(),
    retention: { kind: 'last-n', n: 4 },
    durability: 'persistent',
  }),
  topic('time.v1', { schema: unchecked<number>(), retention: { kind: 'time', ms: 20 } }),
  topic('compacted.v1', { schema: unchecked<number>(), retention: { kind: 'compacted' } }),
  topic('compacted-disk.v1', {
    schema: unchecked<number>(),
    retention: { kind: 'compacted' },
    durability: 'persistent',
  }),
] as const;
const NAMES = TOPICS.map((t) => t.name);
const nameOf = (i: number): string => NAMES[i] ?? 'lastn.v1';
const KEYS: readonly WatchKey[] = ['a', 'b', 'c', 'd', null];
const all: Grants = { publish: ['*'], subscribe: ['*'] };

/** A broker on a clock and timers the test moves, over `disk` for persistent topics. */
class Bus {
  now = 0;
  disk = new FakeDisk(8);
  broker!: Broker;
  #timers: { fn: () => void; at: number }[] = [];

  async start(): Promise<void> {
    this.#timers = [];
    const engine = new TsEngine({ storage: this.disk, now: () => this.now });
    this.broker = new Broker({
      contracts: contracts(...TOPICS),
      engine,
      now: () => this.now,
      timers: { set: (fn, ms) => void this.#timers.push({ fn, at: this.now + ms }) },
    });
    await engine.restore(await this.disk.open());
  }

  /** Moves the clock on, runs the timers that came due and the retention pass. */
  tick(ms: number): void {
    this.now += ms;
    for (const t of this.#timers.splice(0)) {
      if (t.at <= this.now) t.fn();
      else this.#timers.push(t);
    }
    this.broker.compact();
  }

  async publish(t: string, key: WatchKey, value: number): Promise<void> {
    await this.broker.publish({ kind: 'host' }, t, key ?? undefined, value);
  }

  /** What a stream reader from `earliest` ends up with: the newest value per key. */
  async replay(t: string): Promise<Map<WatchKey, unknown>> {
    const reader = connect(this.broker, `reader-${++readers}`, all);
    await reader.call('subscribe', { topic: t, from: 'earliest' });
    await flush();
    const out = new Map<WatchKey, unknown>();
    for (const r of reader.records(t)) out.set(r.key ?? null, r.value);
    this.broker.detach(reader.id, false);
    return out;
  }
}
let readers = 0;

/** A watch spec: every key (`undefined`) or only these. */
type Spec = readonly WatchKey[] | undefined;

/** The real watch client on an in-memory port to `bus`. */
class Client {
  readonly watches: Watches;
  /** The last view each local watch was handed, by topic and slot. */
  readonly held = new Map<string, ReadonlyMap<WatchKey, unknown>>();
  readonly errors: unknown[] = [];
  #handler: ((msg: unknown) => void) | undefined;
  #waiting = new Map<string, (r: CallResult) => void>();
  #calls = 0;
  #stops = new Map<string, () => void>();
  /** `seen` held for the next `commits`, when the interval isn't 0. */
  #soon = false;

  constructor(
    readonly bus: Bus,
    readonly id: string,
    readonly intervalMs: number,
  ) {
    this.watches = createWatches({
      send: (msg) => this.#send(msg),
      call: (msg) => {
        const callId = `${id}-${++this.#calls}`;
        const done = new Promise<CallResult>((r) => this.#waiting.set(callId, r));
        this.#send({ ...msg, id: callId });
        return done;
      },
      now: () => bus.now,
      onError: (err) => this.errors.push(err),
      intervalMs,
      flushNow: () => queueMicrotask(() => this.commit()),
      flushSoon: () => {
        this.#soon = true;
      },
      delivered: () => {},
    });
    this.attach(false);
  }

  attach(reattach: boolean): void {
    const port: BusPort = {
      post: (msg: BusToIsolate) => {
        const m = structuredClone(msg);
        if (m.t === 'result' && m.re !== undefined) {
          this.#waiting.get(m.re)?.(m.p);
          this.#waiting.delete(m.re);
        } else if (m.t === 'view') {
          this.watches.receive(m);
        }
      },
      onMessage: (h) => {
        this.#handler = h;
      },
      close: () => {},
    };
    this.bus.broker.attach(this.id, all, port, { reattach });
  }

  /** Sends the `seen` held: the committer's next `commits`. */
  commit(): void {
    this.#soon = false;
    const seen = this.watches.takeSeen();
    if (seen.length > 0) this.#send({ v: 1, t: 'commits', p: { offsets: [], seen } });
  }

  /** The committer's interval came round. */
  tick(): void {
    if (this.#soon) this.commit();
  }

  watch(t: string, slot: string, keys: Spec): void {
    this.#stops.get(`${t}/${slot}`)?.();
    const stop = this.watches.watch<number>(
      t,
      (view) => {
        this.held.set(`${t}/${slot}`, new Map(view));
      },
      keys ? { keys } : {},
    );
    this.#stops.set(`${t}/${slot}`, () => {
      stop();
      this.held.delete(`${t}/${slot}`);
    });
  }

  unwatch(t: string, slot: string): void {
    this.#stops.get(`${t}/${slot}`)?.();
    this.#stops.delete(`${t}/${slot}`);
  }

  #send(msg: IsolateToBus): void {
    this.#handler?.(structuredClone(msg));
  }
}

type Op =
  | { op: 'publish'; topic: number; key: WatchKey; dt: number }
  | { op: 'tick'; ms: number }
  | { op: 'watch'; topic: number; slot: 'x' | 'y'; keys: Spec }
  | { op: 'unwatch'; topic: number; slot: 'x' | 'y' }
  | { op: 'restart' }
  | { op: 'wake' };

const spec: fc.Arbitrary<Spec> = fc.option(fc.subarray([...KEYS], { minLength: 1 }), {
  nil: undefined,
});
const topicIx = fc.integer({ min: 0, max: NAMES.length - 1 });
const slot = fc.constantFrom('x' as const, 'y' as const);

const op = (restarts: boolean): fc.Arbitrary<Op> =>
  fc.oneof(
    {
      weight: 12,
      arbitrary: fc.record({
        op: fc.constant('publish' as const),
        topic: topicIx,
        key: fc.constantFrom(...KEYS),
        dt: fc.integer({ min: 0, max: 8 }),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        op: fc.constant('tick' as const),
        ms: fc.integer({ min: 1, max: 40 }),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({ op: fc.constant('watch' as const), topic: topicIx, slot, keys: spec }),
    },
    {
      weight: 1,
      arbitrary: fc.record({ op: fc.constant('unwatch' as const), topic: topicIx, slot }),
    },
    { weight: restarts ? 1 : 0, arbitrary: fc.constant({ op: 'restart' as const }) },
    { weight: restarts ? 1 : 0, arbitrary: fc.constant({ op: 'wake' as const }) },
  );

/** Lets every message, view and `seen` go round until nothing moves. */
async function quiet(bus: Bus, client: Client): Promise<void> {
  for (let i = 0; i < 20; i++) {
    // oxlint-disable-next-line no-await-in-loop -- each round lets the last one's messages land
    await flush();
    client.tick();
    bus.broker.compact();
  }
}

/** Runs `ops`, then checks every live watch against a replay of its topic. */
async function check(ops: Op[], intervalMs: number): Promise<void> {
  const bus = new Bus();
  await bus.start();
  let client = new Client(bus, 'W', intervalMs);
  /** The live watches, to watch again on a wake. */
  const live = new Map<string, { t: string; slot: 'x' | 'y'; keys: Spec }>();
  let value = 0;
  for (const o of ops) {
    switch (o.op) {
      case 'publish': {
        bus.now += o.dt;
        const t = nameOf(o.topic);
        // oxlint-disable-next-line no-await-in-loop -- publishes land in order
        await bus.publish(t, o.key, ++value);
        break;
      }
      case 'tick':
        bus.tick(o.ms);
        client.tick();
        break;
      case 'watch': {
        const t = nameOf(o.topic);
        client.watch(t, o.slot, o.keys);
        live.set(`${t}/${o.slot}`, { t, slot: o.slot, keys: o.keys });
        break;
      }
      case 'unwatch': {
        const t = nameOf(o.topic);
        client.unwatch(t, o.slot);
        live.delete(`${t}/${o.slot}`);
        break;
      }
      case 'restart':
        // oxlint-disable-next-line no-await-in-loop -- the new bus is up before anything else
        await bus.start();
        client.attach(true);
        client.watches.reattach();
        break;
      case 'wake':
        // A new worker: it holds nothing and watches from scratch (point 24).
        bus.broker.detach(client.id, true);
        client = new Client(bus, 'W', intervalMs);
        for (const w of live.values()) client.watch(w.t, w.slot, w.keys);
        break;
    }
    // oxlint-disable-next-line no-await-in-loop -- some ops let messages through, as a busy bus does
    if (value % 3 === 0) await flush();
  }
  await quiet(bus, client);
  expect(client.errors).toEqual([]);
  for (const [k, w] of live) {
    // oxlint-disable-next-line no-await-in-loop -- one reader per topic
    const replay = await bus.replay(w.t);
    const want = new Map<WatchKey, unknown>();
    for (const [key, v] of replay) if (!w.keys || w.keys.includes(key)) want.set(key, v);
    expect({ watch: k, held: client.held.get(k) ?? new Map() }).toEqual({ watch: k, held: want });
  }
}

describe('watchers: equivalence with a replay from earliest (ADR 0023, point 4)', () => {
  it('holds what a replay ends with, on every retention kind, with watches coming and going', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(op(false), { minLength: 1, maxLength: 120 }),
        fc.constantFrom(0, 100),
        (ops, interval) => check(ops, interval),
      ),
      { numRuns: 150 },
    );
  });

  it('holds it across bus restarts and wakes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(op(true), { minLength: 1, maxLength: 120 }),
        fc.constantFrom(0, 100),
        (ops, interval) => check(ops, interval),
      ),
      { numRuns: 150 },
    );
  });
});
