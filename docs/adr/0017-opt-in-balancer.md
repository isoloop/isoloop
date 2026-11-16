# ADR 0017: An opt-in balancer, and a busy time per member

- **Status:** Accepted (2026-11-16), after grilling, with decision 2's attribution and the final additions settled with the user the same day. Amended 2026-11-16 (proposed): the balancer listens to a new `isolate:beat` event instead of polling (decision 3), adds a full-pool trigger (decision 3), its cap counts only its own workers (decision 4), and quiet is enough to leave the quarantine (decision 5).
- **Date:** 2026-11-16
- **Amends:** [ADR 0001](0001-one-worker-per-isolate.md), who places isolates: the runtime still never pools on its own, but an app may opt in to a library that places through the kernel API, in pool names the host reserves for it. Also [ADR 0015](0015-visual-pools.md) decision 1, likewise.
- **Plan:** [M3h](../plans/m3h-auto-placement.md), grilled 2026-11-16.

## Context

Placement is the host's choice alone (ADR 0001, ADR 0015 decision 1): an isolate gets its own worker or joins a pool the developer names. On the M3e interactive pages, the person adding a widget places it by hand. They can't know how heavy it will be. A heavy or blocking widget in a shared pool slows every member of that pool, which is the failure Isoloop exists to prevent.

What the runtime offers today to decide placement from measurements:

- **Heartbeat:** a beat every 100 ms per worker with `lagMs`, the drift of a `setInterval` in that worker. Members of a pool all get the same `lagMs`. Each member's `IdleReport` has `sinceDeliveryMs`, `inFlight` and `holds`, but no time spent.
- **Pools are created by naming them.** `spawn` with a new `pool` starts its worker, and the worker ends with its last member. There's no member cap.
- **No move.** Placement is fixed at spawn, so a move is `stop` then `spawn` again with the same id. Ids are unique, so the new copy can't start before the old one stops.
- **Delivery is per member.** Each member has its own bus port and gets its own copy of each record ([ADR 0016](0016-fewer-messages-per-record.md) defers one delivery per pool worker). Grouping isolates by topic saves no delivery work today.
- **The kernel's worker budget** (32) only warns. ADR 0001 rejected a budget based on the device's cores *for the kernel*.

ADR 0001's alternatives rejected "a pool for light isolates chosen by heuristics" as surprising behaviour. That remains right for the runtime. This ADR doesn't change the kernel's behaviour. It adds a separate library an app opts in to. The library uses the kernel API a developer uses by hand, plus one internal claim on a reserved pool prefix (decision 1).

## Decision

### 1. An opt-in, host-side balancer

`@isoloop/balancer`, published `@experimental`, runs on the main thread beside the kernel. It uses the public kernel API (`stop`, `isolates()`, `pools()` and `on`, including the `isolate:beat` event of decision 3), and spawns into its pools through the `@internal` `claimPools` (below).

```ts
const balancer = createBalancer(kernel, { maxWorkers?, spike?, sustained?, headroom?, quarantine?, loads? });
balancer.spawn(manifest)      // like kernel.spawn, but it picks `pool`; manifest.pool must be absent
balancer.stop(id)
balancer.hold(id)             // → release(); a held isolate is never moved (a widget open in the drawer)
balancer.measure(id)          // → loadPct, averaged over the last 3 s
balancer.placements()         // [{ id, pool, state: 'placed' | 'quarantined' | 'kept-apart' | 'moving', loadPct, atCap }]
balancer.on('move', e => …)   // { id, from, to, reason: 'spike' | 'sustained' | 'full' | 'crash' | 'bisect' | 'steady' }
balancer.dispose()
```

- **What it places:** only isolates spawned through `balancer.spawn`, into pools it owns: `balancer-1`, `balancer-2`… and quarantine pools `balancer-quarantine-1`, `balancer-quarantine-2`… It never moves an isolate spawned with `kernel.spawn` and never adds to a pool it didn't create. Other workers count only toward its cap.
- **One balancer per kernel, with a reserved pool prefix.** The host reserves every pool name that starts with `balancer-`.
  - A plain `kernel.spawn` with such a pool throws `reserved_pool`, as the bus rejects `isoloop.*` topics with `reserved_topic`.
  - The balancer gets the names through a new `@internal` host export, `claimPools(kernel, 'balancer') → { spawn }`. It works once per kernel; a second claim throws `balancer_exists`.
  - So no app code can place an isolate into a balancer pool by hand, and a balancer can't be confused by another one.
- **`hold(id)`:** returns a release function. While held, an isolate is never moved; the M3e drawer holds a widget while it's open for editing. If the member a trigger would move is on hold, the balancer waits for the release instead of moving another member in its place, then applies the usual rules.
- **`measure(id)`:** the isolate's load, averaged over the last 3 s. The M3e creator measures the preview on Save and stores the figure with `loads.set`.
- **`loads`:** an app-supplied store, `{ get(id), set(id, pct) }`, so measured loads survive a reload without the balancer owning a topic. The balancer writes each placed isolate's load back at most every 10 s, and only when it changed by 5 points or more. M3e's pages back the store with a persistent `creator.placement.v1` topic.
- **`atCap`:** a placement's `atCap` is true when its pool is over budget and the cap leaves nowhere to move to (decision 4).
- **No new grant.** Spawning and stopping stay host powers. A headless isolate holding a spawn grant was considered and not taken, since a grant to spawn and stop needs its own security design.
- **The kernel stays free of policy.** Without the balancer, nothing about placement changes.

### 2. `busyMs`, a public load signal per member

Each member's `IdleReport` gains `busyMs`: the time the worker spent running that member's code in the last heartbeat interval. A pool reports it per member in `members[id]`, and an own worker in `idle`. `IsolateSnapshot` gains `busyMs`. It's public, so M4's devtools can show it.

- **Clock:** `performance.now()` around each attributed callback. The example pages aren't cross-origin isolated, so the clock resolves to 100 µs (5 µs when isolated). A single short callback reads as 0 or one tick. Its start falls at a random point between ticks, so over a heartbeat window the sum averages out to the true total. A runtime test checks the sums against a coarse clock. The long tasks that matter for spikes (100 ms and up) are measured almost exactly.
- **Cost:** two clock reads per attributed callback, a few thousand a second on plant at 5 kHz. No new messages: one more number per member on the beat that already runs.
- **Not attributed:** work shared by the whole worker, such as GC, shows up only in `lagMs`.

#### How work is attributed to a member (decided 2026-11-16)

The runtime by itself sees only the callbacks it dispatches: bus deliveries, host events, DOM flushes and `start()`. But pool members call the worker's shared `setTimeout`, `setInterval` and `requestAnimationFrame` directly, and React renders inside its scheduler's `MessageChannel` tasks. Without more, an M3e widget's tick, its render and its canvas draw would all go unattributed, and the heavy member of a pool would look light. The balancer needs per-member attribution; a trial move (below) is only a fallback.

1. **The runtime wraps the worker's scheduling, in every worker,** own workers included, so one code path measures both placements. The wrapping happens before any member loads, at the point where pool workers freeze the built-ins (ADR 0001). It covers:
   - `setTimeout` and `setInterval`
   - `requestAnimationFrame`
   - `queueMicrotask`
   - `requestIdleCallback`, where present
   - `onmessage` and `addEventListener('message')` on the `MessageChannel` ports members create

   Each callback is billed to the member that was running when it was registered, so a chain of callbacks scheduled from inside one another stays attributed. Behaviour is identical to the native functions: the same ids, `clearTimeout` unchanged, `this` and arguments passed through, errors rethrown, and the native `name` and `length`. A conformance test checks this. Promise continuations are not wrapped.
2. **React: a minimal DevTools hook.** Production React builds don't call `<Profiler>`'s `onRender`, so the runtime installs a minimal `__REACT_DEVTOOLS_GLOBAL_HOOK__` before members load. Each scheduler task is timed through the wrapped `MessageChannel` port. Its time is split among the roots that committed in it (`onCommitFiberRoot`), each mapped to its member.
   - A test checks that production React calls the hook.
   - Assumed, unverified: the browser's React DevTools extension doesn't inject into workers, so the hook doesn't conflict with it.
   - M4's devtools may reuse it.
3. **Preact: public `options` hooks only.** `debounceRendering` times the render batch, and `diffed` finds the roots it touched. The batch's time is split among those roots by the same rule. No mangled internals are read.
4. **Shared-task time is split equally** among the members it served.
5. **Guards against a wrong guess:**
   - If a pool's `lagMs` is over budget but its members' `busyMs` sum to less than 50 % of the interval, the attribution can't explain the lag. The balancer then bisects (decision 3) instead of picking by `busyMs`.
   - After any move, the balancer checks that the pool's `lagMs` fell. If it didn't, it moves the next member.
6. **Always on, with no switch.** M3h's measurement includes the overhead with the balancer on and off. If the cost shows beyond the round spread, the timing becomes a kernel option, off by default and turned on by `createBalancer`.
7. **Known limits:** promise continuations, other libraries' own schedulers, and the equal split are approximations. Work that the wrapping can't trace is no member's time, and shows up only in `lagMs`. `AsyncContext` (would-like, under Rendering) would close part of this gap once browsers ship it. `busyMs` is a placement guide, not a profiler.

### 3. When the balancer acts

It listens to the kernel's `isolate:beat` event and feeds every beat into a 3 s ring of `lagMs` and `busyMs` per pool and member, and decides every 500 ms.

- **`isolate:beat`** (`@isoloop/host`, public): `{ id, pool?, lagMs, busyMs, at }`, emitted for each member on every heartbeat it reports (`at` is the host's receive time). The kernel emits it only while someone listens, so apps without a listener pay nothing. Devtools can use the same feed.
- **Why not polling** (amended 2026-11-16): the first build read `kernel.isolates()` every 100 ms. A snapshot holds only each worker's latest beat, which the next beat replaces about 100 ms later, so the beat that carried a spike was usually gone before it was read. On plant's interactive page the runtime reported a blocker correctly (`lagMs` 392, `busyMs` ≈ 402, a neighbour ≈ 1), yet the balancer caught it within 30 s in only 5 of 6 runs. Polling also skipped or double-read `busyMs` intervals, so loads were approximate. With the event, every beat counts once. A member's load is `busyMs` ÷ interval, and a pool's load is the sum over its members.

- **Spike:** a single `lagMs` over 100 ms (a long task). The member with the highest `busyMs` in that interval goes to the quarantine at once.
- **Sustained:** `lagMs` over 50 ms across the 3 s window. The heaviest member moves to a balancer pool with room.
- **Full** (amended 2026-11-16): the members' `busyMs` add up to 80 % of a core or more over the 3 s window, whatever the lag. The heaviest member moves to a pool that passes the 60 % rule (decision 4), or a new pool within `maxWorkers`; failing both, it's flagged `atCap`. Its move event carries the reason `full` (Q19); a pool that is full and also lagging reports `sustained`, so `full` marks the low-lag case. The same full window after a membership change and the same check after a move apply as for the sustained trigger. Placement stops adding at 60 % and moving starts at 80 %: the gap is the hysteresis. The quarantine is never "full". Found on the processor's playground: heavy tasks that yield often keep `lagMs` at 0–30 ms, so neither the spike nor the sustained trigger fired, while a pool at 88 % starved its members.
- **Crash:** when a pool restarts after a member's error, that member goes to the quarantine.
- **Killed, culprit unknown:** a member that blocks until the supervisor kills the pool never sends the beat that would name it. The balancer bisects: on restart, half the pool's members go to the quarantine, and whichever half blocks again holds the culprit. That takes about log₂(n) restarts, and healthy widgets are never all sent to the quarantine together. A bisect is forgotten 60 s after its last trigger. A blocker found by bisecting gets a quarantine worker of its own (`balancer-quarantine-2`…) if the cap allows.
- **Alone in its pool:** a member that spikes while alone in its pool isn't moved unless it has offended before, since moving it can't spare anyone. Nothing joins that pool for 30 s.

The thresholds, windows and the cap are options with these defaults. Fixed constants:
- decisions every 500 ms;
- loads saved every 10 s, only on a change of 5 points or more;
- a bisect forgotten 60 s after its last trigger;
- `kernel.pools()` read with each decision, for members and pools the balancer didn't place.

### 4. Where it places

- **Predicted load.** An isolate joins or moves into a pool only if the pool's load plus its own stays under 60 % (`headroom`). If no balancer pool passes, it gets a new pool if the cap allows. Otherwise it stays where it is, and its placements report `atCap` ("over budget, at worker cap"). A move never lands in a pool that would then be over budget.
- **Unmeasured isolates** (no `loads` entry) start in the quarantine, only to be measured. They leave as soon as they have 3 s of samples there, with no steady window. Members a bisect moved there are the exception: they stay until that bisect ends (culprit found, or forgotten), because "whichever half acts up again" needs them kept together. On the interactive pages a new widget is measured in M3e's preview before Save (`measure`, then `loads.set`), so it arrives measured.
- **Cap:** `maxWorkers`, default `max(2, navigator.hardwareConcurrency − 2)`, counts only the balancer's own workers: its `balancer-N` pools, and any quarantine worker beyond the first (`balancer-quarantine-2`…). Only the first quarantine pool, `balancer-quarantine-1`, is allowed on top of it. The app can set it. It is the balancer's own allowance, in the balancer's options. The kernel's budget doesn't change and stays the page-wide warning.
- **Why only its own workers** (amended 2026-11-16, replacing "counts every live worker on the page"): plant's interactive page already runs about 13 workers (the bus, 8 data pools, fleet, the drawer and the manual pools). Counted against `cores − 2`, that left the balancer at its cap from the start on almost any machine, so a steady heavy widget was never separated. An allowance of its own keeps it useful on a busy page; the app decides how much of the machine it gets.
- **Load only.** Topic affinity isn't an input while delivery is per member. It's in would-like for when one delivery per pool worker exists.

### 5. The quarantine

One shared pool, `balancer-quarantine-1`, outside normal placement. Suspects can slow each other there, but never a healthy pool. If it goes over budget with more than one member, its heaviest member gets a quarantine worker of its own (`balancer-quarantine-2`…), if the cap allows: quarantine workers beyond the first count against `maxWorkers`, so the number of quarantine workers stays bounded.

- **Leaving, for offenders** (amended 2026-11-16): after its quiet window with no spike and no crash, whatever its load, the member goes where the placement rule finds room (the 60 % rule, or a new pool within `maxWorkers`). With no room anywhere it stays in the quarantine, flagged `atCap`, until there is. The earlier 20 % load bar is dropped: a heavy but well-behaved member is the full-pool trigger's business, not the quarantine's. A member that is there just to be measured leaves once measured (decision 4).
- **Repeat offenders:** "three offences" means three returns, with steady windows of 30, 60 and 120 s. The fourth offence keeps the member in the quarantine as `kept-apart`.
- **No other packing back.** Quiet members are not moved together to save workers (would-like).

### 6. Moves and hysteresis

- **A move is `stop`, then `spawn`,** with the same id and the new `pool`. State comes back from the log within the topics' retention, and a visual isolate gets a fresh surface. The gap is visible, and M3h measures it. There's no new kernel primitive; a make-before-break `move()` is in would-like.
- **Cooldown:** after a move, both pools get 30 s, with at most one move per pool per cooldown. A pool needs fresh over-budget evidence, gathered after its cooldown, before it moves anything again.
- **Holds:** a held member is never moved; the balancer waits for its release (decision 1).

## Consequences

- **Good:** an app can let Isoloop separate a widget that blocks or stays heavy without the developer predicting it. Apps that don't opt in see no change in behaviour, and pay only for `busyMs`'s timing.
- **Good:** `busyMs` is useful on its own: devtools can show which member of a pool is heavy.
- **Bad:** a move restarts the isolate. A visual one goes blank until it redraws, and anything beyond its topics' retention is lost.
- **Bad:** the signals are noisy. `lagMs` is timer drift, `busyMs` sums coarse clock reads, and defaults tuned on one machine may flap on another. The cooldowns, the doubling window and `kept-apart` bound how often the balancer acts.
- **Bad:** bisecting a blocker that gets its pool killed costs about log₂(n) pool restarts.
- **Bad:** some work is no member's time (GC, promise continuations, other libraries' own schedulers), and shared tasks are split equally, so a member can look lighter or heavier than it is. The 50 % rule and the check after a move bound the cost of a wrong guess.
- **Bad:** every worker runs with wrapped timers, rAF, `queueMicrotask`, `requestIdleCallback` and member-created ports, and with a React DevTools hook. Behaviour is the same as native, as the conformance test checks, but stack traces gain a frame and the timing cost is always paid unless the measurement makes it an option.
- **Protocol:** `IdleReport.busyMs` is a new optional field, so older runtimes stay within `[FLOOR, VERSION]` ([ADR 0012](0012-isolates-built-apart.md)). The balancer treats a missing `busyMs` as unmeasured.

## Alternatives considered

- **Placement policy in the kernel** (a manifest option such as `pool: 'auto'`): every app would pay for it, and the kernel would gain behaviour ADR 0001 rejected. Not taken.
- **`<Profiler>` `onRender` for React render time:** not called in production builds. Replaced by the DevTools hook.
- **Trial moves only (no attribution):** move a member, check whether the pool's `lagMs` fell, try the next if not. It needs no timing, but it costs a restart per wrong guess. Kept only as the fallback and the safety check.
- **Reading Preact's internals:** they're mangled and change between versions. Only the public `options` hooks are used.
- **Several balancers per kernel:** they would contend for the same CPU, the same cap and the same quarantine slot, each blind to the others' moves. Rejected. Keeping groups of isolates apart is better served by placement groups inside one balancer (would-like).
- **A balancer isolate with a spawn and stop grant:** fits M4's "devtools as an isolate" direction, but a grant to spawn and stop needs a security design of its own. Not taken for now.
- **A device-based budget in the kernel:** still rejected (ADR 0001). The balancer's cap is its own option.
- **A cap over every page worker** (the first decision): it left nothing on a page that already runs many workers. Replaced by an allowance for the balancer's own pools.
- **A load bar for leaving the quarantine** (20 %, the first decision): it kept steady heavy members in the quarantine for good. Dropped; the full-pool trigger handles heavy members wherever they are.
- **The host keeping the worst `lagMs` since the last read, for polling:** stateful per reader, and it still loses `busyMs` intervals. Replaced by the event.
- **Placement by topic affinity:** saves nothing while delivery is per member. Deferred.
- **One worker per suspect in the quarantine:** stronger isolation between suspects, at more workers. Not taken: the quarantine protects the healthy pools, and its heaviest member already gets a worker of its own when it's over budget.
- **Quarantining every member of a killed pool:** converges at once, but punishes healthy widgets with a move each. Not taken in favour of bisecting.
