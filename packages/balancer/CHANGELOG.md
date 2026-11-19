# @isoloop/balancer

## 0.1.0-next.6

### Patch Changes

- Updated dependencies [8e04ddf]
  - @isoloop/host@0.1.0-next.6

## 0.1.0-next.5

### Patch Changes

- ca1a77f: Two fixes to the `room` fold, from the File processor's fault runs on `0.1.0-next.4` with `maxWorkers: 2`:
  
  - **The cap counts a pool a move has claimed,** from the moment it's claimed, before its worker runs. Before, a `full` move and a `backlog` move in the same decision could each open a new pool, one past `maxWorkers`.
  - **A second quarantine pool folds into the first like with like.** Offenders join a first quarantine that holds only offenders. Members that never offended, such as the other half of a bisect, join one that holds no offender, and the bisect ends. Before, only a pool of offenders folded, so a bisect's second half kept its worker while a member sharing a pool fell behind. Anyone who hasn't offended still never joins an offender.
- Updated dependencies [080059d]
  - @isoloop/host@0.1.0-next.5

## 0.1.0-next.4

### Minor Changes

- 8d7a656: A rising backlog outranks a second quarantine worker. When a member that shares a pool has a rising backlog and the cap leaves it nowhere to go, a quarantine pool beyond `balancer-quarantine-1` that holds only offenders folds into it (the new move reason `room`), which frees that worker for the backlog move. For the next 10 s no new quarantine pool takes a freed worker, and a bisect whose halves fold together ends. Before, a quarantine that had split could hold the last worker under `maxWorkers` for a whole quiet window while the members sharing a pool fell behind: in the File processor with faults, on `0.1.0-next.3` with `maxWorkers: 2`, six processors shared one worker for the rest of the run.

### Patch Changes

- @isoloop/host@0.1.0-next.4

## 0.1.0-next.3

### Patch Changes

- Updated dependencies [c2ad524]
- Updated dependencies [16b3e38]
- Updated dependencies [235d488]
- Updated dependencies [9137d5e]
- Updated dependencies [29f2296]
- Updated dependencies [c099c70]
- Updated dependencies [12e43d0]
  - @isoloop/host@0.1.0-next.3

## 0.1.0-next.2

### Minor Changes

- 5f6ff95: These changes follow a local run of the File processor that showed three ways the balancer moved too much or packed too little (M3j, [ADR 0017](https://github.com/isoloop/isoloop/blob/main/docs/adr/0017-opt-in-balancer.md)):
  
  - **The move budget.** A never-measured isolate's way out of the quarantine, where it starts, no longer counts toward the 3 moves in 5 minutes. Before, a new isolate that then had one move for load and one quarantine move had to wait out the budget, past its quiet window.
  - **Packing.** It now empties a quiet pool of several members into another, one member per pack, when the whole pool fits under 40 % there. Before, only an isolate alone in its pool packed.
  - **Backlog moves.** These need the backlog to rise over two 10 s windows in a row. A queue that jumps once and then holds no longer moves anything.

### Patch Changes

- @isoloop/host@0.1.0-next.2

## 0.1.0-next.1

### Minor Changes

- 87ea6ad: The balancer sees work its busy time misses, packs while work keeps arriving, lets offenders out of the quarantine sooner, and leaves alone an isolate the kernel gave up on (M3j, [ADR 0017](https://github.com/isoloop/isoloop/blob/main/docs/adr/0017-opt-in-balancer.md)).
  
  - `report(id, { backlog?, busyMs? })`: `busyMs` is the app's own measured busy time, a running total in ms since the isolate started, for work the runtime's `busyMs` doesn't see (slices resumed after `await`). The balancer uses the larger of it and the beats' figure over the 3 s window, wherever it reads a load. A report older than 10 s counts as none. `Report.backlog` is now optional; a report needs one of the two. `Placement.reportedPct` shows the reported figure.
  - Packing back no longer needs a backlog of 0: a member, and the pool it joins, qualify while their backlog is no higher than 60 s before.
  - An offender's quiet window is capped at 2 minutes, and back in a balancer pool it loses one offence per quiet window completed there.
  - A bisect starts only with a quarantine pool of its own: an empty quarantine, or room under the cap for a new one. Suspects never join offenders; with no room, the pool's members get `behind`.
  - `isolate:failed` (`KernelLike` now listens to it): the member's state is `failed`, it leaves its pool's load and any bisect, `on('failed', { id, pool, reason })` reports it, and no move restarts it. Once the app restarts it (`kernel.restart(id)`) and it beats, it's placed again as new.

### Patch Changes

- @isoloop/host@0.1.0-next.1

## 0.1.0-next.0

### Minor Changes

- 0e0ca1c: Experimental ([ADR 0017](https://github.com/isoloop/isoloop/blob/main/docs/adr/0017-opt-in-balancer.md)). `createBalancer(kernel)` places isolates in pools by measured load instead of a fixed `pool` name, moves one out when its pool lags or fills, and quarantines an isolate that keeps blocking. A kernel has one balancer at a time; `dispose()` gives the kernel back.
  
  This entry replaces the interim notes written during development with the package as it stands before its first versioned prerelease.
  
  The working notes written before this release are kept as history in [`docs/history/interim-changesets.md`](https://github.com/isoloop/isoloop/blob/main/docs/history/interim-changesets.md).

### Patch Changes

- Updated dependencies [0e0ca1c]
- Updated dependencies [f37983d]
  - @isoloop/host@0.1.0-next.0
