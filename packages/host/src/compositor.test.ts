import { afterEach, describe, expect, it } from 'vitest';
import { createCompositor } from './compositor';
import type { HostRenderBridge } from './render/bridge';

/** A fake clock and frame queue: `tick()` runs one frame. */
function fakeFrames() {
  const clock = { t: 0 };
  let pending: (() => void)[] = [];
  return {
    clock,
    now: () => clock.t,
    requestFrame: (fn: () => void) => {
      pending.push(fn);
    },
    /** Runs the frames scheduled so far; returns how many ran. */
    tick(): number {
      const run = pending;
      pending = [];
      for (const fn of run) fn();
      return run.length;
    },
    get scheduled() {
      return pending.length;
    },
  };
}

type Applied = { id: string; batch: number; at: number };

/** A bridge whose batches cost `cost(batch)` ms on the fake clock. */
function fakeBridge(
  id: string,
  log: Applied[],
  clock: { t: number },
  cost: (b: number) => number = () => 1,
): HostRenderBridge {
  return {
    fmt: 'fake@1',
    mount() {},
    apply(batch) {
      if (typeof batch !== 'number') return false;
      log.push({ id, batch, at: clock.t });
      clock.t += cost(batch);
      return true;
    },
    unmount() {},
  };
}

const targets: Element[] = [];
afterEach(() => {
  for (const t of targets.splice(0)) t.remove();
});

function setup(budget = 8) {
  const frames = fakeFrames();
  const log: Applied[] = [];
  const compositor = createCompositor({
    frameBudgetMs: budget,
    now: frames.now,
    requestFrame: frames.requestFrame,
  });
  const attach = (id: string, cost?: (b: number) => number) => {
    const target = document.createElement('div');
    document.body.append(target);
    targets.push(target);
    compositor.attach(id, target, fakeBridge(id, log, frames.clock, cost), () => {});
  };
  return { frames, log, compositor, attach };
}

/** The ids applied in the frame that started at `t`. */
const inFrame = (log: Applied[], from: number, to: number) =>
  log.filter((a) => a.at >= from && a.at < to);

describe('compositor frame budget (I8)', () => {
  it('applies at least one batch per frame, even one larger than the budget', () => {
    const { frames, log, compositor, attach } = setup(8);
    attach('A', () => 50);
    compositor.enqueue('A', 1);
    compositor.enqueue('A', 2);
    expect(frames.tick()).toBe(1);
    expect(log.map((a) => a.batch)).toEqual([1]);
    expect(frames.scheduled).toBe(1);
    frames.tick();
    expect(log.map((a) => a.batch)).toEqual([1, 2]);
  });

  it('stops once the budget is spent: at most budget + one batch per frame', () => {
    const { frames, log, compositor, attach } = setup(8);
    attach('A', () => 3);
    for (let b = 0; b < 10; b++) compositor.enqueue('A', b);
    const start = frames.clock.t;
    frames.tick();
    const spent = frames.clock.t - start;
    // 3 ms each: 0, 3, 6 start under 8 ms; the 4th would start at 9.
    expect(log).toHaveLength(3);
    expect(spent).toBeLessThan(8 + 3);
    expect(compositor.stats('A')).toMatchObject({ queued: 7, applied: 3, lastFrameMs: 9 });
  });

  it('never splits a batch and rolls leftovers to later frames', () => {
    const { frames, log, compositor, attach } = setup(8);
    attach('A', () => 5);
    for (let b = 0; b < 5; b++) compositor.enqueue('A', b);
    let frameCount = 0;
    while (frames.tick() > 0) frameCount++;
    expect(log.map((a) => a.batch)).toEqual([0, 1, 2, 3, 4]);
    expect(frameCount).toBe(3); // 2 + 2 + 1
    expect(compositor.stats('A')?.queued).toBe(0);
  });

  it('schedules one frame for many enqueues and none when idle', () => {
    const { frames, compositor, attach } = setup();
    attach('A');
    expect(frames.scheduled).toBe(0);
    for (let b = 0; b < 5; b++) compositor.enqueue('A', b);
    expect(frames.scheduled).toBe(1);
    frames.tick();
    expect(frames.scheduled).toBe(0);
  });
});

describe('compositor fairness', () => {
  it('a chatty isolate with 100 queued batches does not starve one with 1', () => {
    const { frames, log, compositor, attach } = setup(8);
    attach('chatty', () => 2);
    attach('quiet', () => 2);
    for (let b = 0; b < 100; b++) compositor.enqueue('chatty', b);
    compositor.enqueue('quiet', 0);
    const start = frames.clock.t;
    frames.tick();
    const first = inFrame(log, start, frames.clock.t + 1);
    expect(first.some((a) => a.id === 'quiet')).toBe(true);
    expect(first.length).toBeLessThanOrEqual(5);
  });

  it('rotates the starting isolate each frame', () => {
    const { frames, log, compositor, attach } = setup(0);
    for (const id of ['A', 'B', 'C']) attach(id);
    for (let b = 0; b < 3; b++) for (const id of ['A', 'B', 'C']) compositor.enqueue(id, b);
    // Budget 0: exactly one batch per frame, so the first id of each frame shows the rotation.
    const firsts: string[] = [];
    for (let f = 0; f < 3; f++) {
      const before = log.length;
      frames.tick();
      firsts.push(log[before]?.id ?? '-');
    }
    expect(firsts).toEqual(['A', 'B', 'C']);
  });

  it('keeps per-isolate order (FIFO)', () => {
    const { frames, log, compositor, attach } = setup(100);
    attach('A');
    attach('B');
    for (let b = 0; b < 4; b++) {
      compositor.enqueue('A', b);
      compositor.enqueue('B', b);
    }
    frames.tick();
    for (const id of ['A', 'B']) {
      expect(log.filter((a) => a.id === id).map((a) => a.batch)).toEqual([0, 1, 2, 3]);
    }
  });
});

describe('compositor stop and restart', () => {
  it('stopping an isolate drops its queue', () => {
    const { frames, log, compositor, attach } = setup();
    attach('A');
    attach('B');
    compositor.enqueue('A', 1);
    compositor.enqueue('B', 1);
    compositor.detach('A');
    frames.tick();
    expect(log.map((a) => a.id)).toEqual(['B']);
    expect(compositor.stats('A')).toBeUndefined();
  });

  it('a restart drops the queue and counts the dropped batches', () => {
    const { frames, log, compositor, attach } = setup();
    attach('A');
    compositor.enqueue('A', 1);
    compositor.enqueue('A', 2);
    compositor.reset('A', fakeBridge('A2', log, frames.clock));
    frames.tick();
    expect(log).toEqual([]);
    expect(compositor.stats('A')).toMatchObject({ queued: 0, dropped: 2, applied: 0 });
    compositor.enqueue('A', 3);
    frames.tick();
    expect(log.map((a) => [a.id, a.batch])).toEqual([['A2', 3]]);
  });

  it('counts batches the bridge rejects', () => {
    const { frames, compositor, attach } = setup();
    attach('A');
    compositor.enqueue('A', 'not a number');
    compositor.enqueue('A', 1);
    frames.tick();
    expect(compositor.stats('A')).toMatchObject({ applied: 1, rejected: 1 });
  });
});
