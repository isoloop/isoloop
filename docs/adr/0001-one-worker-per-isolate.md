# ADR 0001: Own worker by default, named pools later

- **Status:** Accepted. Amended on 2026-11-20 for a warm-up window after `ready` (*Start-up warm-up*, below), from the plant dashboard's restart loop on Firefox; grilled the same day (Q1–Q4, yes to all). Its code follows this amendment's acceptance.
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
- **Gate result (2026-11-08):** passed. 20 small headless isolates in one worker against 20 own workers, 7 runs each, medians: 86% less memory on Chromium (8.9 against 64.3 MB), 71% on Firefox (21.4 against 75.0 MB), 81% on WebKit (12.1 against 63.7 MB), and 2–3 times faster start-up (23 against 57 ms, 46 against 93 ms, 21 against 63 ms). Method and limits: [bench/pools](../../bench/pools/README.md). Pools went ahead for headless isolates; a visual isolate with `pool` is rejected with `pools_headless_only`, which replaces `pools_unsupported`.
- **M2c as built:** a pool's members crash and restart together when one stops responding or the worker errors; a member's own fatal error stays its own. A pool suspends only as a whole. The pool worker freezes the built-ins (with inherited data properties turned into accessors so instances can still override them, narrowed below) before its first member loads. [Guide](../guide/pools.md).
- **Override taming without the protected properties (2026-11-12, accepted 2026-11-12; built in #173):** the pool worker still freezes every built-in prototype, and an instance can still override any inherited property, except the ones V8 guards with "protectors". Those stay plain frozen data:
  - the iteration protocol: `Symbol.iterator` on `Array.prototype`, `%TypedArray%.prototype`, `Map.prototype`, `Set.prototype` and `%IteratorPrototype%`, and `next` on the array, map, set and string iterator prototypes
  - `constructor` on `Array.prototype`, `%TypedArray%.prototype` and each typed array prototype (species lookups)
  - `then` and `constructor` on `Promise.prototype`
  - all of `RegExp.prototype` and all of `String.prototype`

  - **Why:** M2c turned every inherited data property into an accessor, so that `this.name = 'MyError'` and similar overrides keep working on frozen prototypes, as Hardened JS does. An accessor that returns the same function is enough to switch a protector off for the whole worker, and with it V8's fast path for `for…of`, spread and destructuring, species lookups, regexps and promise resolution ([plant-one-pool.md](../investigations/plant-one-pool.md)).
  - **Measured:** in a worker benchmark ([bench/freeze](../../bench/freeze)), the previous freeze made array `map` and `slice` 23× slower than a plain worker, destructuring 3.6×, regexps 3.2×, string `for…of` 1.4× and awaiting resolved promises 1.2×. With the protected properties left as data, every workload is within 2% of a plain worker. On the benchmark server (4 physical cores fixed at 2.0 GHz, Chromium), the plant's own feed and engine code for eight machines, driven flat out in one worker, ran 2.37× slower than a plain worker at 5 kHz with the previous freeze and 2.51× at 1 kHz. With the narrowed freeze it ran 1.00× at both rates. In the plant dashboard (4 interleaved rounds per configuration, medians), the pool workers' CPU fell from 760 to 702 ms/s in `one` and from 782 to 756 ms/s in `matched` at 5 kHz, with no overlap between rounds, and the renderer total in `one` fell from 1,132 to 1,070 ms/s. The main thread was unchanged, since it isn't frozen. Head to head, interleaved, nothing else got worse:
    - **Late frames:** stayed at 0 in Chromium and within one frame in Firefox.
    - **Typing:** within ±6 ms over 10 rounds in Chromium. A keystroke lands one or two frames later, about 20 or 40 ms, so 4-round medians move by a frame either way.
    - **Unchanged:** first data, recovery after a block and the data gap.
    - **CPU across threads:** 0–5 points lower.
  - **What it costs:** in strict code, overriding a protected property on an instance throws `TypeError` instead of defining an own property. For example `arr[Symbol.iterator] = f`, `promise.then = f` or `new String('x').toString = f`. Patching a built-in prototype still fails, which is what the freeze is for.
  - **Alternative not taken:** SES's default ("moderate") override list, as an allow-list. It breaks Preact in a pool, because Preact's `assign()` and `Object.assign({}, { constructor: x })` copy a record's own `constructor` key onto a plain object by assignment. An allow-list turns every such copy into a `TypeError`. Leaving out only the protected properties keeps every other override working.
- **Visual pools (2026-11-09):** [ADR 0015](0015-visual-pools.md) lets visual isolates join a pool, alone or with headless members: one `isoloop-dom` document per worker and one render root per member. Built in [M2d](../plans/m2d-visual-pools.md), behind its own gate.
- **An opt-in balancer (accepted 2026-11-16, [ADR 0017](0017-opt-in-balancer.md)):** the runtime still never pools isolates on its own, and the kernel has no placement policy. An app may opt in to `@isoloop/balancer`, a separate library that picks `pool` for the isolates spawned through it, from each member's measured `busyMs`, using the same `spawn`, `stop` and `pool` a developer uses by hand, in the `balancer-` pool names the host reserves for it (`reserved_pool`; one balancer per kernel). Placement stays the host's choice: opting in is that choice. The balancer's worker cap is its own option, so the kernel's budget below is unchanged.

Nothing in the public API exposes worker identity:

- `Supervisor`, `Compositor` and the bus key everything by `isolateId`, never by worker.
- Bus traffic already travels over one `MessageChannel` per isolate (ADR 0005), so the port identifies the isolate. A pooled worker holds one port per isolate it hosts; only the isolate port between host and worker needs to carry an isolate id.

Supporting rules:

### Suspension (opt-in)

`manifest.suspend: 'never' | 'when-idle' | { whenIdle: { afterMs } }`, default `'never'`; `'when-idle'` waits 60 s. `'never'` means always on: Isoloop never suspends the isolate, in a hidden tab or anywhere else.

- **Idle** means all of: no visible surface (an off-screen or `display: none` surface, or a hidden tab, counts as not visible; headless isolates count as never visible), nothing delivered for `afterMs`, no open `ctx.keepAwake()` hold, and no host call or acknowledged-pending publish in flight. `keepAwake()` returns a release function; holds have no time limit, devtools lists them with age and creation site, and with `KernelConfig.dev` set the kernel warns once a hold passes 10 minutes.
- **Suspend:** `shutdown` with the usual grace (the isolate can commit offsets and publish anything it wants kept to a compacted topic), `detach { keepOffsets: true }`, terminate. There is no snapshot API: suspension means rebuilding from the log. A suspended member of a consumer group leaves the group, so the group rebalances.
- **Wake:** a visual isolate wakes when its surface becomes visible; a headless isolate wakes when a record arrives on a subscribed topic, or a request when it is the last member of its group; either wakes on `kernel.resume(id)`. A bus restart (ADR 0007) also wakes every suspended headless isolate: the new bus has no record of the subscriptions they were waiting on, so they resubscribe, replay, and suspend again once idle. Suspended visual isolates aren't woken by it; they catch up when shown. Wakes go through a queue that starts at most 4 workers at a time (configurable), visible surfaces first in on-screen order, headless after. Until an isolate renders, its surface shows the frozen snapshot of its last frame.
- **Replay:** the isolate resubscribes from its committed offsets and replays what it missed (a subscription that asked for `from: 'latest'` resumes from `committed` after a wake, so nothing published while it slept is skipped; `earliest` stays `earliest`), for memory and persistent topics alike. Losses are signalled, never silent: retention (`last-n` or `time`) dropping unread records arrives as `deliver.gap`, and a bus crash wiping a memory topic arrives as `reset` (ADR 0007). The kernel warns when a suspendable isolate subscribes to a `last-n` or `time` topic; the warning comes from the bus metrics, so it arrives within about a second of the subscribe.
- **Pools** suspend only as a whole, when every member is suspendable and idle; otherwise the pool never suspends and registration warns that the setting has no effect. Any member's wake condition wakes the pool.
- Built in M2 ([task 12b](../plans/m2-bus.md#12b-opt-in-suspension)).

### Worker budget and spawn failures

- The `Supervisor` counts live workers (a pool counts as one) and emits a devtools warning when the count passes a configurable soft budget, fixed at 32 by default; devtools shows the device's reported cores and memory next to it. The budget never changes behaviour: it doesn't refuse spawns or trigger suspension. The real ceiling depends on the device, so it is a hint, not a guarantee.
- If the browser fails to create a worker, that isolate crashes with reason `spawn-failed`: normal backoff and restart limit, ending in `failed` with the fallback UI, while the rest of the app keeps running. Before each retry the supervisor suspends every idle suspendable isolate to free memory.

### Start-up warm-up (amended 2026-11-20)

For `heartbeat.readyTimeoutMs` after an isolate's `ready` (10 s by default), a blocked isolate is killed only once it has gone `readyTimeoutMs` without a beat, not `killAfterMs`. After that window `killAfterMs` applies as before. There's no new option: an app that lowers `killAfterMs` so a short block restarts an isolate keeps that behaviour once the isolate has warmed up. `blockedAfterMs` is unchanged, so the busy overlay and the `blocked` state still show during the window; only the kill waits.

- **Why:** an isolate sends `ready` before its `start()` runs (`startIsolate` in `packages/runtime/src/bootstrap.ts`), so mounting, subscribing and the first replay all happen after the supervisor has moved it to `running`, where the kill check applies (the `blocked` branch of `tick` in `packages/host/src/supervisor/machine.ts`). Nothing protected that start-up work. The plant dashboard sets `killAfterMs` to 2 s so its 3 s stress block restarts a pool (M3d decision 9; `apps/dashboards/plant/src/isoloop/kernel.ts` in isoloop/web). On the 4-vCPU GitHub runner in Firefox, its `widgets` pool (72 members under the default `matched` placement) went more than 2 s without a beat while mounting and replaying, so it was killed at 6–7 s. Each restart mounted and replayed again and was killed again about 3.5 s later. In the last 200 CI runs, that broke 7 of the 69 plant Firefox PR jobs, 4 of them on both attempts. Each failing attempt logged 144–216 crash events; every passing attempt logged none. A slow real device can enter the same loop.
- **Applies to** own workers and pools alike. The window is the supervisor's, judged per isolate like every other heartbeat rule.
- **Open question for this review:** heartbeats are per worker, but the window above starts at each member's own `ready`. In a pool, members start one after another in the same event loop, so a member whose window has closed can be killed while a later member's `start()` holds the loop, and the pool's shared fate then restarts everyone. The same happens when one member restarts alone (its own fatal error) inside a running pool. Recommendation: a pool member's window lasts until `readyTimeoutMs` after the latest `ready` on its worker, so the whole pool stays in warm-up while any member is starting. The alternative is to keep the window per member and accept that a pool can still loop if its members start more than `readyTimeoutMs` apart.

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
- An isolate that really is stuck in a loop just after `ready` (or after a restart) is killed after `readyTimeoutMs` rather than `killAfterMs`. With the defaults (10 s each) nothing changes; with plant's 2 s threshold, a kill in the first 10 s after `ready` waits 10 s. A block in that window, such as plant's stress block right after load, shows the busy overlay but doesn't restart the isolate until the window closes (amended 2026-11-20).

## Alternatives considered

- **Own worker only, pools never:** simplest, but leaves no answer for apps with many small headless isolates (ADR 0008) beyond merging them by hand.
- **Pools built in v1:** doubles the supervision cases while the bus and durable log are still being built. Reserving the field gives the same API stability for less work.
- **Pool for "light" isolates chosen by heuristics:** surprising behaviour; rejected as a runtime default. An app can opt in to a library that places by measurement ([ADR 0017](0017-opt-in-balancer.md)).
- **Automatic suspension when all subscriptions are durable:** saves memory without developer effort, but restarts become hard to predict and isolates with in-memory state would lose it silently. Rejected for v1.
- **A snapshot API for suspended state:** a second source of state next to the log; rejected in favour of publishing to a compacted topic on shutdown.
- **Waking every suspended isolate on any record:** wakes hidden visual isolates for records nobody can see; rejected, since they can catch up from the log when shown.
- **A device-derived budget (e.g. cores × 4):** browser-reported figures are coarse or hidden, and the warning would differ per machine; rejected for a fixed default.
- **Suspending isolates as soon as the budget is passed:** turns a warning into behaviour; rejected. Memory is freed only after a real `spawn-failed`.
- **Raising plant's `killAfterMs` to 2.5–3 s** instead of a library rule (2026-11-20): keeps the stress block restarting a pool, but leaves little margin on the runner, and every app with a short threshold would meet the same loop on a slow device.
- **A longer threshold only in E2E builds** (2026-11-20): makes CI pass while hiding what a slow device hits; rejected.
- **Hard worker limit:** fails apps on capable machines and still doesn't protect weak ones, since the real limit depends on the device. Rejected in favour of a warning.
