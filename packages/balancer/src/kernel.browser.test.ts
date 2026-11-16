import { createKernel, type Kernel } from '@isoloop/host';
import { afterEach, expect, it, vi } from 'vitest';
import { createBalancer } from './balancer';

// Against the real kernel: the balancer claims its pools through the host's
// claimPools (ADR 0017), once per kernel.

const bootstrap = `${new URL('../../runtime/src/bootstrap.ts', import.meta.url).href}?worker_file&type=module`;
const counter = new URL('../../host/src/__fixtures__/counter.ts', import.meta.url).href;

const kernels: Kernel[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
});

const kernel = (): Kernel => {
  const k = createKernel({ workers: { isolateBootstrap: bootstrap } });
  kernels.push(k);
  return k;
};

it('spawns into its own pools on a real kernel, and allows one balancer per kernel', async () => {
  const k = kernel();
  const b = createBalancer(k, { loads: { get: () => 5, set: () => {} } });
  try {
    expect(b.spawn({ id: 'w', src: counter })).toMatchObject({ pool: 'balancer-1' });
    await vi.waitFor(() => {
      expect(k.isolates().find((s) => s.id === 'w')).toMatchObject({
        state: 'running',
        pool: 'balancer-1',
      });
    });
    expect(() => createBalancer(k)).toThrow(expect.objectContaining({ code: 'balancer_exists' }));
    expect(() => k.spawn({ id: 'x', src: counter, pool: 'balancer-1' })).toThrow(
      expect.objectContaining({ code: 'reserved_pool' }),
    );
    // busyMs (#198) flows from the beats into measure().
    await vi.waitFor(
      () => {
        const load = b.measure('w');
        expect(load).toBeTypeOf('number');
        expect(load).toBeGreaterThanOrEqual(0);
        expect(load).toBeLessThan(50);
      },
      { timeout: 6000, interval: 200 },
    );
  } finally {
    b.dispose();
  }
});

it('gives the kernel back on dispose: a new balancer can claim it', async () => {
  const k = kernel();
  const first = createBalancer(k, { loads: { get: () => 5, set: () => {} } });
  first.spawn({ id: 'a', src: counter });
  first.dispose();
  expect(() => first.spawn({ id: 'b', src: counter })).toThrow(/disposed/);
  const second = createBalancer(k, { loads: { get: () => 5, set: () => {} } });
  try {
    // The old balancer's pool still holds an isolate the new one didn't place,
    // so the new one opens a pool of its own.
    const pool = second.spawn({ id: 'c', src: counter }).pool;
    expect(pool).toMatch(/^balancer-(?!1$)/);
    await vi.waitFor(() => {
      const pools = Object.fromEntries(
        k.isolates().map((s) => [s.id, `${s.state}:${s.pool ?? ''}`]),
      );
      // What the first placed keeps running where it is.
      expect(pools).toMatchObject({ a: 'running:balancer-1', c: `running:${pool}` });
    });
  } finally {
    second.dispose();
  }
});
