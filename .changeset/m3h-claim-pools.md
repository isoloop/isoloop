---
'@isoloop/host': minor
---

Pool names starting `balancer-` are reserved for `@isoloop/balancer` (ADR 0017). `kernel.spawn` with one throws a `KernelError` coded `reserved_pool`. The balancer gets them through `claimPools(kernel, 'balancer')`, an `@internal` export that returns a `spawn` allowed to use those pools and otherwise the same as `kernel.spawn`. A kernel can be claimed once, so it has one balancer; a second claim throws `balancer_exists`.
