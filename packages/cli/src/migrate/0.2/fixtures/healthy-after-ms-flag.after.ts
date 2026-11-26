import { createKernel, type KernelConfig } from '@isoloop/host';
import workers from 'virtual:isoloop/workers';

declare const base: KernelConfig;
declare const shared: NonNullable<KernelConfig['supervisor']>;
declare function windowMs(): number;

// isoloop-migrate: a spread may set supervisor.withinMs: set `healthyAfterMs` to the same value as `withinMs` to keep the 0.1 restart limit
export const spread = createKernel({ ...base, workers });

export const spreadInSupervisor = createKernel({
  workers,
  // isoloop-migrate: a spread in `supervisor`: set `healthyAfterMs` to the same value as `withinMs` to keep the 0.1 restart limit
  supervisor: { ...shared, withinMs: 120_000 },
});

// isoloop-migrate: `supervisor` isn't an object literal: set `healthyAfterMs` to the same value as `withinMs` to keep the 0.1 restart limit
export const notLiteral = createKernel({ workers, supervisor: shared });

export const computed = createKernel({
  workers,
  // isoloop-migrate: `withinMs` is computed: set `healthyAfterMs` to the same value as `withinMs` to keep the 0.1 restart limit
  supervisor: { withinMs: windowMs() },
});
