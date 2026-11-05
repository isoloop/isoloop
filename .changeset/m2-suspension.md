---
'@isoloop/protocol': minor
'@isoloop/bus': minor
'@isoloop/host': minor
'@isoloop/runtime': minor
---

Opt-in suspension (ADR 0001). `manifest.suspend: 'when-idle' | { whenIdle: { afterMs } }` (default `'never'`) lets the kernel shut down an idle isolate's worker: no visible surface, nothing delivered for `afterMs`, no `ctx.keepAwake()` hold and nothing in flight. The surface keeps an inert snapshot of its last frame. Visual isolates wake when shown, headless ones on a record for a subscribed topic (the bus sends `wake`), and both on `kernel.resume(id)`; a wake queue starts at most `suspend.maxConcurrentWakes` (default 4) at once, visible surfaces first in on-screen order. A woken isolate's `latest` subscriptions resume from `committed`, and `onGap` reports records retention dropped meanwhile. A suspended group member leaves its group. New state `suspended`, which never counts towards the restart limit; `ctx.keepAwake()` returns a release function; beats carry an idle report; `suspend_unsupported` is gone.
