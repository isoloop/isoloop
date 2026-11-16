import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBalancer } from './balancer';
import { memoryLoads, SimKernel } from './sim';
import type { Balancer, BalancerOptions, MoveEvent } from './types';

let sim: SimKernel;
let balancer: Balancer;
let moves: MoveEvent[];

const start = (opts: BalancerOptions = {}, sim_ = new SimKernel()): void => {
  sim = sim_;
  balancer = createBalancer(sim, { maxWorkers: 10, ...opts });
  moves = [];
  balancer.on('move', (e) => moves.push(e));
};

const wait = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

const where = (id: string) => balancer.placements().find((p) => p.id === id);

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
    expect(balancer.placements().map((p) => p.pool)).toEqual(['auto-1', 'auto-1', 'auto-1']);
    await wait(60_000);
    expect(moves).toEqual([]);
    expect(balancer.placements().every((p) => p.state === 'placed')).toBe(true);
  });

  it('gives a measured heavy isolate a pool of its own', async () => {
    start({ loads: memoryLoads({ a: 5, h: 70 }) });
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 'h' });
    expect(where('a')?.pool).toBe('auto-1');
    expect(where('h')?.pool).toBe('auto-2');
  });

  it('starts a never-measured isolate in quarantine, then places it once measured', async () => {
    const loads = memoryLoads({ a: 5 });
    start({ loads });
    sim.load('a', 5);
    sim.load('n', 10);
    balancer.spawn({ id: 'a' });
    expect(balancer.spawn({ id: 'n' })).toMatchObject({
      pool: 'auto-quarantine',
      state: 'quarantined',
    });
    await wait(29_000);
    expect(where('n')?.state).toBe('quarantined');
    await wait(2_000);
    expect(moves).toEqual([{ id: 'n', from: 'auto-quarantine', to: 'auto-1', reason: 'steady' }]);
    expect(where('n')).toMatchObject({ pool: 'auto-1', state: 'placed' });
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
    expect(moves).toEqual([{ id: 'h', from: 'auto-1', to: 'auto-2', reason: 'sustained' }]);
    expect(where('a')?.pool).toBe('auto-1');
    expect(where('b')?.pool).toBe('auto-1');
    // No flapping: the heavy one stays apart and nothing else moves.
    await wait(120_000);
    expect(moves).toHaveLength(1);
  });

  it('respects the worker cap: no pool beyond it, the mover stays and is flagged', async () => {
    // maxWorkers 3: the bus, auto-1, and one kept for the quarantine.
    start({ maxWorkers: 3, loads: memoryLoads({ a: 5, h: 5 }) });
    sim.load('a', 5);
    sim.load('h', 5);
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 'h' });
    // Not enough to spike, enough to stay over the sustained threshold.
    sim.load('h', 75);
    await wait(10_000);
    expect(moves).toEqual([]);
    expect(where('h')).toMatchObject({ pool: 'auto-1', atCap: true });
    expect(sim.peakWorkers).toBeLessThanOrEqual(3);
  });

  it('counts workers it does not own toward the cap', () => {
    start({ maxWorkers: 4, loads: memoryLoads({ a: 50, b: 50 }) });
    sim.spawn({ id: 'dashboard' });
    balancer.spawn({ id: 'a' });
    // bus + dashboard + auto-1 = 3; a new pool and the quarantine's slot would make 5.
    expect(balancer.spawn({ id: 'b' })).toMatchObject({ pool: 'auto-1', atCap: true });
  });
});

describe('spikes and quarantine', () => {
  it('quarantines a spiking member at once, and lets it back once steady', async () => {
    start({ loads: memoryLoads({ a: 5, s: 5 }) });
    sim.load('a', 5);
    sim.load('s', 5);
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 's' });
    await wait(1_000);
    sim.burst('s', 300);
    await wait(300);
    expect(moves).toEqual([{ id: 's', from: 'auto-1', to: 'auto-quarantine', reason: 'spike' }]);
    expect(where('a')?.pool).toBe('auto-1');
    await wait(31_000);
    expect(moves.at(-1)).toEqual({
      id: 's',
      from: 'auto-quarantine',
      to: 'auto-1',
      reason: 'steady',
    });
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
      sim.burst('s', 300);
      await wait(300);
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
    sim.burst('s', 300);
    await wait(300);
    expect(where('s')).toMatchObject({ pool: 'auto-quarantine', state: 'kept-apart' });
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
    sim.burst('n', 300);
    await wait(5_000);
    expect(moves).toEqual([]);
    expect(where('a')?.pool).toBe('auto-1');
  });

  it('quarantines a member whose own fatal error crashed it', async () => {
    start({ loads: memoryLoads({ a: 5, e: 5 }) });
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 'e' });
    // The real kernel emits this when the isolate sends a fatal `error`.
    sim.crash({ id: 'e', reason: 'error', pool: 'auto-1' });
    await wait(100);
    expect(moves).toEqual([{ id: 'e', from: 'auto-1', to: 'auto-quarantine', reason: 'crash' }]);
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
    expect(where('c')?.pool).toMatch(/^auto-quarantine/);
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
    expect(moves).toEqual([{ id: 'h', from: 'auto-1', to: 'auto-2', reason: 'sustained' }]);
  });
});
