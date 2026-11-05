import type { BusRecord, Retention, TopicConfig } from '@isoloop/protocol';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LogEngine, NewRecord } from '../src/engine/types';

/** Builds a fresh engine for one test. `now` is a fake clock the suite controls. */
export type MakeEngine = (opts: { now: () => number }) => LogEngine;

const cfg = (name: string, retention: Retention): TopicConfig => ({
  name,
  retention,
  requestable: false,
});

const rec = (value: unknown, key?: string, ts = 0): NewRecord =>
  key === undefined ? { value, ts, producer: 'p' } : { key, value, ts, producer: 'p' };

const offsets = (rs: BusRecord[]): number[] => rs.map((r) => r.offset);

const ALL = Number.MAX_SAFE_INTEGER;

const isAscending = (xs: number[]): boolean => xs.every((x, i) => i === 0 || (xs[i - 1] ?? x) < x);

/**
 * The suite every `LogEngine` must pass (design §6.2): the TS engine now, the
 * WASM engine in M5. Includes property-based tests for I5.
 */
export function runEngineConformance(name: string, makeEngine: MakeEngine): void {
  const setup = () => {
    const clock = { t: 1_000_000 };
    const engine = makeEngine({ now: () => clock.t });
    return { engine, clock };
  };
  const filled = () => {
    const s = setup();
    s.engine.createTopic(cfg('t', { kind: 'last-n', n: 100 }));
    for (let i = 0; i < 10; i++) s.engine.append('t', rec(i));
    return s.engine;
  };

  describe(`LogEngine conformance: ${name}`, () => {
    describe('topics and offsets', () => {
      it('starts empty at offset 0', () => {
        const { engine } = setup();
        engine.createTopic(cfg('t', { kind: 'last-n', n: 10 }));
        expect([engine.head('t'), engine.tail('t')]).toEqual([0, 0]);
        expect(engine.read('t', 0, ALL)).toEqual([]);
      });

      it('gives monotonic offsets and stores what was appended', () => {
        const { engine } = setup();
        engine.createTopic(cfg('t', { kind: 'last-n', n: 10 }));
        expect([0, 1, 2].map((i) => engine.append('t', rec(i, `k${i}`, 5)))).toEqual([0, 1, 2]);
        expect(engine.head('t')).toBe(3);
        expect(engine.read('t', 0, ALL)).toEqual([
          { offset: 0, key: 'k0', value: 0, ts: 5, producer: 'p' },
          { offset: 1, key: 'k1', value: 1, ts: 5, producer: 'p' },
          { offset: 2, key: 'k2', value: 2, ts: 5, producer: 'p' },
        ]);
      });

      it('keeps no key field on keyless records', () => {
        const { engine } = setup();
        engine.createTopic(cfg('t', { kind: 'last-n', n: 10 }));
        engine.append('t', rec('x'));
        expect(engine.read('t', 0, 1)[0]).not.toHaveProperty('key');
      });

      it('keeps offsets per topic', () => {
        const { engine } = setup();
        engine.createTopic(cfg('a', { kind: 'last-n', n: 10 }));
        engine.createTopic(cfg('b', { kind: 'last-n', n: 10 }));
        engine.append('a', rec(1));
        engine.append('a', rec(2));
        expect(engine.append('b', rec(3))).toBe(0);
        expect([engine.head('a'), engine.head('b')]).toEqual([2, 1]);
      });

      it('throws on an unknown topic and on creating a topic twice', () => {
        const { engine } = setup();
        engine.createTopic(cfg('t', { kind: 'last-n', n: 10 }));
        expect(() => engine.createTopic(cfg('t', { kind: 'last-n', n: 10 }))).toThrow();
        expect(() => engine.append('nope', rec(1))).toThrow();
        expect(() => engine.read('nope', 0, 1)).toThrow();
        expect(() => engine.head('nope')).toThrow();
      });
    });

    describe('read ranges', () => {
      it('reads from an offset, at most max records', () => {
        const engine = filled();
        expect(offsets(engine.read('t', 3, 4))).toEqual([3, 4, 5, 6]);
        expect(offsets(engine.read('t', 8, 100))).toEqual([8, 9]);
      });

      it('returns nothing at or past head, or for max 0', () => {
        const engine = filled();
        expect(engine.read('t', 10, 5)).toEqual([]);
        expect(engine.read('t', 50, 5)).toEqual([]);
        expect(engine.read('t', 0, 0)).toEqual([]);
      });
    });

    describe('last-n retention', () => {
      it('keeps the newest n on append', () => {
        const { engine } = setup();
        engine.createTopic(cfg('t', { kind: 'last-n', n: 3 }));
        for (let i = 0; i < 7; i++) engine.append('t', rec(i));
        expect([engine.tail('t'), engine.head('t')]).toEqual([4, 7]);
        expect(offsets(engine.read('t', 0, ALL))).toEqual([4, 5, 6]);
        expect(offsets(engine.read('t', 5, ALL))).toEqual([5, 6]);
      });

      it('drops many records over many appends', () => {
        const { engine } = setup();
        engine.createTopic(cfg('t', { kind: 'last-n', n: 10 }));
        for (let i = 0; i < 10_000; i++) engine.append('t', rec(i));
        expect(engine.tail('t')).toBe(9_990);
        expect(engine.read('t', 0, ALL).map((r) => r.value)).toEqual(
          Array.from({ length: 10 }, (_, i) => 9_990 + i),
        );
      });
    });

    describe('time retention', () => {
      it('drops records older than ms on compact, by the engine clock', () => {
        const { engine, clock } = setup();
        engine.createTopic(cfg('t', { kind: 'time', ms: 1_000 }));
        engine.append('t', rec('old', undefined, clock.t));
        clock.t += 600;
        engine.append('t', rec('mid', undefined, clock.t));
        clock.t += 600;
        engine.append('t', rec('new', undefined, clock.t));
        engine.compact('t');
        expect(engine.read('t', 0, ALL).map((r) => r.value)).toEqual(['mid', 'new']);
        expect(engine.tail('t')).toBe(1);
        clock.t += 5_000;
        engine.compact('t');
        expect(engine.read('t', 0, ALL)).toEqual([]);
        expect([engine.tail('t'), engine.head('t')]).toEqual([3, 3]);
        expect(engine.append('t', rec('next', undefined, clock.t))).toBe(3);
      });
    });

    describe('compacted retention', () => {
      it('keeps the latest record per key, in offset order, and keyless records', () => {
        const { engine } = setup();
        engine.createTopic(cfg('t', { kind: 'compacted' }));
        for (const [k, v] of [
          ['a', 1],
          ['b', 2],
          ['a', 3],
          [undefined, 4],
          ['c', 5],
          ['b', 6],
        ] as const) {
          engine.append('t', rec(v, k));
        }
        engine.compact('t');
        expect(engine.read('t', 0, ALL).map((r) => [r.offset, r.key, r.value])).toEqual([
          [2, 'a', 3],
          [3, undefined, 4],
          [4, 'c', 5],
          [5, 'b', 6],
        ]);
        expect([engine.tail('t'), engine.head('t')]).toEqual([2, 6]);
      });

      it('never reuses offsets after compaction', () => {
        const { engine } = setup();
        engine.createTopic(cfg('t', { kind: 'compacted' }));
        engine.append('t', rec(1, 'a'));
        engine.append('t', rec(2, 'a'));
        engine.compact('t');
        expect(engine.append('t', rec(3, 'a'))).toBe(2);
      });
    });

    describe('commits', () => {
      it('are kept per topic and per consumer', () => {
        const { engine } = setup();
        engine.createTopic(cfg('a', { kind: 'last-n', n: 10 }));
        engine.createTopic(cfg('b', { kind: 'last-n', n: 10 }));
        expect(engine.committed('a', 'x')).toBeUndefined();
        engine.commit('a', 'x', 4);
        engine.commit('a', 'y', 1);
        engine.commit('b', 'x', 9);
        expect([engine.committed('a', 'x'), engine.committed('a', 'y')]).toEqual([4, 1]);
        expect(engine.committed('b', 'x')).toBe(9);
        engine.commit('a', 'x', 6);
        expect(engine.committed('a', 'x')).toBe(6);
      });

      it('survive the records they name being dropped', () => {
        const { engine } = setup();
        engine.createTopic(cfg('t', { kind: 'last-n', n: 2 }));
        engine.append('t', rec(0));
        engine.commit('t', 'x', 0);
        for (let i = 1; i < 10; i++) engine.append('t', rec(i));
        expect(engine.committed('t', 'x')).toBe(0);
      });
    });

    describe('properties (I5)', () => {
      type Op = { op: 'append'; key: string | undefined } | { op: 'compact' };
      const ops = fc.array(
        fc.oneof(
          {
            weight: 8,
            arbitrary: fc.record({
              op: fc.constant('append' as const),
              key: fc.option(fc.constantFrom('a', 'b', 'c', 'd'), { nil: undefined }),
            }),
          },
          { weight: 1, arbitrary: fc.record({ op: fc.constant('compact' as const) }) },
        ),
        { maxLength: 300 },
      );
      const retentions = fc.oneof(
        fc.constant<Retention>({ kind: 'compacted' }),
        fc.integer({ min: 1, max: 50 }).map((n): Retention => ({ kind: 'last-n', n })),
      );

      /** Runs the ops; each append's value is its sequence number. */
      const run = (retention: Retention, list: Op[]) => {
        const { engine } = setup();
        engine.createTopic(cfg('t', retention));
        const appended: { offset: number; key: string | undefined }[] = [];
        for (const o of list) {
          if (o.op === 'compact') engine.compact('t');
          else
            appended.push({ offset: engine.append('t', rec(appended.length, o.key)), key: o.key });
        }
        return { engine, appended };
      };

      it('offsets are 0, 1, 2… and reads are ascending, within [tail, head)', () => {
        fc.assert(
          fc.property(retentions, ops, (retention, list) => {
            const { engine, appended } = run(retention, list);
            expect(appended.map((a) => a.offset)).toEqual(appended.map((_, i) => i));
            const got = offsets(engine.read('t', 0, ALL));
            expect(isAscending(got)).toBe(true);
            expect(engine.head('t')).toBe(appended.length);
            if (got.length > 0) expect(got[0]).toBe(engine.tail('t'));
            else expect(engine.tail('t')).toBe(engine.head('t'));
            for (const r of engine.read('t', 0, ALL)) expect(r.value).toBe(r.offset);
          }),
        );
      });

      it('per-key order survives appends and compaction', () => {
        fc.assert(
          fc.property(retentions, ops, (retention, list) => {
            const { engine } = run(retention, list);
            const byKey = new Map<string | undefined, number[]>();
            for (const r of engine.read('t', 0, ALL)) {
              byKey.set(r.key, [...(byKey.get(r.key) ?? []), r.offset]);
            }
            for (const seq of byKey.values()) expect(isAscending(seq)).toBe(true);
          }),
        );
      });

      it('after compact, a compacted topic holds exactly the latest record per key', () => {
        fc.assert(
          fc.property(ops, (list) => {
            const { engine, appended } = run({ kind: 'compacted' }, list);
            engine.compact('t');
            const latest = new Map<string, number>();
            for (const a of appended) if (a.key !== undefined) latest.set(a.key, a.offset);
            const expected = appended
              .filter((a) => a.key === undefined || latest.get(a.key) === a.offset)
              .map((a) => a.offset);
            expect(offsets(engine.read('t', 0, ALL))).toEqual(expected);
          }),
        );
      });

      it('a last-n topic holds exactly the newest n', () => {
        fc.assert(
          fc.property(fc.integer({ min: 1, max: 50 }), ops, (n, list) => {
            const { engine, appended } = run({ kind: 'last-n', n }, list);
            const expected = appended.slice(-n).map((a) => a.offset);
            expect(offsets(engine.read('t', 0, ALL))).toEqual(expected);
          }),
        );
      });

      it('chunked reads return the same records as one read', () => {
        fc.assert(
          fc.property(retentions, ops, fc.integer({ min: 1, max: 20 }), (retention, list, max) => {
            const { engine } = run(retention, list);
            const whole = engine.read('t', 0, ALL);
            const parts: BusRecord[] = [];
            let from = 0;
            for (;;) {
              const page = engine.read('t', from, max);
              if (page.length === 0) break;
              expect(page.length).toBeLessThanOrEqual(max);
              parts.push(...page);
              from = (page.at(-1)?.offset ?? from) + 1;
            }
            expect(parts).toEqual(whole);
          }),
        );
      });
    });
  });
}
