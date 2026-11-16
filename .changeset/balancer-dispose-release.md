---
'@isoloop/balancer': patch
---

`dispose()` gives back the kernel's claim (ADR 0017): another `createBalancer` on the same kernel now succeeds after it, as a kernel has one balancer at a time rather than one for its whole life. A disposed balancer's `spawn` throws, and the isolates it placed keep running where they are.
