# @isoloop/balancer

Automatic placement: `createBalancer`, and the options, events and reports it takes.

## `@isoloop/balancer`

### `createBalancer`

**Experimental.** The policy and its options may change before 1.0. It decides on the main thread, from every heartbeat (`isolate:beat`), and moves an isolate by stopping it and spawning it again with another `pool`; the kernel itself never pools on its own (ADR 0001). Isolates spawned with `kernel.spawn` are never touched, and don't count toward `maxWorkers`.

Automatic placement for isolates spawned through it (M3h, ADR 0017).

```ts nocheck
function createBalancer(kernel: Kernel, opts?: BalancerOptions): Balancer;
```

**Guides:** [Automatic placement: the balancer](../guide/balancer.md).

### `ArrivedEvent`

**Experimental.**

A moved member's first beat in its new pool (M3i). `costMs` is the time from
the balancer stopping it to that beat: what the move cost the isolate. It
follows `move`, which fires before the cost is known; a member stopped or
moved again before it beats never arrives.

```ts nocheck
type ArrivedEvent = MoveEvent & {
  costMs: number;
};
```

### `Balancer`

**Experimental.**

The balancer `createBalancer` returns. Pools are named `balancer-1`,
`balancer-2`…; the quarantine is `balancer-quarantine-1`, and `-2`, `-3`…
when a suspect needs a worker of its own. `createBalancer` throws
`balancer_exists` if the kernel has one.

```ts nocheck
interface Balancer {
  spawn(manifest: IsolateManifest): Placement;
  stop(id: string): Promise<void>;
  placements(): Placement[];
  measure(id: string): number | undefined;
  hold(id: string): () => void;
  report(id: string, report: Report): void;
  on<E extends keyof BalancerEvents>(event: E, fn: (e: BalancerEvents[E]) => void): () => void;
  dispose(): void;
}
```

| Member | Description |
| --- | --- |
| `spawn()` | Like `kernel.spawn`, but the balancer picks `pool`; `manifest.pool` must be absent. |
| `measure()` | `id`'s load over the last 3 s, as a share of one core (0–100), whether the balancer placed it or not: a preview's, for `loads.set` on Save. `undefined` until 3 s of beats have been seen. |
| `hold()` | Leaves `id` where it is until the returned function is called (a widget open for editing). |
| `report()` | The app's view of `id`'s queued work (M3i) and of its own busy time (M3j). A backlog that rose over two 10 s windows in a row (M3j), and is above 0, moves the isolate somewhere with more CPU. A reported `busyMs` total counts toward its load wherever the balancer reads one. A report older than 10 s counts as none, so report at least every few seconds. Throws a `TypeError` for a report with neither field, or a field that isn't a finite number of 0 or more. Ignored for isolates the balancer didn't place and ones the kernel gave up on. |
| `dispose()` | Stops watching and gives back the kernel's claim, so another balancer can be created on it; isolates keep running where they are. `spawn` throws afterwards. |

### `BalancerEvents`

**Experimental.**

The events `Balancer.on` takes, by name.

```ts nocheck
type BalancerEvents = {
  move: MoveEvent;
  arrived: ArrivedEvent;
  spike: SpikeEvent;
  behind: BehindEvent;
  failed: FailedEvent;
  foreign: ForeignEvent;
};
```

### `BalancerOptions`

**Experimental.**

```ts nocheck
type BalancerOptions = {
  maxWorkers?: number;
  spike?: {
    lagMs?: number;
  };
  sustained?: {
    lagMs?: number;
    forMs?: number;
  };
  headroom?: {
    loadPct?: number;
  };
  quarantine?: {
    steadyMs?: number;
    maxReturns?: number;
  };
  loads?: LoadStore;
  pack?: {
    enabled?: boolean;
  };
};
```

| Field | Description |
| --- | --- |
| `maxWorkers?` | The balancer's own allowance of workers (ADR 0017, amended): its `balancer-N` pools, plus any quarantine worker beyond the first. The quarantine, `balancer-quarantine-1`, is allowed on top, and workers the app runs itself don't count; the kernel's budget stays the page-wide warning. Default `max(2, navigator.hardwareConcurrency - 2)`; at least 1. |
| `spike?` | A beat with the pool's `lagMs` above this is a spike, put on the member that was busiest in it. A first spike is only reported (`spike`, action `noted`); a second from the same member within 60 s sends it to quarantine (M3i). Default 100. |
| `sustained?` | The pool's median `lagMs` above `lagMs` over `forMs` moves its heaviest member out. Default 50 ms over 3,000 ms. So does a pool whose members' busy time adds up to 80 % of a core or more over the same window, whatever its lag (a fixed threshold, above `headroom`). |
| `headroom?` | An isolate joins a pool only while pool load + its load stays under `loadPct`. Default 60. |
| `quarantine?` | Leaving quarantine: an isolate there only to be measured leaves once it has 3 s of beats there, or, if a bisect moved it there, once that bisect ends. An offender leaves after `steadyMs` (default 30,000 ms) with no spike and no crash, whatever its load; each offence doubles the window (30, 60, 120 s), capped at 2 minutes (or `steadyMs`, if longer). Back in a balancer pool, an offender loses one offence for each quiet window it completes there (M3j). After `maxReturns` returns (default 3) the next offence keeps it apart for good. Either goes where the placement rule finds room, or stays, flagged `atCap`, until there is. |
| `pack?` | Packing back (M3i; whole pools since M3j): a pool whose members have all been steady for 60 s (no spike, crash, lagging or full pool, and a backlog no higher than 60 s before) empties into another of the balancer's pools if both together stay under 40 % of a core, one member per pack, freeing a worker once the last is in. At most one pack every 60 s. On by default. |

### `BehindEvent`

**Experimental.**

A member's reported backlog keeps rising, but it already has its pool to
itself or the balancer has no worker or pool to give it (M3i). Also when
its pool's trouble needs a bisect and no quarantine pool is free for one
(M3j). Emitted when it first happens, then at most every 30 s while it
lasts. `backlog` is the latest fresh report, or 0.

```ts nocheck
type BehindEvent = {
  id: string;
  pool: string;
  backlog: number;
};
```

### `FailedEvent`

**Experimental.**

The kernel gave up on a member (`isolate:failed`, M3j). It drops out of its
pool's load and any bisect, and no move restarts it.

```ts nocheck
type FailedEvent = {
  id: string;
  pool: string;
  reason: string;
};
```

### `ForeignEvent`

**Experimental.**

An isolate the balancer didn't place turned up in one of its pools (see `Placement.foreign`).

```ts nocheck
type ForeignEvent = {
  id: string;
  pool: string;
};
```

### `LoadStore`

**Experimental.**

Where the balancer keeps each isolate's measured load between page loads,
so a reload places from history (M3h, Q17). The app supplies it; the
creator backs it with a persistent topic. `get` returning `undefined`
means "never measured": the isolate starts in quarantine.

```ts nocheck
interface LoadStore {
  get(id: string): number | undefined;
  set(id: string, loadPct: number): void;
}
```

### `MoveEvent`

**Experimental.**

A move, once the old copy has stopped and the new one is spawned.

```ts nocheck
type MoveEvent = {
  id: string;
  from: string;
  to: string;
  reason: MoveReason;
};
```

### `MoveReason`

**Experimental.**

Why a member moved: `spike` (a second long task within 60 s), `sustained`
(the pool's lag stayed high), `full` (the pool's members' busy time reached
80 % of a core, whatever its lag), `crash`, `bisect` (looking for a pool's
unnamed culprit), `steady` (back out of quarantine), `backlog` (its
reported backlog kept rising, M3i), `pack` (a quiet member joining
another pool to free a worker, M3i) or `room` (a quarantine pool beyond
the first folding into the first, like with like, so a member whose
backlog is rising gets its worker, M3j).

```ts nocheck
type MoveReason = "spike" | "sustained" | "full" | "crash" | "bisect" | "steady" | "backlog" | "pack" | "room";
```

### `Placement`

**Experimental.**

```ts nocheck
type Placement = {
  id: string;
  pool: string;
  state: PlacementState;
  loadPct: number | undefined;
  reportedPct?: number;
  atCap?: true;
  backlog?: number;
  behind?: true;
  foreign?: true;
};
```

| Field | Description |
| --- | --- |
| `loadPct` | Measured share of one core, 0–100: the larger of the beats' `busyMs` and the app's reported `busyMs` over the last 3 s; `undefined` until measured. |
| `reportedPct?` | The share of one core from the app's `busyMs` reports alone, while they're fresh (M3j). |
| `atCap?` | No pool had room and the worker cap was reached: placed anyway, or left where it is. |
| `backlog?` | The latest backlog `report`, while it's fresh (under 10 s old). |
| `behind?` | Its backlog is rising, or its pool needs a bisect, and the balancer has nowhere to give it (`behind`). |
| `foreign?` | In one of the balancer's pools, but not placed by it. The host reserves `balancer-*` pools, so this shouldn't happen; it is never moved. |

### `PlacementState`

**Experimental.**

`failed`: the kernel gave up on the isolate (past its restart limit, M3j).
The balancer never moves or restarts it; after `kernel.restart(id)` it's
placed again as new.

```ts nocheck
type PlacementState = "placed" | "quarantined" | "kept-apart" | "moving" | "failed";
```

### `Report`

**Experimental.**

What the app tells the balancer about an isolate (`report`): its queued
work, its own measured busy time, or both. At least one must be given.

```ts nocheck
type Report = {
  backlog?: number;
  busyMs?: number;
};
```

| Field | Description |
| --- | --- |
| `backlog?` | Work items waiting for the isolate, in any unit the app likes, as long as it's the same one each time. For a consumer group, report the group's backlog on every member. |
| `busyMs?` | Milliseconds of work the app measured for the isolate since it started: a running total, so a late or missed report still counts (M3j). For work the kernel's `busyMs` misses, such as slices resumed after `await`. The balancer takes its difference over the 3 s window and uses the larger of that and the beats' figure. A total that goes down is taken as a restart of the count. |

### `SpikeEvent`

**Experimental.**

A spike put on a member (M3i): `noted` for a first one (nothing moves), or
`quarantined` when it sends the member to quarantine, or restarts the quiet
window of one already there.

```ts nocheck
type SpikeEvent = {
  id: string;
  pool: string;
  lagMs: number;
  action: "noted" | "quarantined";
};
```

<!-- Generated by scripts/docs/api.ts from the published types. Do not edit: run `pnpm docs:api`. -->
