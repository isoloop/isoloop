// The bus suites run twice (ADR 0016, decision 3): as `host` with
// `KernelConfig.bus.batch` off, and as `host-batch` with it on
// (vitest.config.ts provides `busBatch`).
import { inject } from 'vitest';
import type { KernelConfig } from '../index';

declare module 'vitest' {
  export interface ProvidedContext {
    busBatch?: boolean;
  }
}

/** True in the `host-batch` project. */
export const batchOn = (): boolean => inject('busBatch') === true;

/** `KernelConfig.bus` for this project, merged with a test's own settings. */
export const busConfig = (own: KernelConfig['bus'] = {}): NonNullable<KernelConfig['bus']> => ({
  ...(batchOn() ? { batch: true } : {}),
  ...own,
});
