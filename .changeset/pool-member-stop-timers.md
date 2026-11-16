---
'@isoloop/runtime': patch
---

A stopped pool member's callbacks no longer run (ADR 0015, decision 9, amended). Once its `onShutdown` handlers settle, none of the timers, animation frames, idle callbacks, queued microtasks or port listeners it registered run again, and none is billed to its `busyMs`: each member instance holds a token that ends then. The gating is lazy (an interval clears itself and a port closes the next time they fire; a pending timeout keeps its closure until then), and a restart under the same name gets a new token. Work started outside the member's code and promise continuations aren't covered. Before, a member moved by the balancer kept burning CPU in the pool it left and doubled its `busyMs` when it came back.
