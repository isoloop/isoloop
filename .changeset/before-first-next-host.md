---
'@isoloop/host': minor
---

The main-thread kernel. `createKernel` loads each isolate into its own worker or a named pool ([ADR 0001](https://github.com/isoloop/isoloop/blob/main/docs/adr/0001-one-worker-per-isolate.md), [ADR 0015](https://github.com/isoloop/isoloop/blob/main/docs/adr/0015-visual-pools.md)) and supervises it: heartbeats, blocked and killed loops, restarts with backoff, and a crash-loop guard (by default, three restarts within a minute, then `failed` until `kernel.restart`). It composites each isolate's surface into a shadow root within a frame budget, owns the URL and routing ([ADR 0002](https://github.com/isoloop/isoloop/blob/main/docs/adr/0002-host-owns-routing.md)), answers host calls, checks each isolate's `requires` against its `[FLOOR, VERSION]` range, and starts and supervises the bus worker. It reports through `isolate:*` and `bus:*` events, `kernel.isolates()` and `kernel.pools()`.

This entry replaces the interim notes written during development with the package as it stands before its first versioned prerelease.

The working notes written before this release are kept as history in [`docs/history/interim-changesets.md`](https://github.com/isoloop/isoloop/blob/main/docs/history/interim-changesets.md).
