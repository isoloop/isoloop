---
'@isoloop/host': patch
---

A start-up warm-up keeps a long `start()` from being killed. From `ready` (in a pool, the latest member's) until the beats have been on time for 1 s, and for `heartbeat.readyTimeoutMs` (10 s by default) at most, a blocked isolate is killed only after `readyTimeoutMs` without a beat, or after `killAfterMs` if that's longer. An app that sets `killAfterMs` lower no longer restarts in a loop while it mounts on a slow device. In exchange, a block in about the first second after a start or a restart can end without a restart. The bus worker is unchanged, and with the default timings nothing changes.
