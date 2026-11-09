---
'@isoloop/host': minor
---

Pools in the kernel's reports (M2c): `kernel.isolates()` gives each pool member's `pool`, and the new `kernel.pools()` lists every named pool with its members (not stopped), whether its worker runs, and its effective grants: the union of its members' grants, since members share a worker and can reach each other's bus ports (ADR 0001).
