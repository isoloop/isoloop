/// <reference lib="webworker" />
// A plain worker that does nothing: the floor of the ladder.
self.addEventListener('message', () => {});
self.postMessage('ready');
