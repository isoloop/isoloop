# ADR 0001: Own worker by default, named pools later

- **Status:** Accepted
- **Date:** 2026-11-03
- **Answers:** RFC 0001 open question "Workers per isolate, or a pool?"
- **Related:** [ADR 0005](0005-bus-topology-message-channels.md) (per-isolate channels), [ADR 0007](0007-bus-worker-supervision.md) (durable topics), [ADR 0008](0008-isolates-and-surfaces.md) (headless isolates)

## Context

Thread isolation is Isoloop's main promise: a blocked or crashed isolate affects only itself. A pool that hosts several isolates in one worker saves memory (one framework copy, one heap) but shares an event loop again, so one isolate can block its neighbours. That is exactly the failure Isoloop exists to prevent.

Memory per isolate is a real cost (RFC risk: "one heap and framework copy per isolate"). Each worker carries a few MB of baseline heap plus its own copy of the runtime and framework. A dashboard with 10–20 visual isolates was the original target, and that stays well within what browsers handle. ADR 0008 raises the count: headless isolates (state managers, sync engines, small topic transformers) encourage more, smaller isolates, each paying for a whole worker.

## Decision

Isoloop supports two placements, chosen by the host in the isolate's manifest. Isolate code is identical in both, so moving an isolate between them is a config change.

- **Own worker (default):** one dedicated module worker per isolate, with the full isolation guarantee.
- **Named pool (opt-in):** `manifest.pool: 'light'` places the isolate in a shared worker with every other isolate naming the same pool. The developer names pools; the runtime never pools isolates on its own. Pool members share fate and globals (see Consequences), so pools are for small, trusted isolates.

Placement belongs to the host manifest alone. An isolate module cannot ask for a pool or refuse one; its author can only document a recommendation.

Staging:

- **v1 (M1):** only the own-worker placement runs. `manifest.pool` is part of the types and is validated, but `spawn` rejects it with `pools_unsupported`, so the API shape is fixed and adding pools later breaks nothing.
- **After M2:** pools are built ([M2c plan](../plans/m2c-worker-pools.md)), headless isolates only at first: the `isoloop-dom` subset ([ADR 0010](0010-own-render-bridge.md)) installs one global `document` per worker, so visual isolates with `pool` stay rejected until a surface can be scoped per isolate. M2c opens with a benchmark gate: if pooling 20 small headless isolates saves less than about 30 % memory and doesn't start them faster, pools are dropped and this ADR records the result.

Nothing in the public API exposes worker identity:

- `Supervisor`, `Compositor` and the bus key everything by `isolateId`, never by worker.
- Bus traffic already travels over one `MessageChannel` per isolate (ADR 0005), so the port identifies the isolate. A pooled worker holds one port per isolate it hosts; only the isolate port between host and worker needs to carry an isolate id.

Supporting rules:

### Suspension (opt-in)

`manifest.suspend: 'never' | 'when-idle' | { whenIdle: { afterMs } }`, default `'never'`; `'when-idle'` waits 60 s. `'never'` means always on: Isoloop never suspends the isolate, in a hidden tab or anywhere else.

- **Idle** means all of: no visible surface (an off-screen or `display: none` surface, or a hidden tab, counts as not visible; headless isolates count as never visible), nothing delivered for `afterMs`, no open `ctx.keepAwake()` hold, and no host call or acknowledged-pending publish in flight. `keepAwake()` returns a release function; holds have no time limit, devtools lists them with age and creation site, and dev builds warn once a hold passes 10 minutes.
- **Suspend:** `shutdown` with the usual grace (the isolate can commit offsets and publish anything it wants kept to a compacted topic), `detach { keepOffsets: true }`, terminate. There is no snapshot API: suspension means rebuilding from the log. A suspended member of a consumer group leaves the group, so the group rebalances.
- **Wake:** a visual isolate wakes when its surface becomes visible; a headless isolate wakes when a record arrives on a subscribed topic, or a request when it is the last member of its group; either wakes on `kernel.resume(id)`. Wakes go through a queue that starts at most 4 workers at a time (configurable), visible surfaces first in on-screen order, headless after. Until an isolate renders, its surface shows the frozen snapshot of its last frame.
- **Replay:** the isolate resubscribes from its committed offsets and replays what it missed, for memory and persistent topics alike. Losses are signalled, never silent: retention (`last-n` or `time`) dropping unread records arrives as `deliver.gap`, and a bus crash wiping a memory topic arrives as `reset` (ADR 0007). Registration warns when a suspendable isolate subscribes to a `last-n` or `time` topic.
- **Pools** suspend only as a whole, when every member is suspendable and idle; otherwise the pool never suspends and registration warns that the setting has no effect. Any member's wake condition wakes the pool.
- Built in M2 ([task 12b](../plans/m2-bus.md#12b-opt-in-suspension)).

### Worker budget and spawn failures

- The `Supervisor` counts live workers (a pool counts as one) and emits a devtools warning when the count passes a configurable soft budget, fixed at 32 by default; devtools shows the device's reported cores and memory next to it. The budget never changes behaviour: it doesn't refuse spawns or trigger suspension. The real ceiling depends on the device, so it is a hint, not a guarantee.
- If the browser fails to create a worker, that isolate crashes with reason `spawn-failed`: normal backoff and restart limit, ending in `failed` with the fallback UI, while the rest of the app keeps running. Before each retry the supervisor suspends every idle suspendable isolate to free memory.

### What the browser still controls

Isoloop's guarantees stop where the browser's tab policy starts. Background tabs throttle main-thread timers (to about once a second, or once a minute after a few minutes in Chrome); Memory Saver and mobile browsers may freeze a tab, pausing its workers; a tab may be discarded, losing memory topics (persistent topics survive). So:

- While `document.hidden` is true the supervisor doesn't judge hangs: no busy overlay, no kills. Worker errors are still handled. On `visibilitychange` to visible and on the Page Lifecycle `resume` event, every heartbeat clock (isolates and bus) restarts from zero, so returning to a tab never kills an isolate for beats missed while hidden or frozen. A worker stuck in a loop in a hidden tab is detected after the user returns, within the normal limits.
- On `freeze` and `pagehide` the kernel asks the bus to flush persistent topics immediately (M2b).
- Work that must continue with no tab open needs a Service Worker or a server; that is out of scope.

## Consequences

- For the default placement, isolation guarantees are simple to state and to test.
- Memory grows linearly with isolates. Mitigations: lazy start, opt-in suspension (`suspend`), a shared runtime bundle cached per origin, and (after M2c) pools.
- Many small headless isolates are the most likely pressure towards pooling; the worker-count warning makes that pressure visible early.
- Pools save a heap and a runtime copy per member, start members faster (no new worker), and use fewer threads. In exchange, pool members share an event loop (one can block the others), share fate (a crash or a hang restarts the whole pool, since a worker can only be terminated as a whole), and share `globalThis` and built-in prototypes (browsers offer no per-module realm in a worker yet). That is why pooling is opt-in and meant for trusted isolates. Because members can reach each other's bus ports, a pool effectively holds the union of its members' grants; devtools shows that union.
- Supervision gains a group case in M2c: heartbeats are per worker, and a pool restart replays every member.

## Alternatives considered

- **Own worker only, pools never:** simplest, but leaves no answer for apps with many small headless isolates (ADR 0008) beyond merging them by hand.
- **Pools built in v1:** doubles the supervision cases while the bus and durable log are still being built. Reserving the field gives the same API stability for less work.
- **Pool for "light" isolates chosen by heuristics:** surprising behaviour; rejected.
- **Automatic suspension when all subscriptions are durable:** saves memory without developer effort, but restarts become hard to predict and isolates with in-memory state would lose it silently. Rejected for v1.
- **A snapshot API for suspended state:** a second source of state next to the log; rejected in favour of publishing to a compacted topic on shutdown.
- **Waking every suspended isolate on any record:** wakes hidden visual isolates for records nobody can see; rejected, since they can catch up from the log when shown.
- **A device-derived budget (e.g. cores × 4):** browser-reported figures are coarse or hidden, and the warning would differ per machine; rejected for a fixed default.
- **Suspending isolates as soon as the budget is passed:** turns a warning into behaviour; rejected. Memory is freed only after a real `spawn-failed`.
- **Hard worker limit:** fails apps on capable machines and still doesn't protect weak ones, since the real limit depends on the device. Rejected in favour of a warning.
