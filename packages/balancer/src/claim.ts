// One balancer per kernel (ADR 0017). The host reserves `balancer-*` pools:
// only the spawn `claimPools(kernel, 'balancer')` hands out may use them,
// plain `kernel.spawn` with one throws `reserved_pool`, and a second claim
// throws `balancer_exists` until the first claim is released (dispose).
import { claimPools as hostClaim, type IsolateManifest, type Kernel } from '@isoloop/host';
import type { KernelLike, ManifestLike } from './types';

export type PoolClaim<M extends ManifestLike> = { spawn(manifest: M): unknown; release(): void };

/**
 * The host's claim, for a kernel from `createKernel`. A `KernelLike` that
 * offers `claimPools` itself (a simulated kernel in tests) is asked
 * directly instead.
 */
export const claimPools = <M extends ManifestLike>(
  kernel: KernelLike<M>,
  owner: 'balancer',
): PoolClaim<M> => {
  if (kernel.claimPools) {
    const own = kernel.claimPools(owner);
    return { spawn: (manifest) => own.spawn(manifest), release: () => own.release?.() };
  }
  // Without its own claimPools, a KernelLike must be the host's Kernel, whose
  // manifests are IsolateManifest; the host throws `invalid_config` otherwise.
  // oxlint-disable-next-line no-unsafe-type-assertion -- checked by the host: invalid_config if not its kernel
  const claim = hostClaim(kernel as unknown as Kernel, owner);
  return {
    spawn: (manifest) =>
      // oxlint-disable-next-line no-unsafe-type-assertion -- M is the host kernel's IsolateManifest here
      claim.spawn(manifest as unknown as IsolateManifest),
    release: () => claim.release(),
  };
};
