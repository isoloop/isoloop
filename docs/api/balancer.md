# @isoloop/balancer

Automatic placement: `createBalancer`, and the options, events and reports it takes.

## `@isoloop/balancer`

### `createBalancer`

**Experimental.** The policy and its options may change before 1.0.

Automatic placement for isolates spawned through it: it places each in a
pool with room by measured load, moves one out when its pool lags or is
full, and keeps one that blocks or crashes in a quarantine pool until it's
quiet again.

It decides on the main thread, from every heartbeat (`isolate:beat`), and
moves an isolate by stopping it and spawning it again with another `pool`;
the kernel never pools on its own. Isolates spawned with `kernel.spawn` are
never touched, and don't count toward `maxWorkers`. One balancer per kernel
at a time: `dispose()` frees the kernel for another.

```ts nocheck
function createBalancer(kernel: Kernel, opts?: BalancerOptions): Balancer;
```

| Parameter | Description |
| --- | --- |
| `kernel` | The kernel to place isolates in. |
| `opts` | The worker allowance and thresholds. Default: all defaults. |

**Returns:** The balancer.

**Throws:**
- {KernelError} `balancer_exists` when the kernel already has a balancer that hasn't been disposed.

**Example:**

```ts
import { createBalancer } from '@isoloop/balancer';

const balancer = createBalancer(kernel, { maxWorkers: 4 });
balancer.spawn({ id: 'task-1', src: '/isolates/task.js' });
balancer.on('move', (e) => console.log(e.id, e.from, '→', e.to, e.reason));
```

**Guides:** [Automatic placement: the balancer](../guide/balancer.md).

### `ArrivedEvent`

**Experimental.**

A moved member's first beat in its new pool. It follows `move`, which fires
before the cost is known; a member stopped or moved again before it beats
never arrives.

```ts nocheck
type ArrivedEvent = MoveEvent & {
  costMs: number;
};
```

### `Balancer`

**Experimental.**

The balancer `createBalancer` returns. Pools are named `balancer-1`,
`balancer-2`…; the quarantine is `balancer-quarantine-1`, and `-2`, `-3`…
when a suspect needs a worker of its own.

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
| `spawn()` | Spawns an isolate like `kernel.spawn`, but the balancer picks its pool: from its saved load if `loads` has one, else the quarantine, to be measured. |
| `stop()` | Stops an isolate and saves its load to `loads`. For an isolate the balancer didn't place, it's `kernel.stop(id)`. |
| `placements()` | Every isolate in the balancer's pools, its own and any foreign ones. |
| `measure()` | `id`'s load over the last 3 s, as a share of one core (0–100), whether the balancer placed it or not: a preview's, for `loads.set` on Save. |
| `hold()` | Leaves `id` where it is, for example while a widget is open for editing. Holds stack. |
| `report()` | The app's view of `id`'s queued work and of its own busy time. A backlog that rose over two 10 s windows in a row, and is above 0, moves the isolate somewhere with more CPU. A reported `busyMs` total counts toward its load wherever the balancer reads one. A report older than 10 s counts as none, so report at least every few seconds. Ignored for isolates the balancer didn't place and ones the kernel gave up on. |
| `on()` | Listens for one of the balancer's events. |
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

| Field | Description |
| --- | --- |
| `move` | An isolate moved. |
| `arrived` | A moved isolate beat in its new pool. |
| `spike` | A spike was put on an isolate. |
| `behind` | An isolate is behind and has nowhere to go. |
| `failed` | The kernel gave up on an isolate. |
| `foreign` | An isolate the balancer didn't place is in one of its pools. |

### `BalancerOptions`

**Experimental.**

The options of `createBalancer`: its worker allowance and the thresholds that move isolates.

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
| `maxWorkers?` | The balancer's own allowance of workers: its `balancer-N` pools, plus any quarantine worker beyond the first. The quarantine, `balancer-quarantine-1`, is allowed on top, and workers the app runs itself don't count; the kernel's worker budget stays the page-wide warning. Default `max(2, navigator.hardwareConcurrency - 2)`, taking 4 as the core count when there is no `navigator`. A value you set is raised to 1 if it's lower. |
| `spike?` | When a long task is a spike. A first spike from a member is only reported (`spike`, action `noted`); a second from the same member within 60 s sends it to quarantine. |
| `sustained?` | When a pool's lag stays high. The pool's heaviest member moves out. So does a pool whose members' busy time adds up to 80 % of a core or more over the same window, whatever its lag (a fixed threshold, above `headroom`). |
| `headroom?` | How much room a pool keeps. |
| `quarantine?` | Leaving quarantine. An isolate there only to be measured leaves once it has 3 s of beats there, or, if a bisect moved it there, once that bisect ends. An offender leaves after a quiet window with no spike and no crash, whatever its load; each offence doubles the window (30, 60, 120 s), capped at 2 minutes (or `steadyMs`, if longer). Back in a balancer pool, an offender loses one offence for each quiet window it completes there. Either goes where the placement rule finds room, or stays, flagged `atCap`, until there is. |
| `loads?` | Where measured loads are kept between page loads. Default: none, so every isolate starts in quarantine to be measured. |
| `pack?` | Packing back. A pool whose members have all been steady for 60 s (no spike, crash, lagging or full pool, and a backlog no higher than 60 s before) empties into another of the balancer's pools if both together stay under 40 % of a core, one member per pack, freeing a worker once the last is in. At most one pack every 60 s. |

### `BehindEvent`

**Experimental.**

A member's reported backlog keeps rising, but it already has its pool to
itself or the balancer has no worker or pool to give it. Also when its
pool's trouble needs a bisect and no quarantine pool is free for one.
Emitted when it first happens, then at most every 30 s while it lasts.

```ts nocheck
type BehindEvent = {
  id: string;
  pool: string;
  backlog: number;
};
```

| Field | Description |
| --- | --- |
| `id` | The isolate's id. |
| `pool` | Its pool. |
| `backlog` | The latest fresh backlog report, or 0. |

### `FailedEvent`

**Experimental.**

The kernel gave up on a member (`isolate:failed`). It drops out of its
pool's load and any bisect, and no move restarts it.

```ts nocheck
type FailedEvent = {
  id: string;
  pool: string;
  reason: string;
};
```

| Field | Description |
| --- | --- |
| `id` | The isolate's id. |
| `pool` | The pool it was in. |
| `reason` | The kernel's reason for giving up. |

### `ForeignEvent`

**Experimental.**

An isolate the balancer didn't place turned up in one of its pools (see `Placement.foreign`).

```ts nocheck
type ForeignEvent = {
  id: string;
  pool: string;
};
```

| Field | Description |
| --- | --- |
| `id` | The isolate's id. |
| `pool` | The balancer's pool it turned up in. |

### `LoadStore`

**Experimental.**

Where the balancer keeps each isolate's measured load between page loads,
so a reload places it from history instead of measuring it again. The app
supplies it, for example backed by a persistent topic.

```ts nocheck
interface LoadStore {
  get(id: string): number | undefined;
  set(id: string, loadPct: number): void;
}
```

| Member | Description |
| --- | --- |
| `get()` | The load saved for `id`. |
| `set()` | Saves `id`'s measured load. The balancer calls it every 10 s when a load has moved by 5 points or more since it was saved, and when the isolate stops. The app can call it too, with `measure()`'s figure. |

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

| Field | Description |
| --- | --- |
| `id` | The isolate's id. |
| `from` | The pool it left. |
| `to` | The pool it was spawned in. |
| `reason` | Why it moved. |

### `MoveReason`

**Experimental.**

Why a member moved: `spike` (a second long task within 60 s), `sustained`
(the pool's lag stayed high), `full` (the pool's members' busy time reached
80 % of a core, whatever its lag), `crash`, `bisect` (looking for a pool's
unnamed culprit), `measured` (out of quarantine after being measured there),
`steady` (an offender back out of quarantine after its quiet window), `backlog` (its
reported backlog kept rising), `pack` (a quiet member joining another pool
to free a worker) or `room` (a quarantine pool beyond the first folding
into the first, like with like, so a member whose backlog is rising gets
its worker).

```ts nocheck
type MoveReason = "spike" | "sustained" | "full" | "crash" | "bisect" | "steady" | "measured" | "backlog" | "pack" | "room";
```

### `Placement`

**Experimental.**

Where the balancer has put an isolate, and what it knows of its load.

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
| `id` | The isolate's id. |
| `pool` | The pool it's in. |
| `state` | Where it stands. |
| `loadPct` | Measured share of one core, 0–100: the larger of the beats' `busyMs` and the app's reported `busyMs` over the last 3 s; `undefined` until measured. |
| `reportedPct?` | The share of one core from the app's `busyMs` reports alone, while they're fresh. |
| `atCap?` | No pool had room and the worker cap was reached: placed anyway, or left where it is. |
| `backlog?` | The latest backlog `report`, while it's fresh (under 10 s old). |
| `behind?` | Its backlog is rising, or its pool needs a bisect, and the balancer has nowhere to give it (`behind`). |
| `foreign?` | In one of the balancer's pools, but not placed by it. The host reserves `balancer-*` pools, so this shouldn't happen; it is never moved. |

### `PlacementState`

**Experimental.**

Where an isolate stands:
- `placed`: in one of the balancer's pools;
- `measuring`: in a quarantine pool only to be measured, because it was
never measured or a bisect moved it there; it leaves once it has been
measured, and becomes `quarantined` in place if it spikes or crashes first;
- `quarantined`: in a quarantine pool after an offence (a second spike, a
crash, or a bisect's culprit);
- `kept-apart`: an offender past `quarantine.maxReturns`, kept out of the
shared pools for good;
- `moving`: stopped, and being spawned in its new pool;
- `failed`: the kernel gave up on it (past its restart limit). The balancer
never moves or restarts it; after `kernel.restart(id)` it's placed again
as new.

```ts nocheck
type PlacementState = "placed" | "measuring" | "quarantined" | "kept-apart" | "moving" | "failed";
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
| `busyMs?` | Milliseconds of work the app measured for the isolate since it started: a running total, so a late or missed report still counts. For work the kernel's `busyMs` misses, such as slices resumed after `await`. The balancer takes its difference over the 3 s window and uses the larger of that and the beats' figure. A total that goes down is taken as a restart of the count. |

### `SpikeEvent`

**Experimental.**

A spike put on a member: `noted` for a first one (nothing moves), or
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

| Field | Description |
| --- | --- |
| `id` | The member the spike was put on: the busiest in the beat. |
| `pool` | Its pool. |
| `lagMs` | The pool's lag in that beat, in milliseconds. |
| `action` | What the balancer did. |

<!-- Generated by scripts/docs/api.ts from the published types. Do not edit: run `pnpm docs:api`. -->
