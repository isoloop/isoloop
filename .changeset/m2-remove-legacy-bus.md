---
'@isoloop/protocol': minor
'@isoloop/host': minor
'@isoloop/runtime': minor
---

The M0 main-thread bus is gone: the `x-pub` / `x-sub` / `x-deliver` envelopes, `ctx.legacyBus`, the `bus:publish` event and `BusDelivery`. Every record now travels on the bus worker's ports, never through the main thread (I7). `kernel.debug.messages()` (internal) counts what the main thread receives by type, for the I7 test.
