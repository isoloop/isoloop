# M3h: Auto placement

**Status:** planned (grilled 2026-11-16; [ADR 0017](../adr/0017-opt-in-balancer.md) accepted the same day). The library half (`busyMs`, the reserved pool prefix, `@isoloop/balancer`) is built in `isoloop/isoloop` and can start alongside M3e. The interactive-page half is built in `isoloop/web` after M3e's drawer. A new example, `apps/processor` (decisions 24–30, added 2026-11-16), is the balancer's main demo and its measurement. It ships as `next` prereleases, then the next free `plant-v*` and `markets-v*` minors and `processor-v0.1.0`, tagged by the user.

**Goal:** a widget spec can say `placement: { "mode": "auto" }`, and Isoloop decides whether the isolate joins a pool or gets a worker apart, from its measured load. A widget that blocks is moved out of a shared pool before it can keep slowing its neighbours.

**Why:** M3e places every widget by hand. The person adding a widget can't know how heavy it will be. Picking the wrong pool for a heavy widget brings back the problem Isoloop exists to solve: one isolate slowing the isolates beside it. M3h measures each member and acts on what it measures.

**Done when:**
- An `@experimental` `@isoloop/balancer` package, under [ADR 0017](../adr/0017-opt-in-balancer.md), places `auto` widgets on the plant and markets interactive pages.
- Unit tests on a simulated kernel show these cases separating the culprit and keeping light widgets together:
  - a widget that spikes;
  - a widget that stays heavy;
  - a widget that crashes;
  - a widget that blocks until its pool is killed.
- E2E tests show the same on plant with `?chaos`, and on the processor's Playground.
- A measurement of the processor's File processor on the bench server compares it with `one` and `own`, and is reported whatever it shows.

**Depends on:**
- [M3e](m3e-live-widget-creator.md): the interactive pages get `auto`. Integration needs its task 5 (drawer and manual placement).
- [M2c](m2c-worker-pools.md) and [M2d](m2d-visual-pools.md): pools, headless and visual.

**Comes before:** [M4](m4-devtools-release.md). `busyMs` changes the public API and the protocol, which is better done before 0.1, and M4's devtools reuse it.

## Decisions (grilling, 2026-11-16)

### Scope and shape

1. **A general library feature, demoed on the interactive pages.** Any isolate spawned through `balancer.spawn` with no `pool` is placed by the balancer. Isolates spawned with `kernel.spawn`, including every isolate a manifest declares, are never touched. They only count as workers toward the cap (decision 7).
2. **A host-side library, on the main thread.** `@isoloop/balancer` is a separate package built on the kernel API (`stop`, `isolates()`, `pools()`, `on`), spawning into its pools through the `@internal` `claimPools` (decision 3), so an app that doesn't use it doesn't pay for it.
   - It needs no new grant: spawning and stopping stay host powers.
   - It is `@experimental` until the measurement and real use say otherwise.
   - A headless isolate with a spawn grant was considered and not taken, because a grant to spawn and stop is a security decision of its own.
3. **The API:**
   ```ts
   const balancer = createBalancer(kernel, { maxWorkers?, spike?, sustained?, headroom?, quarantine?, loads? });
   balancer.spawn(manifest)      // like kernel.spawn, but it picks `pool`; manifest.pool must be absent
   balancer.stop(id)
   balancer.hold(id)             // → release(); a held isolate is never moved
   balancer.measure(id)          // → loadPct, averaged over the last 3 s
   balancer.placements()         // [{ id, pool, state: 'placed' | 'quarantined' | 'kept-apart' | 'moving', loadPct, atCap }]
   balancer.on('move', e => …)   // { id, from, to, reason: 'spike' | 'sustained' | 'full' | 'crash' | 'bisect' | 'steady' }
   balancer.dispose()
   ```
   - Every option defaults to the numbers in decisions 8–14.
   - `loads` is a small `{ get(id), set(id, pct) }` store supplied by the app (decision 12), so the balancer holds no topic of its own.
   - **One balancer per kernel, with a reserved prefix.** The host reserves every pool name starting with `balancer-`.
     - A plain `kernel.spawn` with such a pool throws `reserved_pool`, as the bus rejects `isoloop.*` topics with `reserved_topic`.
     - The balancer gets the names through a new `@internal` host export, `claimPools(kernel, 'balancer') → { spawn }`. It works once per kernel; a second claim throws `balancer_exists`.
     - Pools are named `balancer-1`, `balancer-2`…, and the quarantine pools `balancer-quarantine-1`, `balancer-quarantine-2`…
     - The interactive pages show them as "Auto 1", "Auto 2" and "Quarantine".
     - Several balancers per kernel were rejected: they would contend for the same CPU, cap and quarantine slot. Keeping groups apart is better served by placement groups inside one balancer ([would-like](../would-like.md)).
   - **`hold(id)`** returns a release function, and a held isolate is never moved. The M3e drawer holds a widget while it's open (decision 5). If the member a trigger would move is on hold, the balancer waits for the release instead of moving another member in its place, then applies the usual rules.
   - **`measure(id)`** gives the isolate's load averaged over the last 3 s. The creator stores it with `loads.set` on Save (decision 12).
   - **`atCap`** is true on a placement whose pool is over budget with nowhere to move to (decision 11).
4. **Auto pools and manual pools stay apart.** An `auto` widget only joins pools the balancer created, and the balancer never moves a `manual` widget or adds to a manual pool. A manual pin keeps meaning exactly what it says.
5. **What it never touches:**
   - manual widgets;
   - the drawer isolate;
   - previews and drafts, whose `busyMs` it only reads (decision 12);
   - the dashboard's own isolates;
   - a widget open in the drawer, until Save or Cancel (`hold`).
6. **Amends ADR 0001 and 0015, in ADR 0017.** "The runtime never pools isolates on its own" stays true. The kernel has no placement policy. An app may opt in to the balancer, which places through the same `spawn`/`stop`/`pool` a developer uses by hand, in the `balancer-` pool names the host reserves for it. ADR 0001's rejected alternative, "pool for light isolates chosen by heuristics", stays rejected as a runtime default.

### Workers

7. **The balancer's own allowance** (amended 2026-11-16). `maxWorkers` defaults to `max(2, navigator.hardwareConcurrency − 2)` and counts only the balancer's own workers: its `balancer-N` pools, and any quarantine worker beyond the first (`balancer-quarantine-2`…). Only the first quarantine pool, `balancer-quarantine-1`, is allowed on top. The app can set it; plant's interactive page passes a small number.
   - The first decision counted every live worker on the page. Plant's interactive page already runs about 13 workers (the bus, 8 data pools, fleet, the drawer and the manual pools), which left the balancer at its cap from the start on almost any machine, so a steady heavy widget was never separated.
   - The kernel's soft budget (32, [ADR 0001](../adr/0001-one-worker-per-isolate.md)) is unchanged and still only warns; ADR 0001's rejection of a budget based on the device's core count is about the kernel, and stays.

### What it measures

8. **`busyMs`, a new public signal for each member,** summed per heartbeat interval. It goes into `IdleReport.busyMs`: a pool reports it per member in `members[id]`, and an own worker reports it in `idle`. `IsolateSnapshot` gains `busyMs`. How work is attributed was settled with the user on 2026-11-16 ([ADR 0017](../adr/0017-opt-in-balancer.md), decision 2). Attribution per member is required, and a trial move is only a fallback.
   - **Wrapping, in every worker, own workers included.** Before any member loads, at the point where pools freeze the built-ins, the runtime wraps:
     - `setTimeout` and `setInterval`
     - `requestAnimationFrame`
     - `queueMicrotask`
     - `requestIdleCallback`, where present
     - `onmessage` and `addEventListener('message')` on `MessageChannel` ports that members create

     Each callback is billed to the member that was running when it was registered, so nested chains stay attributed. The runtime's own dispatches (bus deliveries, host events, DOM flushes, `start()`) are timed as well. Behaviour stays identical to the native functions: the same ids, `clearTimeout` unchanged, `this` and arguments passed through, errors rethrown, the native `name` and `length`. A conformance test checks this. Promise continuations are not wrapped.
   - **React:** production builds don't run `<Profiler>`'s `onRender`. Instead the runtime installs a minimal `__REACT_DEVTOOLS_GLOBAL_HOOK__` before members load. Each scheduler task is timed, and its time is split among the roots that committed in it (`onCommitFiberRoot`), each mapped to its member. A test confirms that production React calls the hook. Assumed, unverified: the browser's React DevTools extension doesn't inject into workers, so there's no conflict. M4's devtools may reuse the hook.
   - **Preact:** public `options` hooks only. `debounceRendering` times the batch, `diffed` finds the roots, and the same split rule applies. No mangled internals are read.
   - **Shared-task time is split equally** among the members it served.
   - **Guards:**
     - If a pool's `lagMs` is over budget but its members' `busyMs` sum to under 50 % of the interval, the balancer bisects (decision 15) instead of picking by `busyMs`.
     - After any move, it checks that the pool's `lagMs` fell, and moves the next member if not.
   - **Always on, with no switch.** If the on/off overhead figure (decision 23) shows a cost beyond the spread, the timing becomes a kernel option, off by default and turned on by `createBalancer`.
   - **Known limits:** promise continuations, other libraries' own schedulers and the equal split are approximations. GC and anything else not traced shows up only in the worker's `lagMs`. `busyMs` is a placement guide, not a profiler.
   - The pages aren't cross-origin isolated, so `performance.now()` resolves to 100 µs. A single short callback reads as 0 or one tick, but over a heartbeat window the sum averages out to the true total. A runtime test checks the sums with a coarse clock.
   - The cost is two clock reads per attributed callback, a few thousand a second on plant at 5 kHz. The heartbeat already runs every 100 ms, so there are no new messages, only one more number per member.
9. **The load figure.** A member's load is `busyMs` ÷ the interval, as a percentage. A pool's load is the sum over its members. The balancer listens to a new public kernel event, `isolate:beat` `{ id, pool?, lagMs, busyMs, at }`, emitted for each member on every heartbeat and only while someone listens. Every beat goes into a 3 s ring per pool and member, and it decides every 500 ms (amended 2026-11-16).
   - The first build polled `kernel.isolates()` every 100 ms. A snapshot holds only each worker's latest beat, replaced by the next one about 100 ms later, so the beat that carried a spike was usually gone before it was read, and `busyMs` intervals were skipped or read twice. Found by the plant integration: the runtime reported a blocker correctly, but the balancer often missed it.

   Fixed constants, not options:
   - decisions every 500 ms;
   - loads written back through `loads.set` every 10 s, only on a change of 5 points or more;
   - a bisect forgotten 60 s after its last trigger.

### When it acts

10. **The triggers:**
    - **Spike:** a single `lagMs` over 100 ms, i.e. a long task. The member with the highest `busyMs` in that interval goes to the quarantine at once.
    - **Sustained:** `lagMs` over 50 ms across the 3 s window. The heaviest member moves to a normal balancer pool with room (decision 11).
    - **Full** (added 2026-11-16, Q15): the members' `busyMs` add up to 80 % of a core or more over the 3 s window, whatever the lag. The heaviest auto member moves to a pool that passes decision 11, or a new pool within `maxWorkers`; failing both, it's flagged `atCap`. Its move event carries the reason `full` (Q19); a pool that is full and also lagging reports `sustained`, so `full` marks the low-lag case. Cooldowns and the check after a move apply as for the other triggers. 60 % (stop adding) against 80 % (start moving) is the hysteresis. Found on the playground: heavy tasks that yield often keep the lag at 0–30 ms, so neither the spike nor the sustained trigger fired, and a pool at 88 % starved its members.
    - **Crash:** when a pool restarts after a member's error, that member goes to the quarantine.
    - **Alone in its pool:** a widget that spikes while alone in its pool isn't moved unless it has offended before, since moving it spares no one. Nothing joins that pool for 30 s.
11. **Place by predicted load.** A widget joins or moves into a pool only if *the pool's load + the widget's load* stays under 60 %.
    - If no balancer pool passes, the widget gets a new balancer pool if the cap allows.
    - Otherwise it stays where it is, and its placement reports `atCap` ("over budget, at worker cap").
    - A move never lands in a pool that would then be over budget.
12. **New widgets arrive already measured.** M3e's preview runs the real widget on its own worker while it's being edited. On Save the creator calls `measure` on the preview, stores the figure with `loads.set`, and the balancer places the widget from it.
    - Measured loads are kept through the `loads` store. On the interactive pages that store is a persistent, compacted `creator.placement.v1` topic keyed by widget id, so a reload or a seeded starter is placed from history.
    - A widget with no history (a first boot, or a widget never previewed) starts in the quarantine only to be measured. It leaves as soon as it has 3 s of samples there, with no steady window. Members a bisect moved there stay until that bisect ends (culprit found, or forgotten), so the bisect can still converge.
13. **The quarantine is one shared pool,** `balancer-quarantine-1`, outside normal placement. Suspects can slow each other there, but never a healthy pool. If the quarantine itself goes over budget with more than one member, its heaviest member gets a quarantine worker of its own (`balancer-quarantine-2`…), if the cap allows: quarantine workers beyond the first count against `maxWorkers`, so the number of quarantine workers stays bounded.
14. **Leaving the quarantine, and repeat offenders.**
    - **Quiet is enough** (amended 2026-11-16, Q18): an offender leaves after its quiet window (no spike, no crash), whatever its load. It goes where decision 11 finds room; with none, it stays in the quarantine, flagged `atCap`, until there is. The earlier 20 % load bar is dropped. A widget there just to be measured leaves once measured (decision 12).
    - "Three offences" means three returns, with steady windows of 30, 60 and 120 s.
    - The fourth offence keeps it in the quarantine as `kept-apart`, and the widget shows "kept apart: repeated blocking".
    - Apart from this way out of the quarantine, nothing is packed back into pools to save workers ([would-like](../would-like.md)).
15. **A block that gets the pool killed.** A member that blocks until the supervisor kills the pool (plant kills after 2 s) never sends the beat that would name it. The balancer **bisects**: the pool restarts with half its auto members moved to the quarantine, and whichever half blocks again holds the culprit. That takes about log₂(n) restarts. Healthy widgets are never all sent to the quarantine together. A bisect is forgotten 60 s after its last trigger. A blocker found by bisecting gets a quarantine worker of its own if the cap allows. A killed manual pool restarts as it does today.
16. **Topic affinity is dropped.** The outline's "decide from topic subscriptions" saves nothing today: the bus delivers each record once per member, on that member's own port, not once per pool worker ([ADR 0016](../adr/0016-fewer-messages-per-record.md), deferred option). Load is the only input. Affinity is in [would-like](../would-like.md), for when one delivery per pool worker exists.

### Moves

17. **A move is stop, then spawn,** with the same id and a different `pool`.
    - Ids are unique, so the new copy can't start before the old one stops, and there is no move primitive in the kernel.
    - The widget rebuilds from `earliest` within its topic's history (2 min on plant), and gets a fresh `<canvas>` with its new surface.
    - The widget frame shows a "Moving…" overlay through the gap, and the gap is measured as time to first draw after a move.
    - A make-before-break `kernel.move()` is in [would-like](../would-like.md), in case the gap turns out to be bad.
18. **Hysteresis:**
    - After a move, both pools get a 30 s cooldown, with at most one move per pool per cooldown.
    - A pool needs fresh over-budget evidence, gathered after its cooldown, before it moves anything again.
    - A held member is never moved; the balancer waits for its release (decision 3).
    - The quarantine's rules (decision 14) handle repeat offenders.

### Interactive pages

19. **The spec gains `auto`.** `placement` becomes `{ "mode": "manual", "pool": "pool-1" }` or `{ "mode": "auto" }`, with no format change beyond the new mode: `isoloop-spec@1` keeps its version.
20. **The placement field** gains "Automatic" and preselects it for new widgets.
    - While a widget is on auto, the field shows where it is now ("Automatic · in Auto 2").
    - After a move, the widget header shows a badge for a few seconds, for example "moved: Auto 1 was over budget".
    - Every move goes into a placement log, a collapsible panel in the board's toolbar (the interactive page has no About panel).
    - On Native the field stays disabled with "Not used".
21. **`?chaos` and the `burn` operator.** A test-only spec operator makes a widget misbehave on command:
    - `{ "op": "burn", "everyMs": 10000, "forMs": 500 }` blocks for `forMs` every `everyMs`;
    - `{ "op": "burn", "loadPct": 40 }` keeps a steady load.

    `validateSpec` rejects `burn` unless the page runs with `?chaos`, so real specs can't contain it, and the drawer only offers it then. Unit tests use a simulated kernel with scripted beats, and E2E and the measurement use `?chaos`.
22. **Plant first, then markets, both E2E only.** Plant's starter widgets keep their manual `pool-1` and `pool-2`, so M3e's measured setup doesn't change; only widgets added from now on default to Automatic. The measurement moves to the processor (decision 23).

### Measured

23. **Measured on the processor's File processor** (moved from plant, 2026-11-16), against two naive placements of the same processors: `one` (all in one pool) and `own` (a worker each). No native build: the question is placement.
    - **Method:** on the bench server, with `packages/compare`, on Chromium and Firefox, 5 rounds.
    - **Figures:**
      - jobs per second
      - p50 and p95 latency per job
      - the UI's input latency on the main thread
      - workers used, and the number of moves
      - jobs lost (expected 0) or duplicated
      - the balancer's own cost, measured with it on and off (main-thread ms/s, worker CPU)

    Reported as measured, whatever it shows.

### The processor example (added 2026-11-16)

24. **Why a new example.** Plant's widgets are mostly light and its page already runs about 13 workers, so it leaves little to show. Headless processors do heavy, varied CPU work, a move costs them no surface, and the bus's consumer groups (`subscribe({ group })`, offsets kept per group) hand a stopped member's unfinished jobs to the group again, so the example shows containment, the bus, restart and placement together.
25. **One app, two pages.** `apps/processor` in `isoloop/web`, deployed at `/processor/`, with a React UI on the main thread and every task or processor a headless isolate. The **Playground** comes first; the **File processor** follows.
26. **The Playground's controls.**
    - **Add task** spawns a headless task isolate through the balancer, up to 24.
    - Each task has a **CPU slider from 0 to 100 %**, burning that share of its time in slices of the page's **Work chunk** setting, and **Block 2 s**, **Crash** and **Remove** buttons. A slider's value is the task's starting load (Q16).
    - Page-wide: a placement switch (**balancer / own / one**) that respawns every task, an **Add 5 light tasks** preset, and the `maxWorkers` value shown.
27. **What the Playground shows.** One column per pool (`balancer-1…N`, then the quarantine), each with its live `lagMs` and lines at the 50 ms and 100 ms thresholds. Each task card shows its measured `busyMs` as a bar beside the slider's setting. A moved card slides to its new column with the reason. Below: a move log, and the workers in use out of the cap.
28. **A moved task keeps its setting.** Slider values are published to a compacted `playground.tasks` topic keyed by task id; each task subscribes to its own key, so after a move it comes back with the same load.
29. **The File processor.** A generator, seeded so runs repeat, emits synthetic "files" at a rate set by a dial. Each kind does real CPU work scaled by its size: **CSV** (parse and aggregate), **Image** (a resize-like pass over pixels), **Archive** (compress) and **Hash** (SHA-256 in JS). Each kind has its own job topic and a consumer group of headless processors; results go to `files.results`. The UI shows queue length, jobs per second, latency per job, each pool's load and where every processor sits, with each move. Three dials, each from zero up: **poison** files block for 2 s (spikes and quarantine), **heavy** files cost 10× (sustained load), **corrupt** files throw (crash). No real file uploads; those stay with the Builder.
30. **Tests and release.** The Playground has E2E tests only, run in real time with no test-only speed-up in the balancer: a slider raised to 90 % is separated within about 5 s; Block puts the task in the quarantine at once and it returns after 30 s steady; Crash quarantines it; `own` and `one` never move anything. The File processor is measured (decision 23). The app ships as `processor-v0.1.0`, tagged by the user.

## Tasks

| # | Task | Repo | Review |
| --- | --- | --- | --- |
| 1 | This plan, the roadmap row and the would-like entries | isoloop | User |
| 2 | ADR 0017: the opt-in balancer, `busyMs`, the reserved prefix, the triggers, quarantine and bisect, the cap, the API; amendments to ADR 0001 and ADR 0015 (decisions 1–18). Amended 2026-11-16: `isolate:beat` and the balancer's own allowance | isoloop | User (accepted 2026-11-16; the amendment goes to the user) |
| 3 | `busyMs`: in `@isoloop/runtime`, the wrapped timers, rAF, `queueMicrotask`, `requestIdleCallback` and member ports in every worker, with a conformance test against native behaviour; the minimal React DevTools hook (with a test that production React calls it) and the Preact `options` hooks, through the adapters; the equal split; `IdleReport.busyMs` in `@isoloop/protocol` and `IsolateSnapshot.busyMs` in `@isoloop/host`; a coarse-clock test; pool and own-worker tests; a `next` prerelease (decision 8) | isoloop | Done (#198) |
| 4 | The reserved pool prefix in `@isoloop/host`: `reserved_pool` for `balancer-` pools on `kernel.spawn`, the `@internal` `claimPools(kernel, 'balancer') → { spawn }` (once per kernel, else `balancer_exists`), tests; a `next` prerelease (decision 3) | isoloop | Done (#197) |
| 5 | `@isoloop/balancer`: the API (`hold`, `measure`, `atCap` included), the load rings and fixed constants, the three triggers and the lone-member rule, predicted-load placement, the quarantine and its windows, bisect (including when `busyMs` can't explain the lag), the check after a move, the cap, hysteresis; unit tests on a simulated kernel with scripted beats for spike, sustained, crash, kill and hold (decisions 3, 7, 9–18) | isoloop | Self-merge on green (#196) |
| 6 | `isolate:beat` in `@isoloop/host`: a public `KernelEvents` entry `{ id, pool?, lagMs, busyMs, at }`, emitted per member on every heartbeat only while someone listens, with tests (decision 9) | isoloop | Self-merge on green |
| 7 | The balancer listens to `isolate:beat` instead of polling, and `maxWorkers` counts only its own pools, with the quarantine on top; tests updated (decisions 7, 9) | isoloop | Self-merge on green, after tasks 5 and 6 |
| 8 | The creator on plant: `auto` in the spec, the placement field, the badge, the "Moving…" overlay, the toolbar placement log, `hold` while the drawer is open, `measure` + `loads.set` on Save, the `creator.placement.v1` loads store, `?chaos` and `burn`; plant E2E (decisions 5, 12, 19–22) | web | Self-merge on green (web#127), after the prerelease with tasks 5–7 |
| 9 | Markets: `auto` on its interactive page, E2E (decision 22) | web | Self-merge on green, after task 8 |
| 10 | The processor's Playground: the app, tasks, sliders, Block/Crash/Remove, the placement switch, pool columns, move log, `playground.tasks`; E2E (decisions 25–28, 30) | web | Self-merge on green, after the prerelease with tasks 5–7. Built locally first so the user can look at it |
| 11 | The processor's File processor: the seeded generator, the four kinds, job topics and consumer groups, `files.results`, the poison/heavy/corrupt dials, the UI; E2E (decision 29) | web | Self-merge on green, after task 10 |
| 12 | The measured scenarios in `packages/compare` for the File processor, then the bench-server run (decision 23) | web | Self-merge on green, after task 11 |
| 13 | The processor's write-up of the measurement, in the results page layout used by M3d–M3g (findings first, then the tables, then details), and `example.json` | web | User |
| 14 | Roadmap: M3h done; the next free `plant-v*` and `markets-v*` minors, and `processor-v0.1.0` | isoloop, web | User pushes the tags |

Tasks 3 and 4 are merged. Task 5 merges on green; tasks 6 and 7 follow it. The web tasks need a `next` prerelease with tasks 5–7, run by the user. Tasks 8–9 and 10–11 can run in parallel; task 12 needs task 11.

## Risks

- **The move gap.** A move restarts the widget. A visual widget goes blank until it redraws, and state rebuilt from the log is limited by its topic's retention. Decision 17 measures the gap rather than hiding it.
- **Noisy signals.** `lagMs` is timer drift, `busyMs` sums coarse clock reads, and a policy tuned on one machine may flap on another. The cooldowns, the doubling steady window and the "kept apart" state bound how often it can act. The measurement covers two browsers, but only one machine.
- **What `busyMs` can't see.** GC, promise continuations and other libraries' own schedulers are no member's time, and shared tasks are split equally, so a member can look lighter or heavier than it is. The 50 % rule and the check after a move bound the cost of a wrong guess.
- **Wrapping the worker's scheduling.** Every worker runs with wrapped timers, rAF, `queueMicrotask`, `requestIdleCallback` and member ports, plus a React DevTools hook. The conformance test holds behaviour to native, but a library that inspects these functions closely could still notice.
- **Bisect costs restarts.** A widget that blocks until its pool is killed costs about log₂(n) pool restarts before it's found, each a gap for the widgets in that pool.

## Follow-ups

- Topic affinity, a make-before-break `move()` and packing quiet widgets back into pools are in [would-like](../would-like.md).
- [M4](m4-devtools-release.md)'s devtools panel shows `busyMs` per member and the balancer's placements, fed by `isolate:beat`.
