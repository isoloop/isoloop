# Automatic placement: the balancer

`@isoloop/balancer` (**experimental**) decides where isolates run: you spawn through it instead of naming a pool.

## When to use it

The balancer places each isolate in a pool with room, moves one out when its pool can't keep up, and keeps an isolate that blocks or crashes in a quarantine pool until it has been quiet for a while.

The kernel doesn't place anything on its own. Without the balancer nothing changes; with it, only the isolates you spawn through it are ever moved.

| Use the balancer | Place by hand ([pools guide](pools.md)) |
| --- | --- |
| Isolates whose cost you can't know in advance: user-added widgets, plug-ins, jobs of varying size | Isolates whose cost and failure domains you know |
| Pages where a heavy or misbehaving isolate must not slow its neighbours for long | Groups that must fail together, or stay apart, for reasons other than load (a machine's feed with its widgets; widgets that handle secrets, which belong on their own worker) |
| Workloads that change while the page runs | Pages measured placement by placement, where moves would blur the figures |

It doesn't replace thinking about failure domains: it groups by load, not by what belongs together. A move also restarts the isolate (see [Moves](#moves)), so isolates that can't afford a restart are better placed by hand.

## The API

```ts
import { createKernel } from '@isoloop/host';
import { createBalancer } from '@isoloop/balancer';

import taskUrl from './task?isolate';
import chartUrl from './chart?isolate';

const kernel = createKernel({ contracts, workers });
const balancer = createBalancer(kernel);

balancer.spawn({ id: 'task-1', src: taskUrl });          // no `pool`: the balancer picks one
balancer.spawn({ id: 'chart-1', src: chartUrl, surface: document.getElementById('chart')! });
balancer.on('move', (e) => console.log(`${e.id}: ${e.from} → ${e.to} (${e.reason})`));
```

To see it work, the processor example's **Playground** ([isoloop/web `apps/processor`](https://github.com/isoloop/web/tree/main/apps/processor)) spawns tasks with a CPU slider each, Block and Crash buttons, and one column per pool, so every move shows up with its reason.

```ts nocheck
const balancer = createBalancer(kernel, options?);
```

| Call | What it does |
| --- | --- |
| `spawn(manifest)` | Like `kernel.spawn`, but the balancer picks `pool`. Returns the `Placement`. Throws a `TypeError` if `manifest.pool` is set or the id is already running. |
| `stop(id)` | Stops the isolate and forgets it. |
| `hold(id)` | Leaves the isolate where it is until the returned function is called, for example while a widget is open for editing. If a trigger picks a held isolate, the balancer waits for the release rather than moving another in its place. |
| `measure(id)` | The isolate's load over the last 3 s from its beats, as a share of one core (0–100), for any isolate, placed by the balancer or not. `undefined` until 3 s of beats have been seen. |
| `report(id, { backlog?, busyMs? })` | What the app knows about the isolate: how much work is queued for it, and the busy time it measured itself, as a running total in ms since the isolate started (below). Give at least one; each must be a finite number, 0 or more, or it throws a `TypeError`. Report every second or so: a report older than 10 s counts as none. |
| `placements()` | `{ id, pool, state, loadPct, reportedPct?, backlog?, atCap?, behind?, foreign? }` for every isolate it placed. `state` is `placed`, `quarantined`, `kept-apart`, `moving` or `failed`. `loadPct` is the larger of the beats' and the reported figure; `reportedPct` is the reported one alone, while it's fresh. |
| `on('move', fn)` | `{ id, from, to, reason }` for every move (reasons below). |
| `on('arrived', fn)` | `{ id, from, to, reason, costMs }` when a moved isolate first beats in its new pool: `costMs` is the time from stopping it. |
| `on('spike', fn)` | `{ id, pool, lagMs, action }` for every spike put on a member: `noted` for a first one, `quarantined` when it sends the member to quarantine. |
| `on('behind', fn)` | `{ id, pool, backlog }` when an isolate's backlog keeps rising, or its pool needs a bisect, and the balancer has nowhere to give it. At most every 30 s per isolate. |
| `on('failed', fn)` | `{ id, pool, reason }` when the kernel gave up on an isolate (`isolate:failed`, below). |
| `on('foreign', fn)` | An isolate it didn't place turned up in one of its pools. The host reserves those pools, so this shouldn't happen. It's flagged, never moved. |
| `dispose()` | Stops watching and gives back the kernel's claim, so another balancer can be created on it. Isolates keep running where they are; `spawn` throws afterwards. |

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `maxWorkers` | `max(2, navigator.hardwareConcurrency − 2)`; a value you set is raised to 1 if lower | The balancer's own allowance of workers: its `balancer-N` pools and any quarantine worker beyond the first, counted from the moment a move claims a pool, before its worker runs. Workers your app runs itself don't count. |
| `spike.lagMs` | 100 | One beat with the pool's lag above this is a spike, put on its busiest member. A first one is only reported; a second from the same member within 60 s sends it to quarantine. |
| `sustained.lagMs`, `sustained.forMs` | 50 ms, 3,000 ms | The pool's median lag above `lagMs` over `forMs` moves its heaviest member out. |
| `headroom.loadPct` | 60 | An isolate joins a pool only while the pool's load plus its own stays under this. |
| `quarantine.steadyMs` | 30,000 | How long an offender must stay quiet to leave quarantine. Each offence doubles it, up to 2 minutes (or `steadyMs`, if longer). |
| `quarantine.maxReturns` | 3 | Returns from quarantine allowed; the next offence keeps the isolate apart for good. |
| `loads` | none | A store `{ get(id), set(id, loadPct) }` for measured loads, so a reload places from history (below). |
| `pack.enabled` | `true` | Packing back: a quiet pool empties into another to free a worker (below). |

These are fixed, not options:

- decisions every 500 ms over a 3 s window
- the full-pool threshold of 80 %
- loads written back at most every 10 s, and only on a change of 5 points or more
- a bisect forgotten 60 s after its last trigger
- the backlog's 10 s window
- at most 3 moves for load per isolate in 5 minutes
- packing's 60 s steady window, 40 % bar and one pack a minute

### Pool names and one balancer per kernel at a time

The balancer's pools are `balancer-1`, `balancer-2`…, and its quarantine is `balancer-quarantine-1`, with `-2`, `-3`… when a suspect needs a worker of its own. The host reserves every pool name starting with `balancer-`: a plain `kernel.spawn` naming one throws a `KernelError` coded `reserved_pool`. The balancer gets those names through the host's internal `claimPools`. A kernel has one claim at a time, so a second `createBalancer` on the same kernel throws `balancer_exists` while the first is alive. `dispose()` gives the claim back: a new balancer can then be created on the kernel. It leaves the old balancer's isolates where they are and opens pools of its own next to them.

## How it decides

The balancer listens to the kernel's `isolate:beat` event: every heartbeat of every isolate, with its worker's `lagMs` and its own `busyMs` (below). It keeps a 3 s window per pool and per member. A member's load is its `busyMs` divided by the beat interval, or the busy time the app reports for it over the same window, whichever is larger; a pool's load is the sum over its members. It also listens to `isolate:crash` and `isolate:failed`.

### Placing

- **By predicted load.** A new isolate joins the pool where its load plus the pool's stays under 60 % of a core. If no pool passes, it gets a new pool, within `maxWorkers`. If the cap is reached, it joins anyway and its placement reports `atCap`.
- **Unmeasured isolates start in quarantine,** to be measured. They leave as soon as they have 3 s of beats there. While it's measured, `placements()` shows a new isolate as `quarantined`, and it leaves with a move whose `reason` is `steady`: the same state and reason as an offender, so an app that lists placements shows every new isolate as one until it's measured. Pass `loads` so they arrive measured, and skip that stay: the interactive dashboards measure a widget's preview with `measure()` on Save and store it with `loads.set`, and the balancer writes measured loads back as it goes.

### Moving

| Trigger | When | Where the member goes | `reason` |
| --- | --- | --- | --- |
| Spike | One beat with the pool's `lagMs` over 100 ms (a long task), a second time from the same member within 60 s | The busiest member in that interval goes to quarantine. A first spike is only reported (`spike`, `noted`) | `spike` |
| Sustained | The pool's median `lagMs` over 50 ms across 3 s | The heaviest member goes to a pool with room (the 60 % rule), or a new pool within the cap | `sustained` |
| Full | The members' `busyMs` add up to 80 % of a core or more across 3 s, whatever the lag | As for sustained | `full` |
| Crash | A member's error restarted its pool | That member goes to quarantine | `crash` |
| Kill, culprit unknown | A member blocked until the supervisor killed the pool, so no beat named it | Half the pool's members go to quarantine on restart; whichever half blocks again holds the culprit | `bisect` |
| Backlog | The app's reported backlog rose over two 10 s windows in a row, and is above 0 | A pool of its own if the cap allows, else a pool with less load than its pool-mates; with neither, `behind` (but see the next row) | `backlog` |
| Room for a backlog | A member sharing a pool has a rising backlog and nowhere to go, and a quarantine pool beyond the first can join the first, like with like, so its worker can be freed | That quarantine pool folds into `balancer-quarantine-1`, all of it, and the backlog move follows once its worker has stopped | `room` |
| Quiet again | An offender's quiet window passed | Back to a pool with room | `steady` |
| Packing back | Every member of its pool steady for 60 s | Into another of the balancer's pools that stays under 40 % with the whole pool, one member at a time | `pack` |

The full trigger exists because well-behaved heavy work never looks like lag: tasks that yield every few milliseconds keep `lagMs` at 0–30 ms while their pool runs at 88 % and starves its members. Placement stops adding at 60 % and moving starts at 80 %; the gap keeps the balancer from moving the same isolate back and forth.

Some rules keep it from making things worse:

- **Cooldown.** After a move, both pools wait 30 s, with at most one move per pool per cooldown, and need fresh evidence gathered after it.
- **Check after a move.** If the pool's lag didn't fall, the next-heaviest member moves.
- **When `busyMs` can't explain the lag** (the pool lags, but its members' loads add up to under half the interval, with any reported busy time counted), the balancer bisects instead of trusting the figures.
- **Only moves that help.** A move for load is made only if the moves it starts are predicted to bring the pool back under its line. Otherwise the isolate stays and is flagged `atCap`.
- **A move budget.** Each isolate gets at most 3 moves for load (sustained, full, backlog, pack, and leaving the quarantine) in 5 minutes. Quarantine and bisect moves protect the others, so they aren't limited, though they count toward the 3. A never-measured isolate's way out of the quarantine, where it starts, doesn't count: it's no decision to help, and counting it left a new isolate one incident from a quarantine stay past its quiet window.
- **One backlog move per fresh 10 s window,** across the balancer, so the members of a consumer group move one at a time, the one in the busiest pool first.
- **Alone in its pool.** A member that spikes alone isn't moved unless it has offended before, since moving it spares no one. Nothing joins that pool for 30 s.
- **A move never lands in a pool that would then be over budget.** With nowhere to go, the member stays and is flagged `atCap`.

### The quarantine

One shared pool, `balancer-quarantine-1`, outside normal placement and outside `maxWorkers`. Suspects can slow each other there, but never a healthy pool. If it goes over budget with more than one member, its heaviest member gets a quarantine worker of its own, and that worker counts against `maxWorkers`. A blocker found by a bisect gets one too.

- **Leaving:** an offender leaves after its quiet window (30 s, then 60 s, then 120 s after repeat offences, and never more than 2 minutes) with no spike and no crash, **whatever its load**. Where it goes is the normal placement rule; a heavy but quiet isolate is the full trigger's business, not the quarantine's. With no room anywhere it stays, flagged `atCap`, until there is.
- **Offences wear off.** Back in a balancer pool, an offender loses one offence for each quiet window it completes there, so one that stays quiet is back to the 30 s window. One that offends again soon after leaving gets the next, longer window.
- **Kept apart:** the fourth offence keeps it in quarantine for good (`state: 'kept-apart'`).
- **Measured-only members** leave once measured, except the ones a bisect moved there, which stay until that bisect ends.
- **A backlog outranks a second quarantine worker.** While a member that shares a pool has a rising backlog and no room, the quarantine pools beyond the first fold back into the first, one pool at a time (`room`). They fold like with like: offenders into a first quarantine of offenders, or members that never offended, such as the other half of a bisect, into one with no offender. Anyone who hasn't offended still never joins an offender. For the next 10 s no new quarantine pool takes the worker that frees up. A bisect whose halves fold together ends. Without this, a quarantine that had split could hold the last worker under the cap for a whole quiet window while healthy members fell behind. That happened in the File processor with faults, on `@isoloop/*@0.1.0-next.3` with `maxWorkers: 2` (a bench server at 2.0 GHz): two image processors in two quarantine pools left six others sharing one worker. On `0.1.0-next.4`, on the same server, Firefox's two pools held the two halves of a bisect instead.
- **A bisect needs a quarantine pool of its own.** It starts only when the quarantine is empty (or holds only that bisect's own suspects), or the cap leaves room for a new quarantine pool. Suspects never join a pool that holds offenders: when a pool's worker is killed, every member there counts a crash, so crowding suspects in with a blocker gets them all given up on. With no room, the pool stays as it is and its members are `behind`.

### Packing back

A pool whose members have all been steady for 60 s empties into another of the balancer's pools, one member per pack, which frees its worker once the last one is in. Steady means no spike, crash, sustained or full trigger, and a backlog no higher than 60 s before: a queue that holds steady while work arrives is fine, a growing one isn't. The pool it joins must stay under 40 % of a core with the whole pool, below the 60 % placement line so it doesn't trip at once, and must not have a member moving, in trouble in the last 60 s, or with a growing backlog. The lightest such pool goes first, its lightest member first, into the fullest pool that fits; a merge under way is finished before another starts, and at most one member packs per minute. Never a pool with a held, `kept-apart` or out-of-budget member. For a pool of one, a single pack frees its worker. `pack: { enabled: false }` turns it off.

### Isolates the kernel gave up on

The kernel gives up on an isolate that crashes past its restart limit (by default, a 4th crash unless it ran 60 s or more before one of them) and emits `isolate:failed`. The balancer then marks it `failed`: it leaves its pool's load, the quarantine's count and any bisect, `on('failed')` reports it, and no move restarts it. Restarting it is the app's choice, with `kernel.restart(id)`; when it beats again, the balancer takes it as new, with no offences, from the pool it restarted in. `balancer.stop(id)` forgets it as usual.

## Moves

A move is `stop`, then `spawn` again with the same id and the new pool. There's no way to start the new copy first, because ids are unique.

- **State comes back from the bus,** within each topic's retention, as after any restart. Subscriptions start where their `from` says; give isolates that must not lose their place `from: 'committed'` or a compacted topic to read from `'earliest'`. Consumer groups keep their place without it: a group that has committed resumes after its committed offset whatever `from` says, and a member joining a group that has members takes records from where the group is. A consumer group's records that a moved member hadn't committed go to the group's other members, or come back to it if it was the only one. Some of them may have been handled already, since delivery is at least once, so a group's consumers must tolerate repeats.
- **A visual isolate goes blank until it redraws,** with a fresh surface. Show something meanwhile: the interactive dashboards put a "Moving…" overlay on the widget until it draws again.
- **The old copy's timers don't follow it.** Once a pool member's `onShutdown` handlers settle, none of its timers, animation frames, idle callbacks, queued microtasks or port listeners run again, so a move doesn't leave work behind in the pool it left.

## `busyMs`: what's measured

Each isolate's heartbeat reports `busyMs`: the time its worker spent running that isolate's code in the last interval. `kernel.isolates()` shows it on each snapshot, and `kernel.on('isolate:beat', fn)` delivers every beat as `{ id, pool?, lagMs, busyMs?, at }`. The kernel only emits the event while something listens. Both are public, so you can use them without the balancer.

How it's attributed:

- The runtime wraps the worker's `setTimeout`, `setInterval`, `requestAnimationFrame`, `queueMicrotask`, `requestIdleCallback` and the message ports an isolate creates, in every worker, before any isolate loads. Each callback is billed to the isolate that registered it. The wrappers behave like the originals (same ids, same `this`, arguments and errors, native `name` and `length`).
- React renders are timed per scheduler task through a minimal DevTools hook and split among the roots that committed in that task; Preact renders through its public `options` hooks.
- Work shared by several isolates in one task is split equally among them.

Its limits:

- Promise continuations, other libraries' own schedulers, and work shared by the whole worker (GC) belong to no isolate; they show up only in the worker's `lagMs`. Work that resumes after `await` is the common case: in the File processor's measurement each one did its work in slices resumed after `await` and measured 0 to 8 % of a core while its pool fell behind.
- **For work it misses, report your own.** If the app times its work (the processor times each slice of a file), `balancer.report(id, { busyMs })` with a running total since the isolate started, and the balancer uses the larger figure. A running total means a late or missed report still counts at the next one; a total that goes down is taken as a restart of the count.
- An equal split can make one isolate look lighter or heavier than it is.
- The clock is coarse on pages that aren't cross-origin isolated (100 µs). Short callbacks average out over a window; long tasks are measured almost exactly.

So `busyMs` is a placement guide, not a profiler.

## What it costs

- **Without the balancer:** every worker still times its callbacks for `busyMs`: two clock reads per callback, and a closure per timer registration. No extra messages.
- **With it:** one listener on the beats (about 10 a second per worker) and a decision every 500 ms on the main thread, plus each move's restart.
- **Workers:** up to `maxWorkers` pools of its own, plus the quarantine.

`maxWorkers` defaults to `max(2, navigator.hardwareConcurrency − 2)`. In a container or VM, `hardwareConcurrency` can report the host's threads rather than the cores the page may use. On the bench server it reported 16 in a container pinned to 4 cores, so the balancer allowed itself up to 8 pools. Set `maxWorkers` yourself there.

A balancer that watches every beat but never moves anything was measured on the processor example's File processor, on 4 cores at 2.0 GHz. One pool with it differs from one pool with no balancer by 0 to 1 point of CPU, a few MB and a few milliseconds of typing, within the rounds' spread. The figures, and what the balancer did with faults, are in the [File processor write-up](https://github.com/isoloop/web/tree/main/apps/processor/comparison).

## Inspecting it

- `balancer.placements()`: each isolate's pool, state, load and flags.
- `balancer.on('move')`: every move with its reason. The processor Playground and the plant interactive page keep a move log from it.
- `balancer.on('arrived')`, `on('spike')`, `on('behind')` and `on('failed')`: each move's cost, every spike and what it did, isolates with nowhere to go, and isolates the kernel gave up on.
- `kernel.pools()`: the `balancer-` pools and their members, like any pool.
- `kernel.on('isolate:beat')`: the raw feed the balancer reads.

## Limits

- **It's `@experimental` in 0.1.**
- **It groups by load, not by what belongs together,** and every move restarts the isolate ([When to use it](#when-to-use-it), [Moves](#moves)).
- **`busyMs` misses some work:** promise continuations, other libraries' schedulers and work the whole worker shares. Report your own busy time for work it misses ([`busyMs`](#busyms-whats-measured)).
- **`navigator.hardwareConcurrency` can overstate the cores** in a container or VM, and with it the default `maxWorkers` ([What it costs](#what-it-costs)).
- **One balancer per kernel at a time** ([Pool names](#pool-names-and-one-balancer-per-kernel-at-a-time)).

## See also

- [Worker pools](pools.md), for placing by hand.
- [The inspection feed](inspection.md), for reading pools and isolates from a tool.
