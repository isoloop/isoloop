import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimPools, createKernel, KernelError, type Kernel } from './index';

// Reserved pools (ADR 0017): `balancer-…` pool names belong to
// @isoloop/balancer, which gets them through `claimPools`, once per kernel.

const bootstrap = `${new URL('../../runtime/src/bootstrap.ts', import.meta.url).href}?worker_file&type=module`;
const counter = new URL('./__fixtures__/counter.ts', import.meta.url).href;

const kernels: Kernel[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
});

function kernel(): Kernel {
  const k = createKernel({ workers: { isolateBootstrap: bootstrap } });
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

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return error instanceof KernelError ? error.code : 'not a KernelError';
  }
  return undefined;
};

describe('reserved pools (ADR 0017)', () => {
  it('rejects a plain spawn into a balancer- pool', () => {
    const k = kernel();
    for (const pool of ['balancer-1', 'balancer-quarantine-1', 'balancer-x'])
      expect(codeOf(() => k.spawn({ id: pool, src: counter, pool }))).toBe('reserved_pool');
    expect(k.isolates()).toEqual([]);
  });

  it('leaves other pool names alone', async () => {
    const k = kernel();
    k.spawn({ id: 'A', src: counter, pool: 'balancer' });
    k.spawn({ id: 'B', src: counter, pool: 'my-balancer-1' });
    await waitFor(() => running(k, ['A', 'B']));
  });

  it('lets the claimed spawn create and join reserved pools', async () => {
    const k = kernel();
    const { spawn } = claimPools(k, 'balancer');
    spawn({ id: 'A', src: counter, pool: 'balancer-1' });
    spawn({ id: 'B', src: counter, pool: 'balancer-1' });
    spawn({ id: 'C', src: counter, pool: 'balancer-quarantine-1' });
    spawn({ id: 'D', src: counter });
    await waitFor(() => running(k, ['A', 'B', 'C', 'D']));
    expect(k.debug.workers()).toEqual({
      live: 3,
      pools: { 'balancer-1': ['A', 'B'], 'balancer-quarantine-1': ['C'] },
    });
    // The plain spawn still can't join them.
    expect(codeOf(() => k.spawn({ id: 'E', src: counter, pool: 'balancer-1' }))).toBe(
      'reserved_pool',
    );
  });

  it('validates a claimed spawn like a plain one', () => {
    const { spawn } = claimPools(kernel(), 'balancer');
    expect(codeOf(() => spawn({ id: 'A', src: counter, pool: '' }))).toBe('invalid_manifest');
  });

  it('claims a kernel once', () => {
    const k = kernel();
    claimPools(k, 'balancer');
    expect(codeOf(() => claimPools(k, 'balancer'))).toBe('balancer_exists');
    // Another kernel has its own claim.
    expect(() => claimPools(kernel(), 'balancer')).not.toThrow();
  });

  it('rejects an object that is not a kernel', () => {
    const fake = { ...kernel() };
    expect(codeOf(() => claimPools(fake, 'balancer'))).toBe('invalid_config');
  });
});
