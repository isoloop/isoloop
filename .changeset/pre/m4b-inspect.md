---
'@isoloop/host': minor
'@isoloop/protocol': minor
---

New, `@experimental`: `kernel.inspect()` gives an `Inspector` on the inspection feed ([ADR 0020](https://github.com/isoloop/isoloop/blob/main/docs/adr/0020-inspection-feed.md)), the one feed that M4a's dev MCP reads, and M4b's devtools panel will.

- `snapshot()` returns the isolates (as `kernel.isolates()` has them), the pools, the bus (its state, its restart count and the latest `bus:metrics`), and the last 200 kernel events.
- `on(fn)` delivers events as they happen. Beats and bus metrics are coalesced to about one message a second, with the latest beat per isolate. `close()` stops this inspector's listeners.
- The kernel always keeps a ring buffer of the last 200 events from its start, so a reader that arrives after a crash still sees it. Everything else costs nothing until a reader listens.
- Every message is plain, structured-cloneable data in the usual envelope: the `InspectMessage` types and the `isInspectMessage` guard in `@isoloop/protocol`. Readers ignore message types they don't know, so the format can only grow.
