/// <reference lib="webworker" />
// The bus worker with a group commit that waits a minute (bus.test.ts, M2b
// task 16): a persistent publish is acked quickly only if the kernel's flush
// on `freeze` or `pagehide` writes the batch at once.
import { serve } from '../../../bus/src/server';
import { OpfsStorage } from '../../../bus/src/storage/opfs';

declare const self: DedicatedWorkerGlobalScope;

serve(self, { storage: () => new OpfsStorage({ commitMs: 60_000 }) });
