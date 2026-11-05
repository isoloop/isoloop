---
'@isoloop/protocol': minor
'@isoloop/host': minor
'@isoloop/runtime': minor
---

The isolate `BusClient` (design §5). `ctx.bus` now talks to the bus worker on its own port: `publish` resolves on the broker's result or rejects with a `BusError`; `subscribe` runs handlers in order with `autoCommit` (at least once: a throwing handler stops commits, so its record is redelivered on the next start), `group` and `onReset`; `request` with a timeout; `reply`; and `commit` for manual commits. On `reattach` after a bus restart it resubscribes and re-sends every unanswered publish in order. `BusError` moves to `@isoloop/protocol` and is re-exported by host and runtime. M0's main-thread bus is now `ctx.legacyBus`, until M2 task 11 removes it.
