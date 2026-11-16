---
'@isoloop/balancer': minor
---

The balancer reads every heartbeat through the kernel's `isolate:beat` event instead of polling `isolates()` every 100 ms, which kept only each worker's latest beat and so missed most spikes (ADR 0017, amended). `maxWorkers` now counts only the balancer's own pools: `balancer-N`, plus any quarantine worker beyond the first. `balancer-quarantine-1` is allowed on top, and workers the app runs itself no longer count. `KernelLike` takes `on('isolate:beat')` in place of `isolates()`, and `IsolateLike` gives way to `BeatLike`.
