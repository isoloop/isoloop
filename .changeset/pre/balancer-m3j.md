---
'@isoloop/balancer': minor
---

The balancer sees work its busy time misses, packs while work keeps arriving, lets offenders out of the quarantine sooner, and leaves alone an isolate the kernel gave up on (M3j, [ADR 0017](https://github.com/isoloop/isoloop/blob/main/docs/adr/0017-opt-in-balancer.md)).

- `report(id, { backlog?, busyMs? })`: `busyMs` is the app's own measured busy time, a running total in ms since the isolate started, for work the runtime's `busyMs` doesn't see (slices resumed after `await`). The balancer uses the larger of it and the beats' figure over the 3 s window, wherever it reads a load. A report older than 10 s counts as none. `Report.backlog` is now optional; a report needs one of the two. `Placement.reportedPct` shows the reported figure.
- Packing back no longer needs a backlog of 0: a member, and the pool it joins, qualify while their backlog is no higher than 60 s before.
- An offender's quiet window is capped at 2 minutes, and back in a balancer pool it loses one offence per quiet window completed there.
- A bisect starts only with a quarantine pool of its own: an empty quarantine, or room under the cap for a new one. Suspects never join offenders; with no room, the pool's members get `behind`.
- `isolate:failed` (`KernelLike` now listens to it): the member's state is `failed`, it leaves its pool's load and any bisect, `on('failed', { id, pool, reason })` reports it, and no move restarts it. Once the app restarts it (`kernel.restart(id)`) and it beats, it's placed again as new.
