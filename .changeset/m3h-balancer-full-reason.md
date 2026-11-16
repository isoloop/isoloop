---
'@isoloop/balancer': minor
---

Moves made by the full-pool trigger now carry their own `MoveReason`, `full`, instead of `sustained`. A pool that is full and also lagging still reports `sustained`; `full` is the low-lag case, where members that yield often starve each other.
