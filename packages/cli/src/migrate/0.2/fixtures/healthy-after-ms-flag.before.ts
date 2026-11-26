import { createKernel, type KernelConfig } from '@isoloop/host';
import workers from 'virtual:isoloop/workers';

declare const base: KernelConfig;
declare const shared: NonNullable<KernelConfig['supervisor']>;
declare function windowMs(): number;

export const spread = createKernel({ ...base, workers });

export const spreadInSupervisor = createKernel({
  workers,
  supervisor: { ...shared, withinMs: 120_000 },
});

export const notLiteral = createKernel({ workers, supervisor: shared });

export const computed = createKernel({
  workers,
  supervisor: { withinMs: windowMs() },
});
