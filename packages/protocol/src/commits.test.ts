import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitIntervalProblem, createCommitter, type CommitOffsets } from './commits';

const setup = (o: { intervalMs?: number; credit?: number } = {}) => {
  const sent: CommitOffsets[] = [];
  const c = createCommitter({ send: (x) => sent.push(x), ...o });
  return { c, sent };
};

describe('createCommitter (ADR 0016, decision 1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends one message per interval with each topic’s highest settled offset', () => {
    const { c, sent } = setup();
    c.settle('a', 0);
    c.settle('b', 4);
    c.settle('a', 1);
    c.settle('a', 2);
    vi.advanceTimersByTime(99);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([
      [
        { topic: 'a', offset: 2 },
        { topic: 'b', offset: 4 },
      ],
    ]);
    // Nothing settled since: nothing sent.
    vi.advanceTimersByTime(500);
    expect(sent).toHaveLength(1);
  });

  it('never sends more than one message per interval while records keep settling', () => {
    const { c, sent } = setup({ intervalMs: 100 });
    for (let t = 0; t < 1000; t += 10) {
      c.settle('a', t / 10);
      vi.advanceTimersByTime(10);
    }
    expect(sent.length).toBeLessThanOrEqual(10);
    expect(sent.at(-1)).toEqual([{ topic: 'a', offset: 99 }]);
  });

  it('bounds what a crash can lose to one interval of records', () => {
    // Records settle every 10 ms; at any moment, the last sent offset is at
    // most one interval's worth of records behind the last settled one.
    const { c, sent } = setup({ intervalMs: 100 });
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      c.settle('a', i);
      vi.advanceTimersByTime(10);
      const committed = sent.at(-1)?.[0]?.offset ?? -1;
      worst = Math.max(worst, i - committed);
    }
    expect(worst).toBeLessThanOrEqual(10);
  });

  it('sends early when a subscription reaches half its credit', () => {
    const { c, sent } = setup({ intervalMs: 1000, credit: 10 });
    for (let i = 0; i < 4; i++) c.settle('a', i);
    expect(sent).toEqual([]);
    c.settle('a', 4);
    expect(sent).toEqual([[{ topic: 'a', offset: 4 }]]);
    // The count starts again after a send.
    for (let i = 5; i < 9; i++) c.settle('a', i);
    expect(sent).toHaveLength(1);
    c.settle('a', 9);
    expect(sent).toHaveLength(2);
  });

  it('counts the records a settle covers, for the host’s one-per-delivery settles', () => {
    const { c, sent } = setup({ intervalMs: 1000, credit: 10 });
    c.settle('a', 7, 5);
    expect(sent).toEqual([[{ topic: 'a', offset: 7 }]]);
  });

  it('flush sends at once; dispose stops the timer without sending', () => {
    const { c, sent } = setup();
    c.settle('a', 3);
    c.flush();
    expect(sent).toEqual([[{ topic: 'a', offset: 3 }]]);
    c.flush();
    expect(sent).toHaveLength(1);
    c.settle('a', 4);
    c.dispose();
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(1);
    expect(c.pending().get('a')).toBe(4);
  });

  it('drop forgets a topic’s pending offset', () => {
    const { c, sent } = setup();
    c.settle('a', 3);
    c.settle('b', 1);
    c.drop('a');
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([[{ topic: 'b', offset: 1 }]]);
  });

  it('at 0 ms sends once at the end of each task that settled a record', async () => {
    const { c, sent } = setup({ intervalMs: 0 });
    c.settle('a', 0);
    c.settle('a', 1);
    expect(sent).toEqual([]);
    await Promise.resolve();
    expect(sent).toEqual([[{ topic: 'a', offset: 1 }]]);
    c.settle('a', 2);
    await Promise.resolve();
    expect(sent).toHaveLength(2);
  });
});

describe('commitIntervalProblem', () => {
  it('accepts integers from 0 to 1,000 and nothing else', () => {
    for (const ok of [0, 1, 100, 250, 1000]) expect(commitIntervalProblem(ok)).toBeUndefined();
    for (const bad of [-1, 1001, 1.5, Number.NaN, Infinity, '100', null])
      expect(commitIntervalProblem(bad)).toMatch(/0 to 1000/);
  });
});
