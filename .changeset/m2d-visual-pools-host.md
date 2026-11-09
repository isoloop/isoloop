---
'@isoloop/host': minor
---

Visual isolates can join a pool (ADR 0015): `spawn` accepts `pool` on an isolate with a surface, and a pool may mix headless and visual members. Each visual member renders into its own surface; a hang or a worker error restarts the whole pool, which redraws each member's surface. The `pools_headless_only` error is gone. Members of a pool share one document and can read each other's DOM and input, so pool only trusted isolates and keep widgets that handle secrets on their own worker.
