---
'@isoloop/host': patch
---

`kernel.stop(id)` followed at once by `kernel.spawn()` with the same id, without awaiting `stop()`, no longer leaves the new isolate cut off. The old instance's `bye` (or the end of its grace) ended the bus connection by id, so it detached the new isolate's connection and dropped its subscriptions; in a pool it also shut the new member down, or terminated the pool's worker when it was the only member. The new isolate now stays `restarting` until the stopped one's worker is gone, then starts, which waits at most the stop grace. Messages the old worker sends meanwhile, other than `bye`, are dropped, so they can't reach the new isolate's surface. `stop()` resolves as before.
