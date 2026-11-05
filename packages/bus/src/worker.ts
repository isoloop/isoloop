/// <reference lib="webworker" />
/*
 * Bus worker entry, built as bus-worker.js (design §2). The host starts it by
 * URL and talks to it on the control port; see `server.ts`.
 */
import type { BusToHost, ErrorPayload } from '@isoloop/protocol';
import { serve } from './server';

declare const self: DedicatedWorkerGlobalScope;

const report = (p: ErrorPayload): void => {
  self.postMessage({ v: 1, t: 'error', p } satisfies BusToHost);
};

// Errors the broker didn't catch: reported, not fatal. The host also sees the
// worker's `error` event and decides what to do (ADR 0007).
self.addEventListener('error', (e) => {
  report({ message: e.message, fatal: false });
});
self.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  const r: unknown = e.reason;
  report(
    r instanceof Error && r.stack !== undefined
      ? { message: r.message, stack: r.stack, fatal: false }
      : { message: String(r), fatal: false },
  );
});

serve(self);
