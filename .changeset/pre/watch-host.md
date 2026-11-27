---
'@isoloop/host': minor
'@isoloop/protocol': minor
'@isoloop/runtime': minor
---

`kernel.watch(topic, onView, { keys? })` reads a topic's current value per key from the host, instead of its stream. It is experimental.

- It takes the same arguments as `ctx.bus.watch`: `onView(view, changed)` gets a snapshot first, then the keys that changed, and the next view waits until `onView` returns or its promise settles.
- The host's watches on one topic share one watch on the bus, on the union of their keys.
- After a bus restart a persistent topic keeps its values. A memory topic the restart lost comes back empty, with every key it had in `changed`.
- It throws without `KernelConfig.contracts`, as `kernel.subscribe` does.
- `@isoloop/host` exports the `OnView` and `WatchOptions` types.
- The watch logic moved from `@isoloop/runtime` to `@isoloop/protocol`, so the host and the isolate share it; `ctx.bus.watch` behaves as before.
