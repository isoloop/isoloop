# @isoloop/host

## 0.1.0-next.0

### Minor Changes

- 0e0ca1c: The main-thread kernel. `createKernel` loads each isolate into its own worker or a named pool ([ADR 0001](https://github.com/isoloop/isoloop/blob/main/docs/adr/0001-one-worker-per-isolate.md), [ADR 0015](https://github.com/isoloop/isoloop/blob/main/docs/adr/0015-visual-pools.md)) and supervises it: heartbeats, blocked and killed loops, restarts with backoff, and a crash-loop guard (by default, three restarts within a minute, then `failed` until `kernel.restart`). It composites each isolate's surface into a shadow root within a frame budget, owns the URL and routing ([ADR 0002](https://github.com/isoloop/isoloop/blob/main/docs/adr/0002-host-owns-routing.md)), answers host calls, checks each isolate's `requires` against its `[FLOOR, VERSION]` range, and starts and supervises the bus worker. It reports through `isolate:*` and `bus:*` events, `kernel.isolates()` and `kernel.pools()`.
  
  This entry replaces the interim notes written during development with the package as it stands before its first versioned prerelease.
  
  The working notes written before this release are kept as history in [`docs/history/interim-changesets.md`](https://github.com/isoloop/isoloop/blob/main/docs/history/interim-changesets.md).

### Patch Changes

- f37983d: A consumer group no longer loses a record redelivered to a member (#211; ADR 0016, points 10–14). When a member left, its uncommitted records went to the others, and a member's next commit could cover one of them before its handler ran; if that member then stopped (a balancer move, say), nobody got the record again. Every `deliver` now carries a `seq`, counting deliveries to the subscription on its connection from 1, and every `commits` entry carries the highest `seq` settled whole with every delivery before it. A group commit covers only records with `offset ≤ offset` and `seq ≤ seq`, so a record redelivered after the deliveries it settled stays uncovered. Own subscriptions keep the offset rule, and host subscriptions send the same `seq`. `createCommitter`'s `settle` now takes `{ offset, seq }`, and `deliveryPoints` gives each record of a delivery its point.
  
  A consumer group that has a committed offset now resumes after it whatever `from` says: an emptied group rejoining with `from: 'earliest'` no longer replays the topic. `from` applies only before the group's first commit, or after its offsets were dropped with the topic, and a member joining a group that has members takes records from where the group is. Group members don't need `from: 'committed'` to keep their place.
  
  `ctx.bus.commit(record)` settles that record and every one delivered before it on its subscription, and a record delivered before a bus restart no longer commits on the new port.
- Updated dependencies [0e0ca1c]
- Updated dependencies [0e0ca1c]
- Updated dependencies [f37983d]
  - @isoloop/dom@0.1.0-next.0
  - @isoloop/protocol@0.1.0-next.0
