---
'isoloop': minor
'@isoloop/host': minor
'@isoloop/protocol': patch
---

The dev MCP gains `isoloop_tap { topics, ms?, max? }`, a read: a live sample of the records published to some topics, for `ms` (3 s by default, at most 10 s), stopping early at `max` records (at most 100). It returns `{ records, skipped, ms }`: like the devtools panel's log, a tap gets at most 50 records a second, and `skipped` is how many the bus left out over that, reported once a second, so the last second's count can be missing. `connectDevMCP` answers it with `inspector.tap()` and its `onSkipped`, and ends the tap at `ms`, at `max`, or when the agent cancels or the page disconnects. `isoloop_records` still reads what a topic retains.
