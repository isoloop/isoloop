import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitIntervalProblem,
  createCommitter,
  deliveryPoints,
  type CommitOffsets,
} from './commits';

/** Settled through `offset`, in its own delivery: seq follows the offset in these tests. */
const at = (offset: number) => ({ offset, seq: offset });

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
    c.settle('a', at(0));
    c.settle('b', at(4));
    c.settle('a', at(1));
    c.settle('a', at(2));
    vi.advanceTimersByTime(99);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([
      [
        { topic: 'a', offset: 2, seq: 2 },
        { topic: 'b', offset: 4, seq: 4 },
      ],
    ]);
    // Nothing settled since: nothing sent.
    vi.advanceTimersByTime(500);
    expect(sent).toHaveLength(1);
  });

  it('never sends more than one message per interval while records keep settling', () => {
    const { c, sent } = setup({ intervalMs: 100 });
    for (let t = 0; t < 1000; t += 10) {
      c.settle('a', at(t / 10));
      vi.advanceTimersByTime(10);
    }
    expect(sent.length).toBeLessThanOrEqual(10);
    expect(sent.at(-1)).toEqual([{ topic: 'a', offset: 99, seq: 99 }]);
  });

  it('bounds what a crash can lose to one interval of records', () => {
    // Records settle every 10 ms; at any moment, the last sent offset is at
    // most one interval's worth of records behind the last settled one.
    const { c, sent } = setup({ intervalMs: 100 });
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      c.settle('a', at(i));
      vi.advanceTimersByTime(10);
      const committed = sent.at(-1)?.[0]?.offset ?? -1;
      worst = Math.max(worst, i - committed);
    }
    expect(worst).toBeLessThanOrEqual(10);
  });

  it('sends early when a subscription reaches half its credit', () => {
    const { c, sent } = setup({ intervalMs: 1000, credit: 10 });
    for (let i = 0; i < 4; i++) c.settle('a', at(i));
    expect(sent).toEqual([]);
    c.settle('a', at(4));
    expect(sent).toEqual([[{ topic: 'a', offset: 4, seq: 4 }]]);
    // The count starts again after a send.
    for (let i = 5; i < 9; i++) c.settle('a', at(i));
    expect(sent).toHaveLength(1);
    c.settle('a', at(9));
    expect(sent).toHaveLength(2);
  });

  it('counts the records a settle covers, for the host’s one-per-delivery settles', () => {
    const { c, sent } = setup({ intervalMs: 1000, credit: 10 });
    c.settle('a', at(7), 5);
    expect(sent).toEqual([[{ topic: 'a', offset: 7, seq: 7 }]]);
  });

  it('flush sends at once; dispose stops the timer without sending', () => {
    const { c, sent } = setup();
    c.settle('a', at(3));
    c.flush();
    expect(sent).toEqual([[{ topic: 'a', offset: 3, seq: 3 }]]);
    c.flush();
    expect(sent).toHaveLength(1);
    c.settle('a', at(4));
    c.dispose();
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(1);
    expect(c.pending().get('a')).toEqual({ offset: 4, seq: 4 });
  });

  it('drop forgets a topic’s pending offset', () => {
    const { c, sent } = setup();
    c.settle('a', at(3));
    c.settle('b', at(1));
    c.drop('a');
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([[{ topic: 'b', offset: 1, seq: 1 }]]);
  });

  it('at 0 ms sends once at the end of each task that settled a record', async () => {
    const { c, sent } = setup({ intervalMs: 0 });
    c.settle('a', at(0));
    c.settle('a', at(1));
    expect(sent).toEqual([]);
    await Promise.resolve();
    expect(sent).toEqual([[{ topic: 'a', offset: 1, seq: 1 }]]);
    c.settle('a', at(2));
    await Promise.resolve();
    expect(sent).toHaveLength(2);
  });
});

describe('delivery seq in commits (ADR 0016, points 10–12 and 17)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('settles a delivery whole with its last record, and its first records before that', () => {
    expect(deliveryPoints(3, [10, 11, 12], 9)).toEqual([
      { offset: 10, seq: 2, partial: 1 },
      { offset: 11, seq: 2, partial: 2 },
      { offset: 12, seq: 3 },
    ]);
    // An empty delivery (a gap alone) settles nothing by itself.
    expect(deliveryPoints(4, [], 12)).toEqual([]);
  });

  it('keeps the highest offset delivered so far for a redelivered lower one', () => {
    // A group member settled 0 and 2 (delivery 1); 1 and 3 come back to it
    // in delivery 2 after another member left.
    expect(deliveryPoints(2, [1, 3], 2)).toEqual([
      { offset: 2, seq: 1, partial: 1 },
      { offset: 3, seq: 2 },
    ]);
  });

  it('a partly settled delivery leaves seq at the delivery before it, with its settled records counted', () => {
    const { c, sent } = setup();
    const [a, b] = deliveryPoints(1, [0, 2], -1);
    const [r1] = deliveryPoints(2, [1, 3], 2);
    for (const p of [a, b, r1]) if (p) c.settle('t', p);
    vi.advanceTimersByTime(100);
    // Offset 2 is reached, but delivery 2 (1 and 3) isn't settled whole:
    // the broker covers 0 and 2, and of delivery 2 only its first record, 1.
    expect(sent).toEqual([[{ topic: 't', offset: 2, seq: 1, partial: 1 }]]);
  });

  it('keeps offset and seq as separate highs', () => {
    const { c } = setup();
    c.settle('t', { offset: 5, seq: 1 });
    c.settle('t', { offset: 3, seq: 2 });
    expect(c.pending().get('t')).toEqual({ offset: 5, seq: 2 });
  });

  it('a whole delivery is further than any part of it, and a later part further than an earlier one', () => {
    const { c } = setup();
    c.settle('t', { offset: 4, seq: 1, partial: 1 });
    c.settle('t', { offset: 5, seq: 1, partial: 2 });
    expect(c.pending().get('t')).toEqual({ offset: 5, seq: 1, partial: 2 });
    c.settle('t', { offset: 6, seq: 2 });
    expect(c.pending().get('t')).toEqual({ offset: 6, seq: 2 });
  });

  it('a stuck subscription stops at the delivery before the record that threw', () => {
    // Records 0..4 in delivery 1, 5..9 in delivery 2. The handler throws on 7:
    // nothing from 7 on is settled.
    const { c, sent } = setup();
    const points = [
      ...deliveryPoints(1, [0, 1, 2, 3, 4], -1),
      ...deliveryPoints(2, [5, 6, 7, 8, 9], 4),
    ];
    for (const p of points.slice(0, 7)) c.settle('t', p);
    vi.advanceTimersByTime(100);
    // 5 and 6, the records of delivery 2 before 7, are settled too.
    expect(sent).toEqual([[{ topic: 't', offset: 6, seq: 1, partial: 2 }]]);
  });

  it('the early send at half the credit carries the seq settled so far', () => {
    const { c, sent } = setup({ intervalMs: 1000, credit: 8 });
    const points = [...deliveryPoints(1, [0, 1], -1), ...deliveryPoints(2, [2, 3, 4], 1)];
    for (const p of points.slice(0, 4)) c.settle('t', p);
    expect(sent).toEqual([[{ topic: 't', offset: 3, seq: 1, partial: 2 }]]);
  });

  it('take, on shutdown, returns the commit point pending and clears it', () => {
    const { c, sent } = setup();
    for (const p of deliveryPoints(1, [0, 1], -1)) c.settle('t', p);
    const [first] = deliveryPoints(2, [2, 3], 1);
    if (first) c.settle('t', first);
    expect(c.take()).toEqual([{ topic: 't', offset: 2, seq: 1, partial: 1 }]);
    expect(c.take()).toBeUndefined();
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([]);
  });
});

describe('commitIntervalProblem', () => {
  it('accepts integers from 0 to 1,000 and nothing else', () => {
    for (const ok of [0, 1, 100, 250, 1000]) expect(commitIntervalProblem(ok)).toBeUndefined();
    for (const bad of [-1, 1001, 1.5, Number.NaN, Infinity, '100', null])
      expect(commitIntervalProblem(bad)).toMatch(/0 to 1000/);
  });
});
