---
'@isoloop/host': minor
---

Pool members share fate (M2c, ADR 0001). When a pool member stops responding or its worker errors, every member on that worker crashes with it (each with its own `isolate:crash`, now carrying `pool`), the worker is terminated, and they restart together in a new one, each replaying from its committed offsets. A member's own fatal error, ready timeout or version mismatch stays that member's: the rest of the pool keeps running.
