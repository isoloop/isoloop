import { createKernel } from '@isoloop/host';
import workers from 'virtual:isoloop/workers';

// Already sets both: left as it is.
export const both = createKernel({
  workers,
  supervisor: { withinMs: 120_000, healthyAfterMs: 30_000 },
});

// No withinMs: the default healthy run is the old one.
export const none = createKernel({ workers, supervisor: { maxRestarts: 5 } });
export const bare = createKernel({ workers });

// Not Isoloop's createKernel call, and not a supervisor object.
export const other = makeQueue({ supervisor: { withinMs: 1000 } });
export const notSupervisor = createKernel({ workers, heartbeat: { withinMs: 5 } });
