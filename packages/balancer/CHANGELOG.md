# @isoloop/balancer

## 0.1.1

### Patch Changes

- 086920a: Docs: `useHost` now lists `requestCanvas` among the host calls, and the `maxWorkers` option says its default is `max(2, navigator.hardwareConcurrency - 2)` and that a value you set is raised to 1 if lower.
- Updated dependencies [532c3c1]
  - @isoloop/host@0.1.1

## 0.1.0

The first release, experimental: every export may change in any minor.

- **Placement by load:** spawn through the balancer instead of naming a pool, and it picks the worker.
- **Moves and packing:** it moves an isolate out of a pool that can't keep up, and empties a quiet pool into another to free a worker.
- **Quarantine:** an isolate that blocks or crashes waits in a quarantine pool until it has been quiet for a while.

The changes made during the previews are in the `0.1.0-next.N` sections below.

## 0.1.0-next.12

### Patch Changes

- 3afc5f8: Each package's homepage on npm is its page on isoloop.dev, and each has search keywords. The public packages' npm descriptions say that they're Isoloop's and what each one does.
- Updated dependencies [2788228]
- Updated dependencies [3afc5f8]
- Updated dependencies [03d13ef]
- Updated dependencies [cceac10]
  - @isoloop/host@0.1.0-next.12

## 0.1.0-next.11

### Patch Changes

- @isoloop/host@0.1.0-next.11

## 0.1.0-next.10

### Patch Changes

- 23c1bb4: Every public export of `@isoloop/vite`, `@isoloop/balancer`, `@isoloop/devtools` and `@isoloop/webmcp` has its reference comment: a lead sentence, its parameters, what it returns and throws, and each option's default. `isoloop()`, `createBalancer`, `connectDevtools` and `connectWebMCP` each have an example.
- Updated dependencies [b303cb3]
  - @isoloop/host@0.1.0-next.10

## 0.1.0-next.9

### Minor Changes

- 5793b1a: Names settled for the API freeze:
  
  - `@isoloop/vite`: `IsolateManifest`, the type of `isoloop-manifest.json`, is now `BuildManifest`, so it no longer shares a name with host's spawn manifest.
  - `@isoloop/host`: `kernel.request`'s options type is now `KernelRequestOptions` (`key`, `timeoutMs`, `signal`, `via`).
  - `@isoloop/runtime`: exports `RequestOptions` (`key`, `timeoutMs`), the type of `bus.request`'s options. `@isoloop/react` and `@isoloop/preact` re-export it for `useRequest`, in place of their own copies.
  - `@isoloop/balancer`: `createBalancer` takes host's `Kernel`. `KernelLike`, `ManifestLike`, `BeatLike`, `CrashLike`, `FailedLike` and `PoolLike` are no longer exported, and every export is `@experimental`.
  - Marked `@experimental`: consumer groups (`SubscribeOptions.group`, `autoCommit`, `bus.commit`) and request/reply (`bus.request`, `bus.reply`, a topic's `reply` schema, `useRequest`, `RequestOptions`).

### Patch Changes

- Updated dependencies [e5f3377]
- Updated dependencies [5793b1a]
- Updated dependencies [18972a8]
  - @isoloop/host@0.1.0-next.9

## 0.1.0-next.8

### Patch Changes

- Updated dependencies [6fc09f6]
  - @isoloop/host@0.1.0-next.8

## 0.1.0-next.7

### Patch Changes

- Updated dependencies [3c354e8]
  - @isoloop/host@0.1.0-next.7

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
