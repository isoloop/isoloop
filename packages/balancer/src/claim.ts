// One balancer per kernel (M3h). The host reserves `balancer-*` pools: only
// the spawn `claimPools(kernel, 'balancer')` hands out may use them, plain
// `kernel.spawn` with one throws `reserved_pool`, and a second claim throws
// `balancer_exists`.
//
// Until that host export lands, this adapter stands in for it: a kernel that
// offers `claimPools` (the simulated one in the tests) is asked directly,
// anything else is claimed here, once per kernel, with its own `spawn`.
import type { KernelLike, ManifestLike } from './types';

export type PoolClaim<M extends ManifestLike> = { spawn(manifest: M): unknown };

const claimed = new WeakSet<object>();

export const claimPools = <M extends ManifestLike>(
  kernel: KernelLike<M>,
  owner: 'balancer',
): PoolClaim<M> => {
  if (kernel.claimPools) return kernel.claimPools(owner);
  if (claimed.has(kernel)) throw balancerExists();
  claimed.add(kernel);
  return { spawn: (manifest) => kernel.spawn(manifest) };
};

/** The error the host's claim throws, in the same shape: `code` to branch on. */
export const balancerExists = (): Error & { code: 'balancer_exists' } =>
  Object.assign(new Error('this kernel already has a balancer'), {
    name: 'KernelError',
    code: 'balancer_exists' as const,
  });
