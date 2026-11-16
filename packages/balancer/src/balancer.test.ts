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

  it('starts a never-measured isolate in quarantine, then places it once measured', async () => {
    const loads = memoryLoads({ a: 5 });
    start({ loads });
    sim.load('a', 5);
    sim.load('n', 10);
    balancer.spawn({ id: 'a' });
    expect(balancer.spawn({ id: 'n' })).toMatchObject({
      pool: 'balancer-quarantine-1',
      state: 'quarantined',
    });
    await wait(29_000);
    expect(where('n')?.state).toBe('quarantined');
    await wait(2_000);
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
    // maxWorkers 3: the bus, balancer-1, and one kept for the quarantine.
    start({ maxWorkers: 3, loads: memoryLoads({ a: 5, h: 5 }) });
    sim.load('a', 5);
    sim.load('h', 5);
    balancer.spawn({ id: 'a' });
    balancer.spawn({ id: 'h' });
    // Not enough to spike, enough to stay over the sustained threshold.
    sim.load('h', 75);
    await wait(10_000);
    expect(moves).toEqual([]);
    expect(where('h')).toMatchObject({ pool: 'balancer-1', atCap: true });
    expect(sim.peakWorkers).toBeLessThanOrEqual(3);
  });

  it('counts workers it does not own toward the cap', () => {
    start({ maxWorkers: 4, loads: memoryLoads({ a: 50, b: 50 }) });
    sim.spawn({ id: 'dashboard' });
    balancer.spawn({ id: 'a' });
    // bus + dashboard + balancer-1 = 3; a new pool and the quarantine's slot would make 5.
    expect(balancer.spawn({ id: 'b' })).toMatchObject({ pool: 'balancer-1', atCap: true });
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
    sim.burst('n', 300);
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
    await wait(300_000);
    const cPool = where('c')?.pool;
    for (const id of ['a', 'b', 'd']) {
      expect(where(id)?.state).toBe('placed');
      expect(where(id)?.pool).not.toBe(cPool);
    }
  });

  it('bisects on a spike that busyMs does not explain', async () => {
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
    expect(() => createBalancer(sim)).toThrow(expect.objectContaining({ code: 'balancer_exists' }));
  });

  it('also without the host claim (the adapter)', () => {
    start();
    const plain = {
      spawn: () => {},
      stop: async () => {},
      isolates: () => [],
      pools: () => [],
      on: () => () => {},
    };
    createBalancer(plain).dispose();
    expect(() => createBalancer(plain)).toThrow(
      expect.objectContaining({ code: 'balancer_exists' }),
    );
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
    await wait(200);
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
