---
'@isoloop/protocol': minor
'@isoloop/bus': patch
'@isoloop/runtime': patch
---

The bus port gains the messages for watchers (ADR 0023, `@experimental`): `watch` and `unwatch` from an isolate to the bus, `view` from the bus to an isolate, and `seen` on `commits`. A watcher reads the current value per key instead of the stream. The types `WatchKey` and `ViewValue` are new. `PROTOCOL` stays `{ v: 1, min: 1 }`: the additions are new message types and an optional field. The bus answers a `watch` or `unwatch` with `unsupported`, and the runtime's bus client ignores a `view`.
