/// <reference lib="webworker" />
// The bus worker with a stubbed storage estimate (bus.test.ts, M2b task 14):
// 81 % used for the first two reads, then full.
import { serve } from '../../../bus/src/server';

declare const self: DedicatedWorkerGlobalScope;

let reads = 0;
serve(self, {
  estimate: () => {
    reads++;
    return Promise.resolve(reads <= 2 ? { usage: 81, quota: 100 } : { usage: 100, quota: 100 });
  },
});
