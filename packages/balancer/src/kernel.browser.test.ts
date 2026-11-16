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
  } finally {
    b.dispose();
  }
});
