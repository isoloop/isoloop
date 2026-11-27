---
'@isoloop/protocol': minor
'@isoloop/bus': patch
'@isoloop/runtime': patch
---

The bus port gains the messages for watchers. These messages are experimental.

- `watch` and `unwatch` go from an isolate to the bus, and `view` from the bus to an isolate. A watcher reads the current value per key instead of the stream.
- `commits` gains an optional `seen`, the highest view settled per watch.
- The types `WatchKey` and `ViewValue` are new.
- `PROTOCOL` stays `{ v: 1, min: 1 }`, since the additions are new message types and an optional field.
- The bus answers a `watch` or `unwatch` with `unsupported`, and the runtime's bus client ignores a `view`.
