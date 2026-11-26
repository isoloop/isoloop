import { createKernel } from '@isoloop/host';
import workers from 'virtual:isoloop/workers';

// 0.1: withinMs was also the healthy run; 0.2 keeps it by setting both.
export const app = createKernel({
  workers,
  supervisor: {
    strategy: 'one-for-one',
    maxRestarts: 5,
    withinMs: 120_000,
    healthyAfterMs: 120_000, // two minutes
    backoff: { initialMs: 500 },
  },
});

export const small = createKernel({ workers, supervisor: { maxRestarts: 3, withinMs: 30_000, healthyAfterMs: 30_000 } });

const window = 45_000;
const config = {
  workers,
  supervisor: { withinMs: window * 2, healthyAfterMs: window * 2 } as const,
};
export const fromVariable = createKernel(config);

export const shorthand = (withinMs: number) => createKernel({ workers, supervisor: { withinMs, healthyAfterMs: withinMs } });
