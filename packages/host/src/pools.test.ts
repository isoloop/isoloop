import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernel, KernelError, type Kernel, type KernelConfig } from './index';

// Worker pools, the host side (M2c task 2, ADR 0001): headless isolates naming
// the same pool share one worker, started with the first member and gone
// after the last; visual isolates can't join a pool.

const bootstrap = `${new URL('../../runtime/src/bootstrap.ts', import.meta.url).href}?worker_file&type=module`;
const counter = new URL('./__fixtures__/counter.ts', import.meta.url).href;

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
});
