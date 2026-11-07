---
'@isoloop/bus': minor
---

Without OPFS sync access handles, persistent topics behave as memory topics: the bus reports `ready.storage: 'memory'` and the kernel emits `bus:durability-degraded { reason: 'no-sync-access' }` (ADR 0007, decision 6).
