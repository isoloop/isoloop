---
'@isoloop/host': patch
---

`claimPools` now returns `release()` as well (`@internal`, ADR 0017). Releasing gives the kernel's claim back: the released claim's `spawn` throws `reserved_pool`, isolates already in `balancer-` pools keep running, and the kernel can be claimed again. A kernel still has one claim at a time; a second claim throws `balancer_exists` while the first is held.
