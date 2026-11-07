import type { Retention, TopicConfig } from '@isoloop/protocol';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runEngineConformance } from '../../test/engine-conformance';
import { FakeDisk } from '../../test/fake-disk';
import { connect, flush } from '../../test/memory-port';
import { ReferenceEngine } from '../../test/reference-engine';
import { Broker } from '../broker';
import { contracts, topic, unchecked } from '../topic';
import { APPENDED_WINDOW, TsEngine } from './ts-engine';

runEngineConformance('ts', (opts) => new TsEngine(opts));
// Tiny chunks, so the suite crosses chunk boundaries all the time.
runEngineConformance(
  'ts, 4-record chunks',
  (opts) => new TsEngine({ ...opts, chunkSize: 4, dirtyMin: 2 }),
);

const cfg = (retention: Retention): TopicConfig => ({ name: 't', retention, requestable: false });
const rec = (value: number, key?: string, ts = 0) =>
  key === undefined ? { value, ts, producer: 'p' } : { key, value, ts, producer: 'p' };

describe('TsEngine', () => {
  it('frees whole chunks as last-n drops records', () => {
    const e = new TsEngine({ chunkSize: 100 });
    e.createTopic(cfg({ kind: 'last-n', n: 10 }));
    for (let i = 0; i < 100_000; i++) e.append('t', rec(i));
    expect(e.chunkCount('t')).toBeLessThanOrEqual(2);
    expect(e.read('t', 0, 100).map((r) => r.value)).toEqual(
      Array.from({ length: 10 }, (_, i) => 99_990 + i),
    );
  });

  it('frees chunks once time retention empties them', () => {
    let now = 0;
    const e = new TsEngine({ chunkSize: 8, now: () => now });
    e.createTopic(cfg({ kind: 'time', ms: 10 }));
    for (let i = 0; i < 100; i++) e.append('t', rec(i, undefined, i));
    now = 105;
    e.compact('t');
    expect(e.tail('t')).toBe(95);
    // Offsets 88–95 and 96–99: the chunk holding the tail stays.
    expect(e.chunkCount('t')).toBe(2);
  });

  it('compacts itself once enough records are superseded', () => {
    const e = new TsEngine({ chunkSize: 16, dirtyMin: 8 });
    e.createTopic(cfg({ kind: 'compacted' }));
    for (let i = 0; i < 1_000; i++) e.append('t', rec(i, `k${i % 4}`));
    // Never compacted by hand, yet the log stays near the number of keys.
    expect(e.read('t', 0, 10_000).length).toBeLessThan(40);
    expect(e.chunkCount('t')).toBeLessThanOrEqual(3);
  });

  it('matches the reference engine on random histories', () => {
    type Op =
      | { op: 'append'; key: string | undefined; dt: number }
      | { op: 'compact' }
      | { op: 'read'; from: number; max: number };
    const op: fc.Arbitrary<Op> = fc.oneof(
      {
        weight: 10,
        arbitrary: fc.record({
          op: fc.constant('append' as const),
          key: fc.option(fc.constantFrom('a', 'b', 'c'), { nil: undefined }),
          dt: fc.integer({ min: 0, max: 5 }),
        }),
      },
      { weight: 1, arbitrary: fc.record({ op: fc.constant('compact' as const) }) },
      {
        weight: 2,
        arbitrary: fc.record({
          op: fc.constant('read' as const),
          from: fc.integer({ min: 0, max: 400 }),
          max: fc.integer({ min: 0, max: 50 }),
        }),
      },
    );
    const retention: fc.Arbitrary<Retention> = fc.oneof(
      fc.constant<Retention>({ kind: 'compacted' }),
      fc.integer({ min: 1, max: 30 }).map((n): Retention => ({ kind: 'last-n', n })),
      fc.integer({ min: 1, max: 40 }).map((ms): Retention => ({ kind: 'time', ms })),
    );
    fc.assert(
      fc.property(
        retention,
        fc.array(op, { maxLength: 400 }),
        fc.integer({ min: 1, max: 9 }),
        (r, ops, size) => {
          let now = 0;
          const clock = { now: () => now };
          // No self-compaction: the reference only compacts when asked.
          const ts = new TsEngine({ ...clock, chunkSize: size, dirtyMin: Number.MAX_SAFE_INTEGER });
          const ref = new ReferenceEngine(clock);
          ts.createTopic(cfg(r));
          ref.createTopic(cfg(r));
          let seq = 0;
          for (const o of ops) {
            if (o.op === 'append') {
              now += o.dt;
              const x = rec(seq++, o.key, now);
              expect(ts.append('t', x)).toBe(ref.append('t', x));
            } else if (o.op === 'compact') {
              ts.compact('t');
              ref.compact('t');
            } else {
              expect(ts.read('t', o.from, o.max)).toEqual(ref.read('t', o.from, o.max));
            }
            expect([ts.tail('t'), ts.head('t')]).toEqual([ref.tail('t'), ref.head('t')]);
          }
          expect(ts.read('t', 0, Number.MAX_SAFE_INTEGER)).toEqual(
            ref.read('t', 0, Number.MAX_SAFE_INTEGER),
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

const durable = (retention: Retention): TopicConfig => ({
  ...cfg(retention),
  durability: 'persistent',
});

/** Every record from `from`, paging evicted ones back in as the broker does. */
async function readAll(e: TsEngine, from = 0) {
  const out = [];
  let o = from;
  while (o < e.head('t')) {
    // oxlint-disable-next-line no-await-in-loop -- page by page, in order
    while (!e.readable('t', o)) await e.page('t', o);
    const recs = e.read('t', o, 100);
    const last = recs.at(-1);
    if (!last) break;
    out.push(...recs);
    o = last.offset + 1;
  }
  return out;
}

describe('TsEngine: eviction and replay from disk (M2b task 11)', () => {
  it('keeps only recent chunks in memory and pages older ones back in, in order', async () => {
    const disk = new FakeDisk(50);
    const e = new TsEngine({ chunkSize: 100, residentBytes: 20_000, storage: disk });
    e.createTopic(durable({ kind: 'last-n', n: 1_000_000 }));
    for (let i = 0; i < 5000; i++) e.append('t', rec(i));
    expect(e.chunkCount('t')).toBeLessThan(10);
    expect(e.resident('t')).toBeGreaterThan(0);
    expect(e.readable('t', 0)).toBe(false);
    expect(e.read('t', 0, 10)).toEqual([]);
    const all = await readAll(e);
    expect(all.map((r) => r.value)).toEqual(Array.from({ length: 5000 }, (_, i) => i));
    expect(all.map((r) => r.offset)).toEqual(Array.from({ length: 5000 }, (_, i) => i));
    expect(disk.reads).toBeGreaterThan(5000 / 50 / 2);
  });

  it('leaves memory topics alone', () => {
    const e = new TsEngine({ chunkSize: 100, residentBytes: 10, storage: new FakeDisk() });
    e.createTopic(cfg({ kind: 'last-n', n: 1_000_000 }));
    for (let i = 0; i < 1000; i++) e.append('t', rec(i));
    expect(e.resident('t')).toBe(0);
    expect(e.read('t', 0, 2000)).toHaveLength(1000);
  });

  it('a paged read skips what compaction superseded', async () => {
    const e = new TsEngine({
      chunkSize: 10,
      residentBytes: 2000,
      storage: new FakeDisk(10),
    });
    e.createTopic(durable({ kind: 'compacted' }));
    // Evicted before any compaction ran: the superseded records are on disk only.
    for (let i = 0; i < 300; i++) e.append('t', rec(i, `k${i % 7}`));
    e.compact('t');
    expect(e.resident('t')).toBeGreaterThan(0);
    expect(e.readable('t', 0)).toBe(false);
    const all = await readAll(e);
    // Only the latest of each key is left, as the in-memory compaction would leave it.
    expect(all.map((r) => r.value)).toEqual([293, 294, 295, 296, 297, 298, 299]);
  });

  it('time retention expires evicted chunks whole, once their newest record has expired', () => {
    let now = 0;
    const e = new TsEngine({
      chunkSize: 10,
      residentBytes: 2000,
      storage: new FakeDisk(10),
      now: () => now,
    });
    e.createTopic(durable({ kind: 'time', ms: 100 }));
    for (let i = 0; i < 300; i++) e.append('t', rec(i, undefined, i));
    const resident = e.resident('t');
    expect(resident).toBeGreaterThan(100);
    now = 205; // ts < 105 expires: offsets 0–104
    e.compact('t');
    // Chunks 0–9 … 90–99 go whole; 100–109 holds ts 105–109, so the tail stops at 100.
    expect(e.tail('t')).toBe(100);
    now = 10_000;
    e.compact('t');
    expect(e.tail('t')).toBe(300);
  });

  it('a subscriber from earliest gets every record of a topic larger than memory, in order', async () => {
    const t = topic('big.v1', {
      schema: unchecked<number>(),
      retention: { kind: 'last-n', n: 1_000_000 },
      durability: 'persistent',
    });
    const engine = new TsEngine({ chunkSize: 64, residentBytes: 4096, storage: new FakeDisk(32) });
    const broker = new Broker({ contracts: contracts(t), engine });
    const p = connect(broker, 'P', { publish: ['*'], subscribe: [] });
    for (let i = 0; i < 2000; i++) p.send({ v: 1, t: 'publish', p: { topic: 'big.v1', value: i } });
    await flush();
    expect(engine.resident('big.v1')).toBeGreaterThan(1000);
    const s = connect(broker, 'S', { publish: [], subscribe: ['*'] });
    s.send({ v: 1, t: 'subscribe', p: { topic: 'big.v1', from: 'earliest' } });
    for (let round = 0; round < 500 && s.records('big.v1').length < 2000; round++) {
      // oxlint-disable-next-line no-await-in-loop -- commits as the isolate would
      await flush();
      const last = s.records('big.v1').at(-1);
      // oxlint-disable-next-line no-await-in-loop
      if (last) await s.call('commit', { topic: 'big.v1', offset: last.offset });
    }
    expect(s.values('big.v1')).toEqual(Array.from({ length: 2000 }, (_, i) => i));
  });
});

const id = (seq: number, epoch = 1) => ({ epoch, seq });
const fresh = (disk = new FakeDisk(4)) => {
  const e = new TsEngine({ storage: disk });
  e.createTopic(durable({ kind: 'last-n', n: 1000 }));
  return { e, disk };
};

describe('TsEngine: publish ids on durable topics (M2b task 20)', () => {
  it('remembers each append’s offset by producer, epoch and seq, and never delivers the id', () => {
    const { e } = fresh();
    e.append('t', rec(0), id(1));
    e.append('t', { value: 1, ts: 0, producer: 'q' }, id(1));
    e.append('t', rec(2), id(2));
    expect(e.appended('t', 'p', id(1))).toBe(0);
    expect(e.appended('t', 'q', id(1))).toBe(1);
    expect(e.appended('t', 'p', id(2))).toBe(2);
    expect(e.appended('t', 'p', id(3))).toBeUndefined();
    expect(e.appended('t', 'p', id(1, 2))).toBeUndefined();
    expect(e.read('t', 0, 10)).toEqual([
      { offset: 0, value: 0, ts: 0, producer: 'p' },
      { offset: 1, value: 1, ts: 0, producer: 'q' },
      { offset: 2, value: 2, ts: 0, producer: 'p' },
    ]);
  });

  it('rebuilds them from disk after a restart', async () => {
    const { e, disk } = fresh();
    for (let i = 0; i < 10; i++) e.append('t', rec(i), id(100 + i));
    e.append('t', rec(10)); // no id: the kernel or a seed
    const after = new TsEngine({ storage: disk });
    after.createTopic(durable({ kind: 'last-n', n: 1000 }));
    await after.restore(await disk.open());
    expect(after.appended('t', 'p', id(100))).toBe(0);
    expect(after.appended('t', 'p', id(109))).toBe(9);
    expect(await readAll(after)).toEqual(
      Array.from({ length: 11 }, (_, i) => ({ offset: i, value: i, ts: 0, producer: 'p' })),
    );
  });

  it('forgets an old epoch once the producer appends with a new one', () => {
    const { e } = fresh();
    e.append('t', rec(0), id(1, 1));
    e.append('t', rec(1), id(1, 2));
    expect(e.appended('t', 'p', id(1, 1))).toBeUndefined();
    expect(e.appended('t', 'p', id(1, 2))).toBe(1);
  });

  it(`keeps the producer’s last ${APPENDED_WINDOW} appends per topic`, () => {
    const { e } = fresh(new FakeDisk(256));
    for (let i = 0; i <= APPENDED_WINDOW; i++) e.append('t', rec(i), id(i));
    expect(e.appended('t', 'p', id(0))).toBeUndefined();
    expect(e.appended('t', 'p', id(1))).toBe(1);
    expect(e.appended('t', 'p', id(APPENDED_WINDOW))).toBe(APPENDED_WINDOW);
  });
});
