---
'@isoloop/runtime': minor
---

Runs inside each isolate's worker. `defineIsolate` for plain-DOM isolates; the bus client on `ctx.bus` (`publish`, `subscribe`, `request`); host calls for layout, focus and scrolling; heartbeats; `ctx.reportError` for an error that's the isolate's own; and opt-in suspension. `/bootstrap` and `/worker` are the entries the host loads.

This entry replaces the interim notes written during development with the package as it stands before its first versioned prerelease.

The working notes written before this release are kept as history in [`docs/history/interim-changesets.md`](https://github.com/isoloop/isoloop/blob/main/docs/history/interim-changesets.md).
