/// <reference lib="webworker" />
/*
 * The isolate worker's entry, as `@isoloop/vite` loads it: tiny on purpose.
 * It holds the host's messages, loads the real bootstrap, and hands them over
 * in order. Nothing else lives in this chunk, so no other chunk imports it:
 * WebKit evaluates a module worker's entry a second time when one of its own
 * modules imports it by URL (docs/investigations/engine-constraints.md). The
 * bootstrap's once-per-worker guard stays the guarantee, for workers started
 * from `@isoloop/runtime/bootstrap` directly.
 */
declare const self: DedicatedWorkerGlobalScope;

const held: MessageEvent<unknown>[] = [];
const hold = (e: MessageEvent<unknown>): void => {
  held.push(e);
};
self.addEventListener('message', hold);

import('./bootstrap').then(
  () => {
    // The bootstrap listens now. Same task as its evaluation, so nothing new
    // arrives in between: replay what came first, in order.
    self.removeEventListener('message', hold);
    for (const e of held.splice(0))
      self.dispatchEvent(new MessageEvent('message', { data: e.data, ports: [...e.ports] }));
  },
  (err: unknown) => {
    // A worker error, as an uncaught exception at start would be.
    setTimeout(() => {
      throw err;
    });
  },
);
