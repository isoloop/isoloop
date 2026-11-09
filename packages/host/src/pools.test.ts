import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createKernel,
  KernelError,
  type Kernel,
  type KernelConfig,
  type KernelEvents,
} from './index';

// Worker pools, the host side (M2c task 2, ADR 0001): headless isolates naming
// the same pool share one worker, started with the first member and gone
// after the last; visual isolates can't join a pool.

const bootstrap = `${new URL('../../runtime/src/bootstrap.ts', import.meta.url).href}?worker_file&type=module`;
const counter = new URL('./__fixtures__/counter.ts', import.meta.url).href;
const spin = new URL('./__fixtures__/spin.ts', import.meta.url).href;
const throws = new URL('./__fixtures__/throws.ts', import.meta.url).href;
const timerThrows = new URL('./__fixtures__/timer-throws.ts', import.meta.url).href;

const kernels: Kernel[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
});

function kernel(config: Partial<KernelConfig> = {}): Kernel {
  const k = createKernel({ workers: { isolateBootstrap: bootstrap }, ...config });
  kernels.push(k);
  return k;
}

const waitFor = (ok: () => boolean, timeout = 3000) =>
  vi.waitFor(
    () => {
      if (!ok()) throw new Error('not yet');
    },
    { timeout, interval: 10 },
  );

const running = (k: Kernel, ids: string[]): boolean =>
  ids.every((id) => k.isolates().find((s) => s.id === id)?.state === 'running');

describe('worker pools (M2c)', () => {
  it('runs headless members of a pool in one worker, next to own workers', async () => {
    const k = kernel();
    for (const id of ['A', 'B', 'C']) k.spawn({ id, src: counter, pool: 'p' });
    k.spawn({ id: 'D', src: counter });
    await waitFor(() => running(k, ['A', 'B', 'C', 'D']));
    expect(k.debug.workers()).toEqual({ live: 2, pools: { p: ['A', 'B', 'C'] } });
  });

  it('counts a pool once against the worker budget', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const k = kernel({ workers: { isolateBootstrap: bootstrap, budget: 2 } });
    const over: unknown[] = [];
    k.on('workers:budget', (e) => over.push(e));
    for (const id of ['A', 'B', 'C', 'D']) k.spawn({ id, src: counter, pool: 'p' });
    k.spawn({ id: 'E', src: counter });
    await waitFor(() => running(k, ['A', 'B', 'C', 'D', 'E']));
    expect(over).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the pool worker while members remain, and ends it after the last stops', async () => {
    const k = kernel();
    for (const id of ['A', 'B']) k.spawn({ id, src: counter, pool: 'p' });
    await waitFor(() => running(k, ['A', 'B']));
    await k.stop('A');
    expect(k.debug.workers()).toEqual({ live: 1, pools: { p: ['B'] } });
    // B still beats: it stays running past a few heartbeat periods.
    await new Promise((r) => setTimeout(r, 400));
    expect(running(k, ['B'])).toBe(true);
    await k.stop('B');
    expect(k.debug.workers()).toEqual({ live: 0, pools: {} });
  });

  it('a stopped member can be spawned again into its pool', async () => {
    const k = kernel();
    for (const id of ['A', 'B']) k.spawn({ id, src: counter, pool: 'p' });
    await waitFor(() => running(k, ['A', 'B']));
    await k.stop('A');
    k.spawn({ id: 'A', src: counter, pool: 'p' });
    await waitFor(() => running(k, ['A', 'B']));
    expect(k.debug.workers().pools).toEqual({ p: ['B', 'A'] });
  });

  it('separate pools get separate workers', async () => {
    const k = kernel();
    k.spawn({ id: 'A', src: counter, pool: 'p' });
    k.spawn({ id: 'B', src: counter, pool: 'q' });
    await waitFor(() => running(k, ['A', 'B']));
    expect(k.debug.workers()).toEqual({ live: 2, pools: { p: ['A'], q: ['B'] } });
  });

  it('rejects a visual isolate with a pool: pools_headless_only', () => {
    const k = kernel();
    const surface = document.createElement('div');
    let code: string | undefined;
    try {
      k.spawn({ id: 'V', src: counter, surface, pool: 'p' });
    } catch (err) {
      code = err instanceof KernelError ? err.code : 'other';
    }
    expect(code).toBe('pools_headless_only');
    expect(k.isolates()).toEqual([]);
  });

  describe('supervision as a group (M2c task 3)', () => {
    const fast = {
      heartbeat: { everyMs: 50, blockedAfterMs: 200, killAfterMs: 600 },
      supervisor: { backoff: { baseMs: 50, maxMs: 50 } },
    };

    it('a member that loops forever restarts its whole pool; own workers and other pools carry on', async () => {
      const k = kernel(fast);
      const crashes: KernelEvents['isolate:crash'][] = [];
      k.on('isolate:crash', (e) => crashes.push(e));
      const ready: string[] = [];
      k.on('isolate:ready', (e) => ready.push(e.id));
      k.spawn({ id: 'A', src: spin, pool: 'p' });
      k.spawn({ id: 'B', src: counter, pool: 'p' });
      k.spawn({ id: 'C', src: counter, pool: 'p' });
      k.spawn({ id: 'Q', src: counter, pool: 'q' });
      k.spawn({ id: 'D', src: counter });
      await waitFor(() => ['B', 'C'].every((id) => crashes.some((c) => c.id === id)), 5000);
      expect(crashes.filter((c) => c.id === 'B' || c.id === 'C')).toEqual([
        expect.objectContaining({ reason: 'unresponsive', pool: 'p' }),
        expect.objectContaining({ reason: 'unresponsive', pool: 'p' }),
      ]);
      expect(crashes.find((c) => c.id === 'B')?.message).toContain('pool "p" restarted: "A"');
      // B and C come back, in a new worker for the pool.
      await waitFor(() => ready.filter((id) => id === 'B').length >= 2, 5000);
      await waitFor(() => running(k, ['B', 'C']), 5000);
      expect(crashes.some((c) => c.id === 'Q' || c.id === 'D')).toBe(false);
      expect(running(k, ['Q', 'D'])).toBe(true);
    });

    it('an uncaught error in a member timer takes the worker down: the pool restarts', async () => {
      const k = kernel(fast);
      const crashes: KernelEvents['isolate:crash'][] = [];
      k.on('isolate:crash', (e) => crashes.push(e));
      k.spawn({ id: 'A', src: timerThrows, pool: 'p' });
      k.spawn({ id: 'B', src: counter, pool: 'p' });
      k.spawn({ id: 'D', src: counter });
      await waitFor(() => crashes.some((c) => c.id === 'B'), 5000);
      expect(crashes.find((c) => c.id === 'B')).toMatchObject({
        reason: 'worker-error',
        pool: 'p',
      });
      expect(crashes.find((c) => c.id === 'A')).toMatchObject({
        reason: 'worker-error',
        pool: 'p',
      });
      expect(crashes.some((c) => c.id === 'D')).toBe(false);
    });

    it('a member whose start() throws crashes alone; the rest of its pool keeps running', async () => {
      const k = kernel({ ...fast, supervisor: { strategy: 'never' } });
      const crashes: KernelEvents['isolate:crash'][] = [];
      k.on('isolate:crash', (e) => crashes.push(e));
      k.spawn({ id: 'B', src: counter, pool: 'p' });
      await waitFor(() => running(k, ['B']));
      k.spawn({ id: 'A', src: throws, pool: 'p' });
      await waitFor(() => k.isolates().find((s) => s.id === 'A')?.state === 'failed', 5000);
      expect(crashes).toEqual([expect.objectContaining({ id: 'A', reason: 'error', pool: 'p' })]);
      await new Promise((r) => setTimeout(r, 400));
      expect(running(k, ['B'])).toBe(true);
      expect(k.debug.workers().pools).toEqual({ p: ['B'] });
    });
  });
});
