---
'@isoloop/runtime': minor
'@isoloop/protocol': minor
'@isoloop/bus': minor
---

`ctx.bus.watch(topic, onView, { keys? })` reads a topic's current value per key instead of its stream. It is experimental.

- `onView(view, changed)` first gets a snapshot, the newest retained value of each key it watches, then the keys that changed. Values in between are skipped, so code that needs every record keeps `subscribe`.
- Records with no key share the key `null`. A key leaves the view when retention removes its newest record.
- Several watches on one topic share one watch on the bus, and each `onView` gets only its own keys. The next view waits until every `onView` on it has settled.
- After a bus restart a watch carries on by itself. A memory topic the restart lost comes back as an empty view.
- A large snapshot arrives in parts: every `view` message but the last has `more: true`, and `onView` runs once, after the last.
- `createTestContext` gives `ctx.bus.watch`, and `watches()` lists the open ones.
