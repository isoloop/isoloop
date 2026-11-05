import type { Retention, TopicConfig } from '@isoloop/protocol';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runEngineConformance } from '../../test/engine-conformance';
import { ReferenceEngine } from '../../test/reference-engine';
import { TsEngine } from './ts-engine';

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
