import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { balance } from './balancer';
import { memoryLoads, SimKernel } from './sim';
import type { BalancerOf, BalancerOptions, FailedEvent, MoveEvent } from './types';

let sim: SimKernel;
let balancer: BalancerOf;
let moves: MoveEvent[];

const start = (opts: BalancerOptions = {}, sim_ = new SimKernel()): void => {
  sim = sim_;
  balancer = balance(sim, { maxWorkers: 10, ...opts });
  moves = [];
  balancer.on('move', (e) => moves.push(e));
};

const wait = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

const where = (id: string) => balancer.placements().find((p) => p.id === id);

/** Two long tasks from `id` a second apart: a first spike is only noted, a second quarantines (M3i). */
const spikeTwice = async (id: string, ms = 300): Promise<void> => {
  sim.burst(id, ms);
  await wait(1_000);
  sim.burst(id, ms);
  await wait(300);
};

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'],
  });
});

afterEach(() => {
  balancer.dispose();
  sim.dispose();
  vi.useRealTimers();
});

describe('placement', () => {
  it('keeps light, measured isolates together and never moves them', async () => {
    start({ loads: memoryLoads({ a: 5, b: 5, c: 5 }) });
    for (const id of ['a', 'b', 'c']) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    expect(balancer.placements().map((p) => p.pool)).toEqual([
      'balancer-1',
      'balancer-1',
      'balancer-1',
    ]);
    await wait(60_000);
    expect(moves).toEqual([]);
    expect(balancer.placements().every((p) => p.state === 'placed')).toBe(true);
  });

  it('gives a measured heavy isolate a pool of its own', async () => {
    start({ loads: memoryLoads({ a: 5, h: 70 }) });
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 'h' });
    expect(where('a')?.pool).toBe('balancer-1');
    expect(where('h')?.pool).toBe('balancer-2');
  });

  it('starts a never-measured isolate in quarantine, and places it as soon as it is measured', async () => {
    const loads = memoryLoads({ a: 5 });
    start({ loads });
    sim.load('a', 5);
    sim.load('n', 10);
    balancer.spawn({ id: 'a' });
    expect(balancer.spawn({ id: 'n' })).toMatchObject({
      pool: 'balancer-quarantine-1',
      state: 'quarantined',
    });
    // Under 3 s of beats: no measurement yet.
    await wait(2_000);
    expect(where('n')?.state).toBe('quarantined');
    // Measured: it leaves at the next decision, with no 30 s steady window (Q5).
    await wait(2_500);
    expect(moves).toEqual([
      { id: 'n', from: 'balancer-quarantine-1', to: 'balancer-1', reason: 'steady' },
    ]);
    expect(where('n')).toMatchObject({ pool: 'balancer-1', state: 'placed' });
    await wait(20_000);
    expect(loads.all.get('n')).toBeCloseTo(10, 0);
  });

  it('rejects a manifest that names a pool', () => {
    start();
    expect(() => balancer.spawn({ id: 'a', pool: 'p' })).toThrow(/names a pool/);
  });
});

describe('sustained load', () => {
  it('moves the heavy member out, keeps the light ones together, and settles', async () => {
    start({ loads: memoryLoads({ a: 5, b: 5, h: 5 }) });
    for (const id of ['a', 'b', 'h']) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    await wait(5_000);
    sim.load('h', 70);
    await wait(5_000);
    expect(moves).toEqual([{ id: 'h', from: 'balancer-1', to: 'balancer-2', reason: 'sustained' }]);
    expect(where('a')?.pool).toBe('balancer-1');
    expect(where('b')?.pool).toBe('balancer-1');
    // No flapping: the heavy one stays apart and nothing else moves.
    await wait(120_000);
    expect(moves).toHaveLength(1);
  });

  it('respects the worker cap: no pool beyond it, the mover stays and is flagged', async () => {
    // maxWorkers 1: balancer-1 only (the quarantine is allowed on top).
    start({ maxWorkers: 1, loads: memoryLoads({ a: 5, h: 5 }) });
    sim.load('a', 5);
    sim.load('h', 5);
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 'h' });
    // Not enough to spike, enough to stay over the sustained threshold.
    sim.load('h', 75);
    await wait(10_000);
    expect(moves).toEqual([]);
    expect(where('h')).toMatchObject({ pool: 'balancer-1', atCap: true });
    expect(sim.peakBalancerPools).toBeLessThanOrEqual(1);
  });

  it('counts only its own pools toward the cap, however many workers the page runs', () => {
    start({ maxWorkers: 2, loads: memoryLoads({ a: 50, b: 50, c: 50 }) });
    // A busy page: workers the app runs itself don't count (ADR 0017, amended).
    sim.spawn({ id: 'dashboard' });
    for (let i = 1; i <= 8; i++) sim.spawn({ id: `data-${i}`, pool: `data-${i}` });
    expect(balancer.spawn({ id: 'a' })).toMatchObject({ pool: 'balancer-1' });
    expect(balancer.spawn({ id: 'b' })).toMatchObject({ pool: 'balancer-2' });
    expect(where('b')?.atCap).toBeUndefined();
    // A third pool would pass the allowance of 2.
    expect(balancer.spawn({ id: 'c' })).toMatchObject({ atCap: true });
    expect(sim.peakBalancerPools).toBe(2);
  });

  it('allows the quarantine on top of the cap', async () => {
    start({ maxWorkers: 1, loads: memoryLoads({ a: 5, s: 5 }) });
    for (const id of ['a', 's']) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    await wait(1_000);
    await spikeTwice('s', 400);
    expect(where('s')).toMatchObject({ pool: 'balancer-quarantine-1', state: 'quarantined' });
    expect(sim.peakBalancerPools).toBe(1);
  });
});

describe('a full pool (Q15)', () => {
  it('moves the heaviest member out of a pool at 80 % or more, even with no lag', async () => {
    // Work that yields often: the pool is full, but its lag stays low.
    start({ loads: memoryLoads({ a: 20, b: 20, h: 15 }) });
    for (const id of ['a', 'b', 'h']) {
      sim.load(id, 15);
      balancer.spawn({ id });
    }
    expect(new Set(balancer.placements().map((p) => p.pool))).toEqual(new Set(['balancer-1']));
    await wait(5_000);
    expect(moves).toEqual([]);
    sim.load('h', 55);
    sim.hidden('h', -40); // keeps the simulated lag under the sustained threshold
    await wait(5_000);
    expect(moves).toEqual([{ id: 'h', from: 'balancer-1', to: 'balancer-2', reason: 'full' }]);
    expect(where('a')?.pool).toBe('balancer-1');
    // Below 80 % now (a + b = 30 %): nothing else moves.
    await wait(60_000);
    expect(moves).toHaveLength(1);
  });

  it('reports a pool that is full and lagging as sustained', async () => {
    start({ loads: memoryLoads({ a: 20, b: 20, h: 15 }) });
    for (const id of ['a', 'b', 'h']) {
      sim.load(id, 15);
      balancer.spawn({ id });
    }
    await wait(2_000);
    sim.load('h', 55); // 85 % in all, and the simulated lag goes over 50 ms
    await wait(5_000);
    expect(moves).toEqual([{ id: 'h', from: 'balancer-1', to: 'balancer-2', reason: 'sustained' }]);
  });

  it('leaves a full pool alone between 60 % and 80 %', async () => {
    start({ loads: memoryLoads({ a: 20, b: 20 }) });
    for (const id of ['a', 'b']) {
      sim.load(id, 20);
      balancer.spawn({ id });
    }
    await wait(2_000);
    sim.load('a', 35);
    sim.load('b', 35);
    await wait(30_000);
    expect(moves).toEqual([]);
  });
});

describe('spikes and quarantine', () => {
  it('notes a first spike, quarantines on a second within 60 s, and lets it back once steady', async () => {
    start({ loads: memoryLoads({ a: 5, s: 5 }) });
    const spikes: unknown[] = [];
    balancer.on('spike', (e) => spikes.push(e));
    sim.load('a', 5);
    sim.load('s', 5);
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 's' });
    await wait(1_000);
    sim.burst('s', 300);
    await wait(300);
    // One long task is only noted: nothing moves.
    expect(moves).toEqual([]);
    expect(spikes).toEqual([
      expect.objectContaining({ id: 's', pool: 'balancer-1', action: 'noted' }),
    ]);
    await wait(1_000);
    sim.burst('s', 300);
    await wait(300);
    expect(spikes.at(-1)).toMatchObject({ id: 's', action: 'quarantined' });
    expect(moves).toEqual([
      { id: 's', from: 'balancer-1', to: 'balancer-quarantine-1', reason: 'spike' },
    ]);
    expect(where('a')?.pool).toBe('balancer-1');
    await wait(31_000);
    expect(moves.at(-1)).toEqual({
      id: 's',
      from: 'balancer-quarantine-1',
      to: 'balancer-1',
      reason: 'steady',
    });
  });

  it('lets a heavy offender out after its quiet window, whatever its load (Q18)', async () => {
    start({ loads: memoryLoads({ a: 5, s: 5 }) });
    sim.load('a', 5);
    sim.load('s', 5);
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 's' });
    await wait(1_000);
    await spikeTwice('s');
    expect(where('s')?.state).toBe('quarantined');
    // Heavy but quiet: no spike, no crash.
    sim.load('s', 45);
    await wait(31_000);
    expect(moves.at(-1)).toMatchObject({
      id: 's',
      from: 'balancer-quarantine-1',
      reason: 'steady',
    });
    expect(where('s')?.state).toBe('placed');
  });

  it('keeps a quiet offender in quarantine, flagged at the cap, until a pool has room', async () => {
    start({ maxWorkers: 1, loads: memoryLoads({ a: 50, s: 5 }) });
    sim.load('a', 50);
    sim.load('s', 5);
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 's' });
    await wait(1_000);
    await spikeTwice('s');
    expect(where('s')?.state).toBe('quarantined');
    sim.load('s', 30);
    await wait(31_000);
    // 50 + 30 is over the 60 % headroom, and maxWorkers 1 allows no second pool.
    expect(where('s')).toMatchObject({ pool: 'balancer-quarantine-1', atCap: true });
    sim.load('a', 10);
    await wait(5_000);
    expect(where('s')).toMatchObject({ pool: 'balancer-1', state: 'placed' });
    expect(where('s')?.atCap).toBeUndefined();
  });

  it('doubles the steady window on each re-offence, then keeps a repeat offender apart', async () => {
    start({ loads: memoryLoads({ a: 5, s: 5 }) });
    sim.load('a', 5);
    sim.load('s', 5);
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 's' });
    await wait(1_000);
    const backAfter: number[] = [];
    // Rounds one after another, in fake time.
    /* oxlint-disable no-await-in-loop */
    for (let round = 0; round < 3; round++) {
      await spikeTwice('s');
      expect(where('s')?.state).toBe('quarantined');
      const t = performance.now();
      while (where('s')?.state !== 'placed') await wait(500);
      backAfter.push(Math.round((performance.now() - t) / 1000));
      await wait(1_000);
    }
    /* oxlint-enable no-await-in-loop */
    expect(backAfter[0]).toBeGreaterThanOrEqual(30);
    expect(backAfter[1]).toBeGreaterThanOrEqual(60);
    expect(backAfter[2]).toBeGreaterThanOrEqual(120);
    await spikeTwice('s');
    expect(where('s')).toMatchObject({ pool: 'balancer-quarantine-1', state: 'kept-apart' });
    await wait(600_000);
    expect(where('s')?.state).toBe('kept-apart');
  });

  it('a spike in the quarantine never touches the healthy pools', async () => {
    start({ loads: memoryLoads({ a: 5, b: 5 }) });
    for (const id of ['a', 'b']) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    sim.load('n', 5);
    balancer.spawn({ id: 'n' });
    await wait(1_000);
    // Twice: an offender now, it stays its 30 s instead of leaving once measured.
    await spikeTwice('n');
    await wait(5_000);
    expect(moves).toEqual([]);
    expect(where('a')?.pool).toBe('balancer-1');
  });

  it('quarantines a member whose own fatal error crashed it', async () => {
    start({ loads: memoryLoads({ a: 5, e: 5 }) });
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 'e' });
    // The real kernel emits this when the isolate sends a fatal `error`.
    sim.crash({ id: 'e', reason: 'error', pool: 'balancer-1' });
    await wait(100);
    expect(moves).toEqual([
      { id: 'e', from: 'balancer-1', to: 'balancer-quarantine-1', reason: 'crash' },
    ]);
  });
});

describe('a pool killed for blocking', () => {
  it('bisects to the member that blocks; the others end up placed', async () => {
    start({ loads: memoryLoads({ a: 5, b: 5, c: 5, d: 5 }) });
    for (const id of ['a', 'b', 'c', 'd']) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    await wait(1_000);
    sim.block('c');
    await wait(30_000);
    expect(moves.some((m) => m.reason === 'bisect')).toBe(true);
    expect(where('c')?.state).toMatch(/quarantined|kept-apart/);
    // The culprit is found within log2(4) kills, and the bisect moved at most n - 1 others.
    expect(
      new Set(moves.filter((m) => m.reason === 'bisect').map((m) => m.id)).size,
    ).toBeLessThanOrEqual(3);
    sim.unblock('c');
    await wait(400_000);
    for (const id of ['a', 'b', 'd']) expect(where(id)?.state).toBe('placed');
    expect(where('c')?.pool).toMatch(/^balancer-quarantine/);
  });
});

describe('when busyMs explains too little', () => {
  it('bisects instead of moving the busiest member, and keeps the others away from the culprit', async () => {
    start({ loads: memoryLoads({ a: 1, b: 1, c: 1, d: 1 }) });
    for (const id of ['a', 'b', 'c', 'd']) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    // a looks busiest, but c costs its worker 70 % that busyMs doesn't show.
    sim.load('a', 8);
    sim.hidden('c', 70);
    await wait(8_000);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves[0]?.reason).toBe('bisect');
    expect(moves.some((m) => m.reason === 'sustained' && m.id === 'a')).toBe(false);
    // Quiet is enough to leave quarantine (Q18), so c comes back after each
    // window, is found again, and stays apart in the end; the move budget
    // (M3i, 3 moves for load in 5 min) also slows how often it comes back.
    await wait(600_000);
    expect(where('c')?.state).toMatch(/quarantined|kept-apart/);
    expect(moves.filter((m) => m.id === 'c' && m.reason === 'steady').length).toBeLessThanOrEqual(
      3,
    );
    expect(where('c')?.pool).toMatch(/^balancer-quarantine-/);
    const cPool = where('c')?.pool;
    for (const id of ['a', 'b', 'd']) {
      expect(where(id)?.state).toBe('placed');
      expect(where(id)?.pool).not.toBe(cPool);
    }
  });

  it('bisects on a second spike that busyMs does not explain', async () => {
    start({ loads: memoryLoads({ a: 1, b: 1, c: 1, d: 1 }) });
    for (const id of ['a', 'b', 'c', 'd']) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    await wait(1_000);
    sim.hidden('d', 200);
    await wait(150);
    sim.hidden('d', 0);
    await wait(500);
    // A first unexplained spike is only noted (M3i); the pool's second bisects.
    expect(moves).toEqual([]);
    sim.hidden('d', 200);
    await wait(100);
    sim.hidden('d', 0);
    await wait(500);
    expect(moves.map((m) => m.reason)).toEqual(['bisect', 'bisect']);
  });
});

describe('after a move', () => {
  it("moves the next-heaviest member when the source pool's lag doesn't fall", async () => {
    const ids = ['h1', 'h2', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'];
    start({ loads: memoryLoads(Object.fromEntries(ids.map((id) => [id, 1]))) });
    for (const id of ids) balancer.spawn({ id });
    // 12 + 11 + 7 × 9.5 = 89.5 % of a beat: over the sustained threshold, under a spike.
    sim.load('h1', 12);
    sim.load('h2', 11);
    for (const id of ids.slice(2)) sim.load(id, 9.5);
    await wait(5_000);
    expect(moves).toEqual([
      { id: 'h1', from: 'balancer-1', to: 'balancer-2', reason: 'sustained' },
    ]);
    // Without h1, balancer-1 is still at 77.5 %: the next window moves h2.
    await wait(5_000);
    expect(moves).toEqual([
      { id: 'h1', from: 'balancer-1', to: 'balancer-2', reason: 'sustained' },
      { id: 'h2', from: 'balancer-1', to: 'balancer-2', reason: 'sustained' },
    ]);
    await wait(60_000);
    expect(moves).toHaveLength(2);
  });

  it('after a move that did not help, a held heaviest member no longer blocks the next one', async () => {
    const ids = ['h1', 'h2', 'h3', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6'];
    start({ loads: memoryLoads(Object.fromEntries(ids.map((id) => [id, 1]))) });
    for (const id of ids) balancer.spawn({ id });
    sim.load('h1', 13);
    sim.load('h2', 12);
    sim.load('h3', 11);
    // 13 + 12 + 11 + 6 × 9.2 = 91.2 %; without h1, 78.2 %: still over.
    for (const id of ids.slice(3)) sim.load(id, 9.2);
    await wait(5_000);
    expect(moves.map((m) => m.id)).toEqual(['h1']);
    balancer.hold('h2');
    await wait(5_000);
    expect(moves.map((m) => m.id)).toEqual(['h1', 'h3']);
  });
});

describe('one balancer per kernel', () => {
  it('a second balancer on the same kernel throws balancer_exists', () => {
    start();
    expect(() => balance(sim)).toThrow(expect.objectContaining({ code: 'balancer_exists' }));
  });

  it('allows a new balancer once the first is disposed; the old one spawns nothing', async () => {
    start({}, new SimKernel());
    const first = balancer;
    first.spawn({ id: 'a' });
    first.dispose();
    first.dispose(); // twice is harmless
    expect(() => first.spawn({ id: 'b' })).toThrow(/disposed/);
    // The kernel's claim is free again.
    balancer = balance(sim, { maxWorkers: 10 });
    expect(() => balancer.spawn({ id: 'c' })).not.toThrow();
    // And held again by the new one.
    expect(() => balance(sim)).toThrow(expect.objectContaining({ code: 'balancer_exists' }));
    await wait(100);
  });

  it("rejects a kernel that has no claim of its own and isn't the host's", () => {
    start();
    const plain = {
      spawn: () => {},
      stop: async () => {},
      isolates: () => [],
      pools: () => [],
      on: () => () => {},
    };
    expect(() => balance(plain)).toThrow(expect.objectContaining({ code: 'invalid_config' }));
  });

  it("names its pools balancer-N and its quarantines balancer-quarantine-N, which plain spawn can't use", () => {
    start({ loads: memoryLoads({ a: 5, h: 70 }) });
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 'h' });
    balancer.spawn({ id: 'n' });
    expect(balancer.placements().map((p) => p.pool)).toEqual([
      'balancer-1',
      'balancer-2',
      'balancer-quarantine-1',
    ]);
    expect(() => sim.spawn({ id: 'x', pool: 'balancer-1' })).toThrow(
      expect.objectContaining({ code: 'reserved_pool' }),
    );
  });
});

describe('measure', () => {
  it("measures any isolate's load over the last 3 s, a preview's included", async () => {
    start({ loads: memoryLoads({ a: 5 }) });
    sim.load('a', 5);
    balancer.spawn({ id: 'a' });
    sim.spawn({ id: 'preview' });
    sim.load('preview', 35);
    expect(balancer.measure('preview')).toBeUndefined();
    await wait(1_000);
    expect(balancer.measure('preview')).toBeUndefined();
    await wait(3_000);
    expect(balancer.measure('preview')).toBeCloseTo(35, 0);
    expect(balancer.measure('a')).toBeCloseTo(5, 0);
    sim.load('preview', 10);
    await wait(3_100);
    expect(balancer.measure('preview')).toBeCloseTo(10, 0);
    expect(balancer.measure('nobody')).toBeUndefined();
  });
});

describe('foreign members (defensive)', () => {
  it('flags an isolate it did not place in one of its pools, emits foreign once, never moves it', async () => {
    start({ loads: memoryLoads({ a: 5 }) });
    const seen: unknown[] = [];
    balancer.on('foreign', (e) => seen.push(e));
    balancer.spawn({ id: 'a' });
    sim.spawnAnywhere({ id: 'intruder', pool: 'balancer-1' });
    sim.load('intruder', 90);
    await wait(10_000);
    expect(seen).toEqual([{ id: 'intruder', pool: 'balancer-1' }]);
    expect(where('intruder')).toMatchObject({ pool: 'balancer-1', foreign: true });
    expect(moves.some((m) => m.id === 'intruder')).toBe(false);
    await sim.stop('intruder');
    await wait(600);
    expect(where('intruder')).toBeUndefined();
  });
});

describe('what it leaves alone', () => {
  it('never moves isolates spawned through the kernel, nor one on hold', async () => {
    start({ loads: memoryLoads({ a: 5, h: 5 }) });
    sim.spawn({ id: 'manual-1', pool: 'creator-pool-1' });
    sim.spawn({ id: 'manual-2', pool: 'creator-pool-1' });
    sim.load('manual-1', 90);
    sim.load('a', 5);
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 'h' });
    const release = balancer.hold('h');
    sim.load('h', 75);
    await wait(10_000);
    expect(moves).toEqual([]);
    expect(sim.poolOf('manual-1')).toBe('creator-pool-1');
    release();
    await wait(5_000);
    expect(moves).toEqual([{ id: 'h', from: 'balancer-1', to: 'balancer-2', reason: 'sustained' }]);
  });
});

/** Starts `a` and `s`, then makes `s` spike twice so it is mid-move (stops take 200 ms). */
const quarantineS = async (): Promise<void> => {
  start({ loads: memoryLoads({ a: 5, s: 5 }) });
  sim.load('a', 5);
  sim.load('s', 5);
  balancer.spawn({ id: 'a' });
  balancer.spawn({ id: 's' });
  await wait(1_000);
  sim.burst('s', 300);
  await wait(1_000);
  sim.stopDelayMs = 200;
  sim.burst('s', 300);
  await wait(300);
};

describe('stop during a move', () => {
  it('cancels the move, respawns nothing and resolves', async () => {
    await quarantineS();
    expect(where('s')?.state).toBe('moving');
    const spawnedBefore = sim.spawned.length;
    const stopped = balancer.stop('s');
    await wait(500);
    await expect(stopped).resolves.toBeUndefined();
    expect(sim.spawned.length).toBe(spawnedBefore);
    expect(where('s')).toBeUndefined();
    expect(sim.pools().flatMap((p) => p.members)).not.toContain('s');
    expect(moves.filter((m) => m.id === 's')).toEqual([]);
  });

  it('cancels it while the member is held, and the release does nothing', async () => {
    await quarantineS();
    const release = balancer.hold('a');
    expect(where('s')?.state).toBe('moving');
    const releaseS = balancer.hold('s');
    const stopped = balancer.stop('s');
    await wait(500);
    await stopped;
    releaseS();
    release();
    expect(where('s')).toBeUndefined();
    expect(sim.spawned.filter((m) => m.id === 's')).toHaveLength(1);
  });

  it('lets the same id be spawned again after the cancelled move', async () => {
    await quarantineS();
    const stopped = balancer.stop('s');
    await wait(500);
    await stopped;
    balancer.spawn({ id: 's' });
    expect(where('s')?.state).not.toBe('moving');
    expect(sim.pools().flatMap((p) => p.members)).toContain('s');
  });
});

/** Reports `backlog(id)` for every id once a second, until the returned function is called. */
const reporting = (ids: string[], backlog: (id: string) => number): (() => void) => {
  const iv = setInterval(() => {
    for (const id of ids) balancer.report(id, { backlog: backlog(id) });
  }, 1_000);
  return () => clearInterval(iv);
};

describe('backlog (M3i)', () => {
  it('moves members of a pool that keeps up on CPU but falls behind, one at a time', async () => {
    // Firefox in the File processor: one pool under the full line and with
    // low lag, but its queues growing.
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    start({ maxWorkers: 2, loads: memoryLoads(Object.fromEntries(ids.map((id) => [id, 1]))) });
    for (const id of ids) {
      sim.load(id, 9);
      balancer.spawn({ id });
    }
    const behind: unknown[] = [];
    balancer.on('behind', (e) => behind.push(e));
    await wait(5_000);
    expect(moves).toEqual([]);
    const t0 = performance.now();
    // Each group of two shares one growing backlog.
    const stop = reporting(
      ids,
      (id) => Math.round((performance.now() - t0) / 100) + ids.indexOf(id),
    );
    await wait(120_000);
    stop();
    expect(moves.length).toBeGreaterThanOrEqual(3);
    expect(moves.every((m) => m.reason === 'backlog')).toBe(true);
    expect(moves[0]).toMatchObject({ from: 'balancer-1', to: 'balancer-2' });
    // Within the cap, split until neither pool has room with less load.
    const counts = ['balancer-1', 'balancer-2'].map(
      (n) => balancer.placements().filter((p) => p.pool === n).length,
    );
    expect(counts).toEqual([4, 4]);
    expect(sim.peakBalancerPools).toBe(2);
    expect(behind.length).toBeGreaterThan(0);
  });

  it('waits a fresh 10 s window between backlog moves', async () => {
    const ids = ['p1', 'p2', 'p3', 'p4'];
    start({ maxWorkers: 4, loads: memoryLoads(Object.fromEntries(ids.map((id) => [id, 1]))) });
    const at: number[] = [];
    balancer.on('move', () => at.push(performance.now()));
    for (const id of ids) {
      sim.load(id, 10);
      balancer.spawn({ id });
    }
    const t0 = performance.now();
    const stop = reporting(ids, () => Math.round((performance.now() - t0) / 100));
    await wait(60_000);
    stop();
    expect(at.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < at.length; i++)
      expect((at[i] ?? 0) - (at[i - 1] ?? 0)).toBeGreaterThanOrEqual(10_000);
  });

  it('leaves a steady backlog alone, and treats a report older than 10 s as none', async () => {
    start({ loads: memoryLoads({ a: 5, b: 5 }) });
    for (const id of ['a', 'b']) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    // Not zero, but not growing: it keeps up.
    let stop = reporting(['a'], () => 50);
    await wait(30_000);
    stop();
    expect(moves).toEqual([]);
    // Growing, but only for 8 s, then silent.
    const t0 = performance.now();
    stop = reporting(['b'], () => Math.round((performance.now() - t0) / 100));
    await wait(8_000);
    stop();
    await wait(30_000);
    expect(moves).toEqual([]);
    expect(where('b')?.backlog).toBeUndefined();
  });

  it('reports behind when the isolate has its pool to itself, at most every 30 s', async () => {
    start({ loads: memoryLoads({ a: 5, h: 70 }) });
    sim.load('a', 5);
    sim.load('h', 70);
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 'h' });
    const behind: { at: number; id: string }[] = [];
    balancer.on('behind', (e) => behind.push({ at: performance.now(), id: e.id }));
    const t0 = performance.now();
    const stop = reporting(['h'], () => Math.round((performance.now() - t0) / 100));
    // Two rising windows (M3j): 20 s of reports.
    await wait(22_000);
    expect(behind.map((b) => b.id)).toEqual(['h']);
    expect(where('h')).toMatchObject({ pool: 'balancer-2', behind: true });
    await wait(60_000);
    expect(behind.length).toBeGreaterThanOrEqual(2);
    expect(behind.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < behind.length; i++)
      expect((behind[i]?.at ?? 0) - (behind[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(30_000);
    stop();
    expect(moves).toEqual([]);
    await wait(15_000);
    expect(where('h')?.behind).toBeUndefined();
  });

  it('rejects a backlog that is not a finite number of 0 or more, and ignores ids it did not place', () => {
    start();
    balancer.spawn({ id: 'a' });
    expect(() => balancer.report('a', { backlog: -1 })).toThrow(TypeError);
    expect(() => balancer.report('a', { backlog: Number.NaN })).toThrow(TypeError);
    expect(() => balancer.report('nobody', { backlog: 3 })).not.toThrow();
    balancer.report('a', { backlog: 3 });
    expect(where('a')?.backlog).toBe(3);
  });
});

describe('spikes from the data (M3i)', () => {
  it('a one-off spike on each member in turn never quarantines anyone', async () => {
    const ids = ['a', 'b', 'c', 'd'];
    start({ loads: memoryLoads(Object.fromEntries(ids.map((id) => [id, 5]))) });
    const spikes: { id: string; action: string }[] = [];
    balancer.on('spike', (e) => spikes.push({ id: e.id, action: e.action }));
    for (const id of ids) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    await wait(1_000);
    /* oxlint-disable no-await-in-loop */
    for (const id of ids) {
      sim.burst(id, 300);
      await wait(2_000);
    }
    /* oxlint-enable no-await-in-loop */
    expect(moves).toEqual([]);
    expect(spikes).toEqual(ids.map((id) => ({ id, action: 'noted' })));
  });

  it('a second spike more than 60 s after the first is a first again', async () => {
    start({ loads: memoryLoads({ a: 5, s: 5 }) });
    for (const id of ['a', 's']) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    await wait(1_000);
    sim.burst('s', 300);
    await wait(61_000);
    sim.burst('s', 300);
    await wait(300);
    expect(moves).toEqual([]);
  });
});

describe('fewer moves (M3i)', () => {
  it("doesn't move when the moves it could make can't bring the pool back under", async () => {
    // balancer-1: x. balancer-2: h1 and five more. The cap allows no third pool.
    const ids = ['h1', 'a', 'b', 'c', 'd', 'e'];
    start({
      maxWorkers: 2,
      loads: memoryLoads({ x: 70, ...Object.fromEntries(ids.map((id) => [id, 1])) }),
    });
    balancer.spawn({ id: 'x' });
    for (const id of ids) balancer.spawn({ id });
    expect(where('x')?.pool).toBe('balancer-1');
    expect(new Set(ids.map((id) => where(id)?.pool))).toEqual(new Set(['balancer-2']));
    sim.load('x', 35);
    sim.load('h1', 20);
    for (const id of ids.slice(1)) sim.load(id, 13);
    // balancer-2 at 85 % and lagging. h1 fits in balancer-1 (35 + 20), but
    // that leaves 65 %, and nothing else fits: no move is worth its restart.
    await wait(20_000);
    expect(moves).toEqual([]);
    expect(where('h1')?.atCap).toBe(true);
  });

  it('moves a member for load at most 3 times in 5 minutes', async () => {
    start({ loads: memoryLoads({ a: 5, h: 5 }) });
    const at = new Map<string, number[]>();
    // Moves for load count; spike, crash and bisect moves protect the others and don't.
    const forLoad = new Set(['sustained', 'full', 'backlog', 'pack', 'steady']);
    balancer.on('move', (e) => {
      if (forLoad.has(e.reason)) at.set(e.id, [...(at.get(e.id) ?? []), performance.now()]);
    });
    sim.load('a', 5);
    sim.load('h', 5);
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 'h' });
    // h turns heavy for 10 s, then quiet for 70 s: moved out, then packed
    // together again, every 80 s without a budget.
    /* oxlint-disable no-await-in-loop */
    for (let cycle = 0; cycle < 8; cycle++) {
      sim.load('h', 80);
      await wait(10_000);
      sim.load('h', 5);
      await wait(70_000);
    }
    /* oxlint-enable no-await-in-loop */
    expect(moves.some((m) => m.reason === 'pack')).toBe(true);
    for (const times of at.values())
      for (let i = 3; i < times.length; i++)
        expect((times[i] ?? 0) - (times[i - 3] ?? 0)).toBeGreaterThanOrEqual(300_000);
    // Fewer than one move out per cycle: the budget held h back at least once.
    expect(moves.filter((m) => m.id === 'h' && m.reason === 'sustained').length).toBeLessThan(8);
  });

  it('reports what each move cost, from stop to the first beat in the new pool', async () => {
    const slowStop = new SimKernel();
    slowStop.stopDelayMs = 200;
    start({ loads: memoryLoads({ a: 5, h: 5 }) }, slowStop);
    const arrived: { id: string; to: string; reason: string; costMs: number }[] = [];
    balancer.on('arrived', (e) => arrived.push(e));
    for (const id of ['a', 'h']) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    await wait(5_000);
    sim.load('h', 80);
    await wait(5_000);
    expect(moves).toEqual([{ id: 'h', from: 'balancer-1', to: 'balancer-2', reason: 'sustained' }]);
    expect(arrived).toEqual([
      expect.objectContaining({
        id: 'h',
        from: 'balancer-1',
        to: 'balancer-2',
        reason: 'sustained',
      }),
    ]);
    expect(arrived[0]?.costMs).toBeGreaterThanOrEqual(200);
    expect(arrived[0]?.costMs).toBeLessThan(600);
  });
});

/** `a` in balancer-1, `h` alone in balancer-2. */
const twoApart = (opts: BalancerOptions = {}): void => {
  start({ loads: memoryLoads({ a: 5, h: 70 }), ...opts });
  sim.load('a', 5);
  sim.load('h', 70);
  balancer.spawn({ id: 'a' });
  balancer.spawn({ id: 'h' });
  expect(where('h')?.pool).toBe('balancer-2');
};

describe('packing back (M3i)', () => {
  it('moves a quiet member alone in its pool into another, freeing its worker, and stays put', async () => {
    twoApart();
    await wait(5_000);
    sim.load('h', 5);
    // Quiet for 60 s first.
    await wait(50_000);
    expect(moves).toEqual([]);
    await wait(20_000);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.reason).toBe('pack');
    expect(new Set(balancer.placements().map((p) => p.pool)).size).toBe(1);
    expect(sim.pools()).toHaveLength(1);
    // 10 % together: far under every line, so it doesn't move again.
    await wait(600_000);
    expect(moves).toHaveLength(1);
  });

  it('packs a member whose backlog holds steady while work arrives (M3j)', async () => {
    twoApart();
    await wait(5_000);
    sim.load('h', 5);
    // Never 0 with files arriving, but not rising.
    const stop = reporting(['a', 'h'], () => 3);
    await wait(120_000);
    stop();
    expect(moves.map((m) => m.reason)).toEqual(['pack']);
    expect(new Set(balancer.placements().map((p) => p.pool)).size).toBe(1);
  });

  it('never packs a member whose backlog rose over the 60 s, and not at all when turned off', async () => {
    twoApart();
    sim.load('h', 5);
    const t0 = performance.now();
    // Slowly enough that no 10 s window is a backlog move's trigger for long.
    const stop = reporting(['h'], () => 3 + Math.floor((performance.now() - t0) / 20_000));
    await wait(120_000);
    stop();
    expect(moves.filter((m) => m.reason === 'pack')).toEqual([]);
    balancer.dispose();
    sim.dispose();
    twoApart({ pack: { enabled: false } });
    sim.load('h', 5);
    await wait(300_000);
    expect(moves).toEqual([]);
  });

  it("doesn't pack when the two together would reach 40 %", async () => {
    twoApart();
    sim.load('a', 20);
    sim.load('h', 25);
    await wait(300_000);
    expect(moves).toEqual([]);
  });
});

/** Reports a running `busyMs` total for every id once a second, growing by `pct(id)` % of each second. */
const reportingBusy = (ids: string[], pct: (id: string) => number): (() => void) => {
  const totals = new Map<string, number>();
  const iv = setInterval(() => {
    for (const id of ids) {
      const total = (totals.get(id) ?? 0) + pct(id) * 10;
      totals.set(id, total);
      balancer.report(id, { busyMs: total });
    }
  }, 1_000);
  return () => clearInterval(iv);
};

describe('reported busy time (M3j)', () => {
  it('reads work the beats miss from the report: a full pool moves its heaviest instead of bisecting', async () => {
    const ids = ['a', 'b', 'c', 'd'];
    start({ loads: memoryLoads(Object.fromEntries(ids.map((id) => [id, 1]))) });
    for (const id of ids) {
      sim.load(id, 1);
      balancer.spawn({ id });
    }
    // Work resumed after `await`: the worker pays for it, the beats don't
    // show it, and the app reports it from the start.
    const stop = reportingBusy(['a', 'b'], (id) => (id === 'a' ? 50 : 30));
    await wait(5_000);
    sim.hidden('a', 50);
    sim.hidden('b', 30);
    await wait(8_000);
    stop();
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.some((m) => m.reason === 'bisect')).toBe(false);
    // 80 % reported: the full-pool trigger, which the beats alone never reach.
    expect(moves[0]).toMatchObject({ id: 'a', reason: 'full' });
  });

  it("takes the larger of the beats' and the report's figures, and drops a stale report", async () => {
    start({ loads: memoryLoads({ a: 5 }) });
    sim.load('a', 5);
    balancer.spawn({ id: 'a' });
    let stop = reportingBusy(['a'], () => 30);
    await wait(5_000);
    expect(where('a')?.reportedPct).toBeCloseTo(30, 0);
    expect(where('a')?.loadPct).toBeCloseTo(30, 0);
    stop();
    // Under the beats' 5 %: the beats' figure wins.
    stop = reportingBusy(['a'], () => 1);
    await wait(5_000);
    expect(where('a')?.loadPct).toBeCloseTo(5, 0);
    stop();
    await wait(11_000);
    expect(where('a')?.reportedPct).toBeUndefined();
    expect(where('a')?.loadPct).toBeCloseTo(5, 0);
  });

  it('starts counting again when the total goes down', async () => {
    start({ loads: memoryLoads({ a: 5 }) });
    sim.load('a', 5);
    balancer.spawn({ id: 'a' });
    balancer.report('a', { busyMs: 100_000 });
    await wait(1_000);
    let total = 0;
    const iv = setInterval(() => {
      total += 200;
      balancer.report('a', { busyMs: total });
    }, 1_000);
    await wait(5_000);
    clearInterval(iv);
    expect(where('a')?.reportedPct).toBeCloseTo(20, 0);
  });

  it('rejects a report with neither field, or a busyMs that is not a finite number of 0 or more', () => {
    start();
    balancer.spawn({ id: 'a' });
    expect(() => balancer.report('a', {})).toThrow(TypeError);
    expect(() => balancer.report('a', { busyMs: -1 })).toThrow(TypeError);
    expect(() => balancer.report('a', { busyMs: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => balancer.report('a', { busyMs: 10 })).not.toThrow();
  });
});

describe('offences decay (M3j)', () => {
  it('a quiet offender back in a pool loses its offence: the next window is 30 s again', async () => {
    start({ loads: memoryLoads({ a: 5, s: 5 }) });
    sim.load('a', 5);
    sim.load('s', 5);
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 's' });
    await wait(1_000);
    const backAfter: number[] = [];
    /* oxlint-disable no-await-in-loop */
    for (let round = 0; round < 3; round++) {
      await spikeTwice('s');
      expect(where('s')?.state).toBe('quarantined');
      const t = performance.now();
      while (where('s')?.state !== 'placed') await wait(500);
      backAfter.push(Math.round((performance.now() - t) / 1000));
      // Quiet back in its pool, and past the move budget's 5 minutes: without
      // decay, the next window would be twice as long.
      await wait(300_000);
    }
    /* oxlint-enable no-await-in-loop */
    for (const s of backAfter) {
      expect(s).toBeGreaterThanOrEqual(30);
      expect(s).toBeLessThan(60);
    }
  });

  it('caps the quiet window at 2 minutes', async () => {
    start({ loads: memoryLoads({ a: 5, s: 5 }), quarantine: { maxReturns: 10 } });
    sim.load('a', 5);
    sim.load('s', 5);
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 's' });
    await wait(1_000);
    await spikeTwice('s');
    // Three more offences in the quarantine: 4 in all, so 240 s uncapped.
    /* oxlint-disable no-await-in-loop */
    for (let i = 0; i < 3; i++) {
      sim.crash({ id: 's', reason: 'error', pool: 'balancer-quarantine-1' });
      await wait(500);
    }
    /* oxlint-enable no-await-in-loop */
    expect(where('s')?.state).toBe('quarantined');
    const t = performance.now();
    // oxlint-disable-next-line no-await-in-loop
    while (where('s')?.state !== 'placed') await wait(500);
    const back = (performance.now() - t) / 1000;
    expect(back).toBeGreaterThanOrEqual(119);
    expect(back).toBeLessThan(125);
  });
});

describe('a bisect only with a quarantine pool of its own (M3j)', () => {
  it("doesn't put suspects with an offender at the cap: the pool stays, its members are behind", async () => {
    const ids = ['a', 'b', 'c', 'd'];
    start({
      maxWorkers: 1,
      loads: memoryLoads(Object.fromEntries([...ids, 'o'].map((id) => [id, 5]))),
    });
    for (const id of [...ids, 'o']) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    await wait(1_000);
    await spikeTwice('o');
    expect(where('o')).toMatchObject({ pool: 'balancer-quarantine-1', state: 'quarantined' });
    const behind = new Set<string>();
    balancer.on('behind', (e) => behind.add(e.id));
    sim.block('c');
    await wait(5_000);
    expect(moves.filter((m) => m.reason === 'bisect')).toEqual([]);
    expect([...behind].toSorted()).toEqual(ids);
    expect(where('c')).toMatchObject({ pool: 'balancer-1', behind: true });
    sim.unblock('c');
  });

  it('bisects into an empty quarantine as before', async () => {
    const ids = ['a', 'b', 'c', 'd'];
    start({ maxWorkers: 1, loads: memoryLoads(Object.fromEntries(ids.map((id) => [id, 5]))) });
    for (const id of ids) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    await wait(1_000);
    sim.block('c');
    await wait(3_000);
    const bisected = moves.filter((m) => m.reason === 'bisect');
    expect(bisected.length).toBeGreaterThan(0);
    expect(bisected.every((m) => m.to === 'balancer-quarantine-1')).toBe(true);
    sim.unblock('c');
  });
});

describe('isolates the kernel gave up on (M3j)', () => {
  it('marks a failed member, takes it out of its pool, and never moves or restarts it', async () => {
    start({ loads: memoryLoads({ a: 5, b: 5 }) });
    for (const id of ['a', 'b']) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    await wait(5_000);
    const failed: FailedEvent[] = [];
    balancer.on('failed', (e) => failed.push(e));
    sim.fail('b');
    expect(failed).toEqual([{ id: 'b', pool: 'balancer-1', reason: 'unresponsive' }]);
    expect(where('b')).toMatchObject({ state: 'failed', loadPct: undefined });
    // `a` alone now: its pool's load no longer counts `b`.
    sim.load('a', 50);
    await wait(10_000);
    expect(moves).toEqual([]);
    expect(() => balancer.report('b', { backlog: 3 })).not.toThrow();
    expect(where('b')?.backlog).toBeUndefined();
    await wait(300_000);
    expect(moves.filter((m) => m.id === 'b')).toEqual([]);
    expect(sim.spawned.filter((m) => m.id === 'b')).toHaveLength(1);
    expect(where('b')?.state).toBe('failed');
  });

  it('places it again as new once the app restarts it', async () => {
    start({ loads: memoryLoads({ a: 5, b: 5 }) });
    for (const id of ['a', 'b']) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    await wait(1_000);
    sim.fail('b');
    await wait(5_000);
    sim.restart('b');
    await wait(5_000);
    expect(where('b')).toMatchObject({ pool: 'balancer-1', state: 'placed' });
    expect(where('b')?.loadPct).toBeCloseTo(5, 0);
  });

  it('never revives a member that a blocking neighbour got given up on', async () => {
    const ids = ['a', 'b', 'c', 'd'];
    start(
      { loads: memoryLoads(Object.fromEntries(ids.map((id) => [id, 5]))) },
      new SimKernel({ maxRestarts: 3 }),
    );
    for (const id of ids) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    const failedAt = new Map<string, number>();
    balancer.on('failed', (e) =>
      failedAt.set(e.id, sim.spawned.filter((m) => m.id === e.id).length),
    );
    await wait(1_000);
    sim.block('c');
    await wait(60_000);
    expect(failedAt.has('c')).toBe(true);
    await wait(300_000);
    for (const [id, spawns] of failedAt) {
      expect(where(id)?.state).toBe('failed');
      expect(sim.spawned.filter((m) => m.id === id)).toHaveLength(spawns);
    }
    for (const id of ids.filter((x) => !failedAt.has(x))) expect(where(id)?.state).toBe('placed');
  });
});

describe('the move budget after a first measurement (M3j)', () => {
  it("doesn't count a never-measured isolate's way out of the quarantine", async () => {
    // The File processor: every processor starts unmeasured, so each one's
    // first move is out of the quarantine, about 3 s in. It isn't a decision
    // to help, so it doesn't use up one of the 3 moves in 5 minutes.
    start({ loads: memoryLoads({ a: 50 }) });
    sim.load('a', 50);
    sim.load('h', 15);
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 'h' });
    await wait(5_000);
    // Measured at 15 %: no room with a's 50 %, so a pool of its own.
    expect(moves).toEqual([
      { id: 'h', from: 'balancer-quarantine-1', to: 'balancer-2', reason: 'steady' },
    ]);
    sim.load('a', 20);
    // Held, a stays put: h is the one that packs.
    balancer.hold('a');
    // Quiet for a minute, alone: h packs in with a (35 %), its first counted move.
    await wait(70_000);
    expect(moves.at(-1)).toMatchObject({ id: 'h', to: 'balancer-1', reason: 'pack' });
    // Its second: two spikes send it to the quarantine.
    await spikeTwice('h');
    expect(moves.at(-1)).toMatchObject({ id: 'h', to: 'balancer-quarantine-1', reason: 'spike' });
    // Its third: out after its 30 s quiet window, well within 5 minutes of the first.
    await wait(32_000);
    expect(moves.at(-1)).toMatchObject({
      id: 'h',
      from: 'balancer-quarantine-1',
      reason: 'steady',
    });
    expect(where('h')?.state).toBe('placed');
  });
});

describe('packing whole pools (M3j)', () => {
  it('empties a quiet pool of several members into another, one member a minute, and stays put', async () => {
    // Two pools of two after a busy spell, now light enough for one.
    start({ loads: memoryLoads({ a: 30, b: 25, c: 30, d: 25 }) });
    for (const id of ['a', 'b', 'c', 'd']) {
      sim.load(id, 30);
      balancer.spawn({ id });
    }
    expect(new Set(balancer.placements().map((p) => p.pool)).size).toBe(2);
    await wait(5_000);
    for (const id of ['a', 'b', 'c', 'd']) sim.load(id, 5);
    await wait(200_000);
    expect(moves.map((m) => m.reason)).toEqual(['pack', 'pack']);
    // The second move finishes what the first started.
    expect(moves[0]?.from).toBe(moves[1]?.from);
    expect(moves[0]?.to).toBe(moves[1]?.to);
    expect(new Set(balancer.placements().map((p) => p.pool)).size).toBe(1);
    expect(sim.pools()).toHaveLength(1);
    await wait(600_000);
    expect(moves).toHaveLength(2);
  });
});

describe('a backlog move needs two rising windows (M3j)', () => {
  it("doesn't move on a backlog that rose over one 10 s window and then held", async () => {
    // A queue at a steady rate jumps now and then: one rise isn't falling behind.
    const ids = ['p1', 'p2', 'p3', 'p4'];
    start({ maxWorkers: 4, loads: memoryLoads(Object.fromEntries(ids.map((id) => [id, 1]))) });
    for (const id of ids) {
      sim.load(id, 10);
      balancer.spawn({ id });
    }
    const t0 = performance.now();
    const stop = reporting(ids, () => (performance.now() - t0 < 15_000 ? 0 : 10));
    await wait(60_000);
    stop();
    expect(moves).toEqual([]);
  });

  it('moves once the backlog has risen over two windows in a row', async () => {
    const ids = ['p1', 'p2', 'p3', 'p4'];
    start({ maxWorkers: 4, loads: memoryLoads(Object.fromEntries(ids.map((id) => [id, 1]))) });
    for (const id of ids) {
      sim.load(id, 10);
      balancer.spawn({ id });
    }
    const t0 = performance.now();
    const at: number[] = [];
    balancer.on('move', () => at.push(performance.now() - t0));
    const stop = reporting(ids, () => Math.round((performance.now() - t0) / 1_000));
    await wait(30_000);
    stop();
    expect(at.length).toBeGreaterThanOrEqual(1);
    // Not before 20 s of reports.
    expect(at[0]).toBeGreaterThanOrEqual(20_000);
    expect(at[0]).toBeLessThan(25_000);
  });
});

/**
 * The File processor's fault runs on 0.1.0-next.3: two image processors
 * crash on a corrupt file and are bisected into two quarantine pools; the
 * second counts toward the cap, so the six others, sharing one worker and
 * falling behind, have nowhere to go.
 */
const twoQuarantines = async (): Promise<string[]> => {
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  start({
    maxWorkers: 2,
    loads: memoryLoads({ ...Object.fromEntries(ids.map((id) => [id, 9])), o1: 25, o2: 25 }),
  });
  for (const id of ids) {
    sim.load(id, 9);
    balancer.spawn({ id });
  }
  for (const id of ['o1', 'o2']) {
    sim.load(id, 25);
    balancer.spawn({ id });
  }
  await wait(2_000);
  for (const id of ['o1', 'o2'])
    sim.crash({ id, reason: 'error', pool: where(id)?.pool ?? 'balancer-2' });
  await wait(2_000);
  sim.block('o1');
  await wait(1_500);
  sim.unblock('o1');
  await wait(2_000);
  const quarantines = new Set(['o1', 'o2'].map((id) => where(id)?.pool));
  expect(quarantines).toEqual(new Set(['balancer-quarantine-1', 'balancer-quarantine-2']));
  expect(new Set(ids.map((id) => where(id)?.pool))).toEqual(new Set(['balancer-1']));
  return ids;
};

describe('a backlog outranks a second quarantine worker (M3j)', () => {
  it('folds the second quarantine into the first so the backlog can move', async () => {
    const ids = await twoQuarantines();
    const t0 = performance.now();
    const stop = reporting(ids, () => Math.round((performance.now() - t0) / 100));
    await wait(30_000);
    stop();
    const room = moves.filter((m) => m.reason === 'room');
    expect(room).toEqual([
      expect.objectContaining({ from: 'balancer-quarantine-2', to: 'balancer-quarantine-1' }),
    ]);
    const backlog = moves.filter((m) => m.reason === 'backlog');
    expect(backlog.length).toBeGreaterThanOrEqual(1);
    expect(backlog[0]).toMatchObject({ from: 'balancer-1', to: 'balancer-2' });
    expect(sim.peakBalancerPools).toBeLessThanOrEqual(2);
  });

  it('gives a worker that frees up to the backlog, not to a new quarantine', async () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    start({
      maxWorkers: 2,
      loads: memoryLoads({ ...Object.fromEntries(ids.map((id) => [id, 9])), x: 50, o1: 5, o2: 5 }),
    });
    for (const id of [...ids, 'x', 'o1', 'o2']) {
      sim.load(id, id === 'x' ? 50 : id.startsWith('o') ? 5 : 9);
      balancer.spawn({ id });
    }
    await wait(2_000);
    expect(where('x')?.pool).toBe('balancer-2');
    for (const id of ['o1', 'o2'])
      sim.crash({ id, reason: 'error', pool: where(id)?.pool ?? 'balancer-1' });
    await wait(2_000);
    expect(where('o1')?.pool).toBe('balancer-quarantine-1');
    const t0 = performance.now();
    const stop = reporting(ids, () => Math.round((performance.now() - t0) / 100));
    // Rising over two windows, with nowhere to go: the six are behind.
    await wait(22_000);
    expect(where('p1')?.behind).toBe(true);
    // The app stops x, freeing balancer-2, and before the next decision the
    // quarantine's worker dies: its search runs first.
    const stopped = balancer.stop('x');
    await stopped;
    for (const id of ['o1', 'o2'])
      sim.crash({ id, reason: 'unresponsive', pool: 'balancer-quarantine-1' });
    await wait(3_000);
    stop();
    expect(moves.filter((m) => m.to === 'balancer-quarantine-2')).toEqual([]);
    expect(moves.filter((m) => m.reason === 'backlog').length).toBeGreaterThanOrEqual(1);
  });

  it("never folds a bisect's suspects in with the offenders", async () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    start({
      maxWorkers: 2,
      loads: memoryLoads({ ...Object.fromEntries(ids.map((id) => [id, 5])), s1: 5, s2: 5, o: 5 }),
    });
    for (const id of ['s1', 's2', 'o']) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    await wait(2_000);
    // o offends: it shares the first quarantine. Then s1 blocks its pool: the
    // bisect's suspects get a second quarantine pool, the last worker.
    sim.crash({ id: 'o', reason: 'error', pool: where('o')?.pool ?? 'balancer-1' });
    await wait(2_000);
    // A second offence doubles its quiet window: it stays in the first quarantine.
    sim.crash({ id: 'o', reason: 'error', pool: 'balancer-quarantine-1' });
    await wait(500);
    sim.block('s1');
    await wait(1_500);
    sim.unblock('s1');
    await wait(500);
    const suspects = ['s1', 's2'].filter((id) => where(id)?.pool === 'balancer-quarantine-2');
    expect(suspects.length).toBe(1);
    for (const id of ids) {
      sim.load(id, 5);
      balancer.spawn({ id });
    }
    await wait(2_000);
    const t0 = performance.now();
    const stop = reporting(ids, () => Math.round((performance.now() - t0) / 100));
    await wait(25_000);
    stop();
    expect(moves.filter((m) => m.reason === 'room')).toEqual([]);
    expect(where(suspects[0] ?? '')?.pool).toBe('balancer-quarantine-2');
    expect(where('o')?.pool).toBe('balancer-quarantine-1');
  });

  it("folds a bisect's second half back into the first when no offender is there", async () => {
    // Firefox in the same runs: a lag nobody's busy time explained split
    // the pool twice, so both quarantine pools held only suspects.
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    start({
      maxWorkers: 2,
      loads: memoryLoads({
        ...Object.fromEntries(ids.map((id) => [id, 5])),
        s1: 8,
        s2: 6,
        s3: 1,
        s4: 1,
      }),
    });
    for (const id of [...ids, 's1', 's2', 's3', 's4']) {
      sim.load(id, id === 's1' ? 8 : id === 's2' ? 6 : id.startsWith('s') ? 1 : 5);
      balancer.spawn({ id });
    }
    await wait(2_000);
    sim.block('s1');
    await wait(1_500);
    sim.unblock('s1');
    await wait(1_000);
    expect(where('s1')?.pool).toBe('balancer-quarantine-1');
    sim.block('s1');
    await wait(1_500);
    sim.unblock('s1');
    await wait(1_000);
    const second = balancer
      .placements()
      .filter((p) => p.pool === 'balancer-quarantine-2')
      .map((p) => p.id);
    expect(second.length).toBeGreaterThan(0);
    const t0 = performance.now();
    const stop = reporting(ids, () => Math.round((performance.now() - t0) / 100));
    await wait(25_000);
    stop();
    expect(
      moves
        .filter((m) => m.reason === 'room')
        .map((m) => m.id)
        .toSorted(),
    ).toEqual(second.toSorted());
    expect(moves.some((m) => m.reason === 'backlog')).toBe(true);
  });

  it('leaves the quarantines alone while nothing is behind', async () => {
    await twoQuarantines();
    await wait(20_000);
    expect(moves.filter((m) => m.reason === 'room')).toEqual([]);
  });
});

describe('the cap counts pools its moves have claimed (M3j)', () => {
  it('never opens a third pool when a full move and a backlog move want the same freed worker', async () => {
    // The File processor's fault runs on 0.1.0-next.4: the fold freed a
    // worker, and in one decision a `full` move and a `backlog` move each
    // took a new pool, as the first wasn't running yet.
    const ids = await twoQuarantines();
    for (const id of ids) sim.load(id, 14);
    const t0 = performance.now();
    const stop = reporting(ids, () => Math.round((performance.now() - t0) / 100));
    await wait(40_000);
    stop();
    expect(moves.some((m) => m.reason === 'room')).toBe(true);
    expect(moves.filter((m) => m.to === 'balancer-3')).toEqual([]);
    expect(sim.peakBalancerPools).toBeLessThanOrEqual(2);
  });
});
