# Automatic placement: the balancer

`@isoloop/balancer` (**experimental**) decides where isolates run so you don't have to. You spawn through it instead of naming a pool. It places each isolate in a pool with room, moves one out when its pool can't keep up, and keeps an isolate that blocks or crashes in a quarantine pool until it has been quiet for a while. The decisions are in [ADR 0017](../adr/0017-opt-in-balancer.md).

```ts
import { createKernel } from '@isoloop/host';
import { createBalancer } from '@isoloop/balancer';

const kernel = createKernel({ /* … */ });
const balancer = createBalancer(kernel);

balancer.spawn({ id: 'task-1', src: taskUrl });          // no `pool`: the balancer picks one
balancer.spawn({ id: 'chart-1', src: chartUrl, surface: chartEl });
balancer.on('move', (e) => console.log(`${e.id}: ${e.from} → ${e.to} (${e.reason})`));
```

The kernel doesn't place anything on its own ([ADR 0001](../adr/0001-one-worker-per-isolate.md)). Without the balancer nothing changes; with it, only the isolates you spawn through it are ever moved.

To see it work, the processor example's **Playground** ([isoloop/web `apps/processor`](https://github.com/isoloop/web/tree/main/apps/processor)) spawns tasks with a CPU slider each, Block and Crash buttons, and one column per pool, so every move shows up with its reason.

## When to use it

| Use the balancer | Place by hand ([pools guide](pools.md)) |
| --- | --- |
| Isolates whose cost you can't know in advance: user-added widgets, plug-ins, jobs of varying size | Isolates whose cost and failure domains you know |
| Pages where a heavy or misbehaving isolate must not slow its neighbours for long | Groups that must fail together, or stay apart, for reasons other than load (a machine's feed with its widgets; widgets that handle secrets, which belong on their own worker) |
| Workloads that change while the page runs | Pages measured placement by placement, where moves would blur the figures |

It doesn't replace thinking about failure domains: it groups by load, not by what belongs together. A move also restarts the isolate (see [Moves](#moves)), so isolates that can't afford a restart are better placed by hand.

## The API

```ts
const balancer = createBalancer(kernel, options?);
```

| Call | What it does |
| --- | --- |
| `spawn(manifest)` | Like `kernel.spawn`, but the balancer picks `pool`. Returns the `Placement`. Throws a `TypeError` if `manifest.pool` is set or the id is already running. |
| `stop(id)` | Stops the isolate and forgets it. |
| `hold(id)` | Leaves the isolate where it is until the returned function is called, for example while a widget is open for editing. If a trigger picks a held isolate, the balancer waits for the release rather than moving another in its place. |
| `measure(id)` | The isolate's load over the last 3 s, as a share of one core (0–100), for any isolate, placed by the balancer or not. `undefined` until 3 s of beats have been seen. |
| `placements()` | `{ id, pool, state, loadPct, atCap?, foreign? }` for every isolate it placed. `state` is `placed`, `quarantined`, `kept-apart` or `moving`. |
| `on('move', fn)` | `{ id, from, to, reason }` for every move (reasons below). |
| `on('foreign', fn)` | An isolate it didn't place turned up in one of its pools. The host reserves those pools, so this shouldn't happen. It's flagged, never moved. |
| `dispose()` | Stops watching and gives back the kernel's claim, so another balancer can be created on it. Isolates keep running where they are; `spawn` throws afterwards. |

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `maxWorkers` | `max(2, navigator.hardwareConcurrency − 2)`, at least 1 | The balancer's own allowance of workers: its `balancer-N` pools and any quarantine worker beyond the first. Workers your app runs itself don't count. |
| `spike.lagMs` | 100 | One beat with the pool's lag above this sends its busiest member to quarantine. |
| `sustained.lagMs`, `sustained.forMs` | 50 ms, 3,000 ms | The pool's median lag above `lagMs` over `forMs` moves its heaviest member out. |
| `headroom.loadPct` | 60 | An isolate joins a pool only while the pool's load plus its own stays under this. |
| `quarantine.steadyMs` | 30,000 | How long an offender must stay quiet to leave quarantine. Each offence doubles it. |
| `quarantine.maxReturns` | 3 | Returns from quarantine allowed; the next offence keeps the isolate apart for good. |
| `loads` | none | A store `{ get(id), set(id, loadPct) }` for measured loads, so a reload places from history (below). |

Fixed, not options: decisions every 500 ms over a 3 s window, the full-pool threshold of 80 %, loads written back at most every 10 s and only on a change of 5 points or more, and a bisect forgotten 60 s after its last trigger.

### Pool names and one balancer per kernel at a time

The balancer's pools are `balancer-1`, `balancer-2`…, and its quarantine is `balancer-quarantine-1`, with `-2`, `-3`… when a suspect needs a worker of its own. The host reserves every pool name starting with `balancer-`: a plain `kernel.spawn` naming one throws a `KernelError` coded `reserved_pool`. The balancer gets those names through the host's internal `claimPools`. A kernel has one claim at a time, so a second `createBalancer` on the same kernel throws `balancer_exists` while the first is alive. `dispose()` gives the claim back: a new balancer can then be created on the kernel. It leaves the old balancer's isolates where they are and opens pools of its own next to them.

## How it decides

The balancer listens to the kernel's `isolate:beat` event: every heartbeat of every isolate, with its worker's `lagMs` and its own `busyMs` (below). It keeps a 3 s window per pool and per member. A member's load is its `busyMs` divided by the beat interval; a pool's load is the sum over its members.

### Placing

- **By predicted load.** A new isolate joins the pool where its load plus the pool's stays under 60 % of a core. If no pool passes, it gets a new pool, within `maxWorkers`. If the cap is reached, it joins anyway and its placement reports `atCap`.
- **Unmeasured isolates start in quarantine,** just to be measured. They leave as soon as they have 3 s of beats there. Pass `loads` so they arrive measured: the interactive dashboards measure a widget's preview with `measure()` on Save and store it with `loads.set`, and the balancer writes measured loads back as it goes.

### Moving

| Trigger | When | Where the member goes | `reason` |
| --- | --- | --- | --- |
| Spike | One beat with the pool's `lagMs` over 100 ms (a long task) | The busiest member in that interval goes to quarantine at once | `spike` |
| Sustained | The pool's median `lagMs` over 50 ms across 3 s | The heaviest member goes to a pool with room (the 60 % rule), or a new pool within the cap | `sustained` |
| Full | The members' `busyMs` add up to 80 % of a core or more across 3 s, whatever the lag | As for sustained | `full` |
| Crash | A member's error restarted its pool | That member goes to quarantine | `crash` |
| Kill, culprit unknown | A member blocked until the supervisor killed the pool, so no beat named it | Half the pool's members go to quarantine on restart; whichever half blocks again holds the culprit | `bisect` |
| Quiet again | An offender's quiet window passed | Back to a pool with room | `steady` |

The full trigger exists because well-behaved heavy work never looks like lag: tasks that yield every few milliseconds keep `lagMs` at 0–30 ms while their pool runs at 88 % and starves its members. Placement stops adding at 60 % and moving starts at 80 %; the gap keeps the balancer from moving the same isolate back and forth.

Some rules keep it from making things worse:

- **Cooldown.** After a move, both pools wait 30 s, with at most one move per pool per cooldown, and need fresh evidence gathered after it.
- **Check after a move.** If the pool's lag didn't fall, the next-heaviest member moves.
- **When `busyMs` can't explain the lag** (the pool lags, but its members' `busyMs` add up to under half the interval), the balancer bisects instead of trusting the figures.
- **Alone in its pool.** A member that spikes alone isn't moved unless it has offended before, since moving it spares no one. Nothing joins that pool for 30 s.
- **A move never lands in a pool that would then be over budget.** With nowhere to go, the member stays and is flagged `atCap`.

### The quarantine

One shared pool, `balancer-quarantine-1`, outside normal placement and outside `maxWorkers`. Suspects can slow each other there, but never a healthy pool. If it goes over budget with more than one member, its heaviest member gets a quarantine worker of its own, and that worker counts against `maxWorkers`. A blocker found by a bisect gets one too.

- **Leaving:** an offender leaves after its quiet window (30 s, then 60 s, then 120 s after repeat offences) with no spike and no crash, **whatever its load**. Where it goes is the normal placement rule; a heavy but quiet isolate is the full trigger's business, not the quarantine's. With no room anywhere it stays, flagged `atCap`, until there is.
- **Kept apart:** the fourth offence keeps it in quarantine for good (`state: 'kept-apart'`).
- **Measured-only members** leave once measured, except the ones a bisect moved there, which stay until that bisect ends.

Quiet isolates are never packed back together to save workers; the balancer only separates.

## Moves

A move is `stop`, then `spawn` again with the same id and the new pool. There's no way to start the new copy first, because ids are unique.

- **State comes back from the bus,** within each topic's retention, as after any restart. Subscriptions start where their `from` says; give isolates that must not lose their place `from: 'committed'` or a compacted topic to read from `'earliest'`. A consumer group's records that a moved member hadn't committed go to the group's other members or come back to it. A known bug can lose one of them: a commit in flight can cover a record redelivered meanwhile ([#211](https://github.com/isoloop/isoloop/issues/211)). Until it's fixed, the processor example subscribes `from: 'committed'`, commits only below the lowest record it still holds, and publishes its held records again when it stops; that repeats work, which a group's consumers must tolerate anyway, since delivery is at least once.
- **A visual isolate goes blank until it redraws,** with a fresh surface. Show something meanwhile: the interactive dashboards put a "Moving…" overlay on the widget until it draws again.
- **The old copy's timers don't follow it.** Once a pool member's `onShutdown` handlers settle, none of its timers, animation frames, idle callbacks, queued microtasks or port listeners run again ([ADR 0015](../adr/0015-visual-pools.md), decision 9), so a move doesn't leave work behind in the pool it left.

## `busyMs`: what's measured

Each isolate's heartbeat reports `busyMs`: the time its worker spent running that isolate's code in the last interval. `kernel.isolates()` shows it on each snapshot, and `kernel.on('isolate:beat', fn)` delivers every beat as `{ id, pool?, lagMs, busyMs?, at }`. The kernel only emits the event while something listens. Both are public, so you can use them without the balancer.

How it's attributed:

- The runtime wraps the worker's `setTimeout`, `setInterval`, `requestAnimationFrame`, `queueMicrotask`, `requestIdleCallback` and the message ports an isolate creates, in every worker, before any isolate loads. Each callback is billed to the isolate that registered it. The wrappers behave like the originals (same ids, same `this`, arguments and errors, native `name` and `length`).
- React renders are timed per scheduler task through a minimal DevTools hook and split among the roots that committed in that task; Preact renders through its public `options` hooks.
- Work shared by several isolates in one task is split equally among them.

Its limits:

- Promise continuations, other libraries' own schedulers, and work shared by the whole worker (GC) belong to no isolate; they show up only in the worker's `lagMs`.
- An equal split can make one isolate look lighter or heavier than it is.
- The clock is coarse on pages that aren't cross-origin isolated (100 µs). Short callbacks average out over a window; long tasks are measured almost exactly.

So `busyMs` is a placement guide, not a profiler.

## What it costs

- **Without the balancer:** every worker still times its callbacks for `busyMs`: two clock reads per callback, and a closure per timer registration. No extra messages.
- **With it:** one listener on the beats (about 10 a second per worker) and a decision every 500 ms on the main thread, plus each move's restart.
- **Workers:** up to `maxWorkers` pools of its own, plus the quarantine.

M3h measured these on the processor example's File processor, on 4 cores at 2.0 GHz: one pool with a balancer that watches every beat but never moves anything differs from one pool with no balancer by 0 to 1 point of CPU, a few MB and a few milliseconds of typing, within the rounds' spread. The figures, and what the balancer did with faults, are in the [File processor write-up](https://github.com/isoloop/web/tree/main/apps/processor/comparison).

## Inspecting it

- `balancer.placements()`: each isolate's pool, state, load and flags.
- `balancer.on('move')`: every move with its reason. The processor Playground and the plant interactive page keep a move log from it.
- `kernel.pools()`: the `balancer-` pools and their members, like any pool.
- `kernel.on('isolate:beat')`: the raw feed the balancer reads.
