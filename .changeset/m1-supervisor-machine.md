---
'@isoloop/host': minor
---

Supervisor state machine with a restart limit and backoff (design §4.3). A crash restarts the isolate after `250 ms × 2ⁿ` (capped at 4 s); a fourth crash within 60 s leaves it `failed`. A blocked isolate is killed after `killAfterMs`, and an isolate that never sends `ready` after `readyTimeoutMs`. New `KernelConfig.supervisor` (`strategy`, `maxRestarts`, `withinMs`, `backoff`) and `heartbeat.killAfterMs` / `readyTimeoutMs`; `restartAfterMs` is gone. New events `isolate:ready` and `isolate:failed`; `isolate:crash` carries a `reason`.
