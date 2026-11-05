/// <reference lib="webworker" />
// Test bootstrap: answers `init` with a render format no host speaks.
declare const self: DedicatedWorkerGlobalScope;

self.addEventListener('message', (e: MessageEvent<{ t?: string }>) => {
  if (e.data.t !== 'init') return;
  self.postMessage({
    v: 1,
    t: 'ready',
    p: { runtime: 'test', adapter: 'test', renderFmt: 'bogus@9' },
  });
});
