---
'@isoloop/host': patch
---

A start-up warm-up keeps a long `start()` from being killed. For `heartbeat.readyTimeoutMs` (10 s by default) after `ready`, or after the latest member's `ready` in a pool, a blocked isolate is killed only after that long without a beat, or after `killAfterMs` if that's longer. An app that sets `killAfterMs` lower no longer restarts in a loop while it mounts on a slow device. In exchange, a block just after a start or a restart can end without a restart. The bus worker is unchanged, and with the default timings nothing changes.
