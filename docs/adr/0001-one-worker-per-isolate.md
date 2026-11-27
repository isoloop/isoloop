# ADR 0001: Own worker by default, named pools later

- **Status:** Accepted. Amended on 2026-11-20 for a warm-up window after `ready` (*Start-up warm-up*, below), from the plant dashboard's restart loop on Firefox; grilled the same day (Q1–Q4, yes to all). Corrected on 2026-11-22: the warm-up was not built and isn't in effect, and the cause it names for that loop was wrong. The question is reopened in [#389](https://github.com/isoloop/isoloop/issues/389). Amended on 2026-11-24 for crash loops slower than the restart window (*Restart limit: short runs*, below; [#390](https://github.com/isoloop/isoloop/issues/390)). Amended on 2026-11-26 for an explicit healthy run, `supervisor.healthyAfterMs`, apart from the window (*Restart limit: `healthyAfterMs`*, below; [#409](https://github.com/isoloop/isoloop/issues/409)). Amended on 2026-11-26 for CPU starvation: the kill and ready timers run on a clock that leaves out the host's own lateness, capped at 3 × their limit in wall-clock time (*Heartbeat clock: the host's lag*, below; [#389](https://github.com/isoloop/isoloop/issues/389)). It replaces *Start-up warm-up*.
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

### Start-up warm-up (amended 2026-11-20; not built, reopened 2026-11-22; replaced 2026-11-26)

**Replaced** by *Heartbeat clock: the host's lag*, below ([#389](https://github.com/isoloop/isoloop/issues/389)). Nothing from #384 is reused. The rest of this section is kept as history.

**Not in effect.** `killAfterMs` applies from `ready` on. [#384](https://github.com/isoloop/isoloop/pull/384) built the warm-up and was closed unmerged on 2026-11-22:

- **The cause below was wrong.** Plant's loop on Firefox CI came from the tests: eight Playwright locators waiting at once starved the page of its workers' messages, so the supervisor killed healthy workers. [web#275](https://github.com/isoloop/web/pull/275) fixed the tests. With the warm-up and without that fix, plant's Firefox suite passed 1 of 5 CI runs, against 2 of 5 on `0.1.0-next.11`.
- **A smaller, real problem is left.** A CPU-starved Firefox kills workers that are waiting for a CPU. The warm-up reduced those kills and didn't end them, since they also come after start-up ([#389](https://github.com/isoloop/isoloop/issues/389) has the measurements).
- **The warm-up weakened the restart limit.** With `readyTimeoutMs` at about 19 s or more and the default window, an isolate that hung right after each `ready` never reached `failed` ([#390](https://github.com/isoloop/isoloop/issues/390)).
- **What #384 had added to the text below:** the window followed the latest `ready` in a pool (the open question's recommendation), and ended early once beats had been on time for 1 s, because a fixed 10 s window stopped the Block demos restarting. Neither is in effect.

#389 decides what replaces it. The amendment as accepted on 2026-11-20 follows, kept as history.

For `heartbeat.readyTimeoutMs` after an isolate's `ready` (10 s by default), a blocked isolate is killed only once it has gone `readyTimeoutMs` without a beat, not `killAfterMs`. After that window `killAfterMs` applies as before. There's no new option: an app that lowers `killAfterMs` so a short block restarts an isolate keeps that behaviour once the isolate has warmed up. `blockedAfterMs` is unchanged, so the busy overlay and the `blocked` state still show during the window; only the kill waits.

- **Why:** an isolate sends `ready` before its `start()` runs (`startIsolate` in `packages/runtime/src/bootstrap.ts`), so mounting, subscribing and the first replay all happen after the supervisor has moved it to `running`, where the kill check applies (the `blocked` branch of `tick` in `packages/host/src/supervisor/machine.ts`). Nothing protected that start-up work. The plant dashboard sets `killAfterMs` to 2 s so its 3 s stress block restarts a pool (M3d decision 9; `apps/dashboards/plant/src/isoloop/kernel.ts` in isoloop/web). On the 4-vCPU GitHub runner in Firefox, its `widgets` pool (72 members under the default `matched` placement) went more than 2 s without a beat while mounting and replaying, so it was killed at 6–7 s. Each restart mounted and replayed again and was killed again about 3.5 s later. In the last 200 CI runs, that broke 7 of the 69 plant Firefox PR jobs, 4 of them on both attempts. Each failing attempt logged 144–216 crash events; every passing attempt logged none. A slow real device can enter the same loop.
- **Applies to** own workers and pools alike. The window is the supervisor's, judged per isolate like every other heartbeat rule.
- **Open question for this review:** heartbeats are per worker, but the window above starts at each member's own `ready`. In a pool, members start one after another in the same event loop, so a member whose window has closed can be killed while a later member's `start()` holds the loop, and the pool's shared fate then restarts everyone. The same happens when one member restarts alone (its own fatal error) inside a running pool. Recommendation: a pool member's window lasts until `readyTimeoutMs` after the latest `ready` on its worker, so the whole pool stays in warm-up while any member is starting. The alternative is to keep the window per member and accept that a pool can still loop if its members start more than `readyTimeoutMs` apart.

### Restart limit: short runs (amended 2026-11-24)

Decided for the 0.1.1 patch ([plan](../plans/0.1.1-patch.md), decision 5; [#390](https://github.com/isoloop/isoloop/issues/390)); grilled on 2026-11-24 (yes to all).

**The problem.** The limit counted restarts in a sliding window: `maxRestarts` in `withinMs`. Each crash uses up part of that window: the run before it, the time it takes to detect it (`killAfterMs`, `readyTimeoutMs`) and the backoff after it. When `maxRestarts + 1` crashes don't fit in `withinMs`, the isolate restarts without end and its fallback never shows. #390 measured it: on the defaults, an isolate that hangs 10 s after each start, or one with `killAfterMs: 30000`, didn't reach `failed` in 150 s, and neither did the supervision guide's own example.

**The rule.**

1. **Each crash records its healthy run:** from the isolate's `ready` to its last heartbeat before the crash. The run doesn't include the time it took to detect the crash. A worker that never sent `ready` had a run of 0.
2. **A crash after a run shorter than `withinMs` counts** (`healthyAfterMs` from 2026-11-26, below). A crash after a run of `withinMs` or longer clears the count first, so it's the first of a new one: an isolate that runs an hour and then crashes 4 times quickly fails on the 4th, as it did before.
3. **The isolate fails when the count passes `maxRestarts`,** that is, on the crash after `maxRestarts` short runs in a row, however long they took.
4. **The sliding window stays as well.** `maxRestarts` restarts in `withinMs` still fail the isolate, so a fast loop fails as soon as it did before. An isolate fails on whichever rule is met first.
5. **The backoff grows with the larger of the two counts.** *Retry* clears both.
6. **The bus worker uses the same rule,** with the bus's `ready` and its last beat ([ADR 0007](0007-bus-worker-supervision.md), *Amended: the restart limit is a default*).
7. **A pool is judged as it is today.** Each member keeps its own count and window. A crash the pool shares counts once for each member, judged by that member's own healthy run, so a member that had run `withinMs` or longer has its count cleared. Heartbeats are the worker's, so every member's run ends at the pool's last beat.
8. **The types don't change.** No option is added or removed, and `withinMs` keeps its name and default; its TSDoc, the supervision guide and the host README say it's both the window and the healthy run that clears the count. `isolate:failed`'s `message` names the rule that was met, for example "3 restarts in 60000 ms" or "4 crashes, each after less than 60000 ms of healthy running". An explicit `healthyAfterMs`, the run that clears the count, is for 0.2 ([#409](https://github.com/isoloop/isoloop/issues/409)); it's decided in *Restart limit: `healthyAfterMs`*, below, which replaces this rule's point 8.

**Each row of #390's table** gets a unit test on the machine with a synthetic clock, and the rows measured in a browser get a browser test that reaches `failed`. On the defaults, an isolate that hangs 10 s after each start fails on its 4th crash, about 4 × (10 s + `killAfterMs` 10 s) plus backoff after it started.

**Interaction with #389.** A Firefox worker starved by the page ([#389](https://github.com/isoloop/isoloop/issues/389)) looks like a hang. Under the window alone, pages in #389's runs recovered only because their crashes didn't fit in the window. Under this rule they count. Before this code merges, #389's starvation setup runs on it at the defaults and at `killAfterMs: 2000` (the plan's T7). If pages reach `failed` at the defaults, the rule waits for 0.2 and this amendment is marked not in effect.

### Restart limit: `healthyAfterMs` (amended 2026-11-26)

Decided for 0.2 ([#409](https://github.com/isoloop/isoloop/issues/409)); grilled on 2026-11-26 (Q3, Q11–Q13, yes to all).

**The problem.** Under *Restart limit: short runs*, `withinMs` means two things: the sliding window that counts restarts, and the healthy run that clears the count of short runs. An app can't widen one without the other. A longer window to catch slow loops also asks every isolate to run longer before a crash stops counting, and a shorter healthy run also narrows the window.

**The rule.** It's *Restart limit: short runs* with one change: its healthy run gets its own option.

1. **`supervisor.healthyAfterMs`** is the healthy run, from `ready` to the last heartbeat, that clears the count of short runs. A crash after a run shorter than `healthyAfterMs` counts; a crash after a run of `healthyAfterMs` or longer clears the count first, so it's the first of a new one. Points 1 and 3–7 of the short-run rule stand as written.
2. **`withinMs` is the sliding window only:** `maxRestarts` restarts in `withinMs` fail the isolate, as before.
3. **Default 60 000 ms,** `withinMs`'s default, so an app that sets neither behaves as it does on 0.1.1. An app that sets only `withinMs` gets a healthy run of 60 000 ms, not its `withinMs`: the two are independent. That changes its restart limit, so the change ships as `breaking:` with a codemod step that sets `healthyAfterMs` to the same expression beside `withinMs`, which keeps such apps on their 0.1 behaviour (decided 2026-11-26, Q31).
4. **A positive integer, with no upper cap.** Any other value (0, negative, not an integer, not a number) makes `createKernel` throw `invalid_config`, as other malformed options do. It may be larger or smaller than `withinMs`.
5. **The bus worker follows it too.** It's supervised with the kernel's `supervisor` config ([ADR 0007](0007-bus-worker-supervision.md)), so `healthyAfterMs` applies to it with no separate option.
6. **New public API on `@isoloop/host`, in a minor.** It's an added optional field; the one behaviour change is point 3's, which the codemod covers. `isolate:failed`'s `message` names the number that was met: "4 crashes, each after less than 60000 ms of healthy running" now quotes `healthyAfterMs`.

**Tests.** The #390 slow-crash-loop cases pass on the default unchanged, and again with a `healthyAfterMs` shorter and longer than `withinMs`, each reaching `failed` (or not) by the count it sets. `invalid_config` gets a case per malformed value.

**Interaction with #389.** None in the rule. A starved worker's crash still counts as a short run; telling starved from hung is #389's own decision.

### Heartbeat clock: the host's lag (amended 2026-11-26)

Decided for 0.2 ([#389](https://github.com/isoloop/isoloop/issues/389)); grilled on 2026-11-26 from a measurement spike (Q7, Q19, Q32–Q36, yes to all). It replaces *Start-up warm-up*, above.

**The problem.** The supervisor measures a worker's silence in wall-clock time. On a CPU-starved page, a worker that is only waiting for a CPU looks the same as a hung one, so it's killed. Firefox shows this and Chromium, under the same starvation, mostly doesn't. Kills cluster on Firefox at a lowered `killAfterMs` (2 s): every starved page in the runs below lost a pool, and most ended with members `failed`. At the default 10 s, pages mostly recover, but with hundreds of needless restarts.

**What the spike found.** The host's own main thread, where beats are heard, is starved as well. On a starved page, its 50 ms tick fired late for 83 to 120 s of each 150 s run, with single ticks up to 3.7 s late. The beats were sent but couldn't be heard. Two detectors were measured on the same setup (prototype and simulation on the branch `spike/389-starvation`, [`1d068eb`](https://github.com/isoloop/isoloop/tree/1d068eb)):

- **(a) Judging a silent worker against its siblings** (hold kills while most workers are silent) removed 0 to 9 % of the false kills. It also delayed the kill of a hang that hits half the workers or more by its cap. Dropped.
- **(b) A clock that leaves out the host's lateness** removed every false kill at the defaults and 92 % at 2 s. Chosen.

**The rule.**

1. **The lag clock.** The kernel adds up how late its own supervision tick fires: every tick, the time past the 50 ms interval. The **lag clock** is `performance.now()` minus that sum. Silence measured on it counts only time in which the host could have heard a beat.
2. **Only two timers use it:** the heartbeat kill (`killAfterMs`, reason `unresponsive`) and the ready timeout (`readyTimeoutMs`, reason `ready_timeout`). Everything else stays on wall-clock time:
   - `blockedAfterMs`, so the busy overlay and the `blocked` state show as they do today;
   - the restart window (`withinMs`);
   - the healthy run (`healthyAfterMs`);
   - the backoff.
3. **A wall-clock cap of 3 × the limit.** A worker silent for `3 × killAfterMs` of wall-clock time is killed whatever the lag clock says, so a hung worker on a starved page is still killed, at most 3 times later than on a page that isn't starved. The ready timeout gets the same cap on its own limit, `3 × readyTimeoutMs` (30 s by default; decided in this review, 2026-11-26, rather than `3 × killAfterMs` for both, which at plant's 2 s would time out a slow start sooner than today). The factor is fixed, not an option. The build measures it against the spike's figures and comes back here if 3 doesn't hold.
4. **On a page that isn't starved, nothing changes.** The host's tick was late by about 0.3 s per 150 s there, so a hung worker is killed at `killAfterMs` as before (spike: 1996 ms at 2000, 10009 ms at 10000, Firefox).
5. **The bus worker uses it too.** Its kill and ready timers use the same lag clock and cap. The rest of its supervision is unchanged ([ADR 0007](0007-bus-worker-supervision.md)).
6. **No new public API.** No option, no event and no type changes. It's a behaviour change: fewer `unresponsive` and `ready_timeout` crashes on a starved page, and a later kill of a hung worker only while the host itself is late.

**The measured trade.** These are local numbers from the spike, on 2026-11-26: a desktop-class 16-core x64 CPU, Linux under WSL2, every process pinned to one core with `taskset`, 8 pages of plant at once, isoloop/web `5363429`, Playwright 1.65.0. Other work was running on the same machine, so the starvation was heavier than #389's and T7's runs, and the figures don't compare one to one with theirs. The figures for the supervision guide are taken on bench machine 1 after the build.

| Firefox 159, 24 pages | `killAfterMs` | 0.1.0 | Lag clock, no cap |
|---|--:|--:|--:|
| `unresponsive` crashes | 10000 | 504 | 0 |
| `ready_timeout` crashes | 10000 | 576 | 0 |
| Pages with a failed member | 10000 | 0 | 0 |
| `unresponsive` crashes | 2000 | 7646 | 576 |
| Pages with a failed member | 2000 | 22 | 0 |

- **A truly hung worker on a starved page** (a 600 s busy loop in plant's `widgets` pool): on wall-clock time it was killed after a median of 12.6 s at the defaults (worst 23.0 s) and 2.3 s at 2 s. On the lag clock without a cap, it took 26.5 s (worst 37.8 s) and 6.1 s. On Chromium 158 it took 14.1 s against 10.0 s. Every hung worker was killed. The cap bounds the worst case at 30 s and 6 s.
- **Chromium 158** had no false kill on either clock at the defaults.

**What still holds.**

- **The restart limit** (*Restart limit: short runs* and *Restart limit: `healthyAfterMs`*, above) is unchanged and stays on wall-clock time. The #390 slow crash loop reaches `failed` at the same crash and the same time with the lag clock (spike simulation: 81.9 s at the defaults, 49.9 s at 2 s).
- **`healthyAfterMs`** ([#409](https://github.com/isoloop/isoloop/issues/409), #466) keeps measuring the healthy run in wall-clock time, from `ready` to the last beat.
- **#384's regression doesn't come back.** There is no warm-up, so raising `readyTimeoutMs` doesn't change when a worker is killed after `ready`. That becomes a host test.
- **Hidden tabs** (*What the browser still controls*, below) are unchanged: nothing is judged while `document.hidden` is true, and every clock restarts on the way back.

**Tests in the build.**

- Starvation across the whole page (late ticks with beats held back) causes no kill.
- A single hung worker on a page that isn't starved is killed within `killAfterMs`.
- A hung worker on a starved page is killed by the cap at `3 × killAfterMs`, and a worker that never sends `ready` by `3 × readyTimeoutMs`.
- The #390 slow crash loop still fails.
- A raised `readyTimeoutMs` doesn't slow kills after `ready`.
- The bus worker's kill uses the lag clock and the cap.
- **Measurement:** the starvation matrix is re-run locally at the defaults and at 2 s, against 0.1.0, before the build merges. Bench machine 1 figures follow for the supervision guide.

**Not decided here.**

- **A CPU-time beat** (option (c) in the spike). Not built: a worker that doesn't run can't send it.
- **Real low-end devices,** which weren't measured.

### What the browser still controls

Isoloop's guarantees stop where the browser's tab policy starts. Background tabs throttle main-thread timers (to about once a second, or once a minute after a few minutes in Chrome); Memory Saver and mobile browsers may freeze a tab, pausing its workers; a tab may be discarded, losing memory topics (persistent topics survive). So:

- While `document.hidden` is true the supervisor doesn't judge hangs: no busy overlay, no kills. Worker errors are still handled. On `visibilitychange` to visible and on the Page Lifecycle `resume` event, every heartbeat clock (isolates and bus) restarts from zero, so returning to a tab never kills an isolate for beats missed while hidden or frozen. A worker stuck in a loop in a hidden tab is detected after the user returns, within the normal limits.
- On `freeze` and `pagehide` the kernel asks the bus to flush persistent topics immediately (M2b).
- Work that must continue with no tab open needs a Service Worker or a server; that is out of scope.

Rules: `dur.flush-on-freeze`, `dur.survives-reload`

## Consequences

- For the default placement, isolation guarantees are simple to state and to test.
- Memory grows linearly with isolates. Mitigations: lazy start, opt-in suspension (`suspend`), a shared runtime bundle cached per origin, and (after M2c) pools.
- Many small headless isolates are the most likely pressure towards pooling; the worker-count warning makes that pressure visible early.
- Pools save a heap and a runtime copy per member, start members faster (no new worker), and use fewer threads. In exchange, pool members share an event loop (one can block the others), share fate (a crash or a hang restarts the whole pool, since a worker can only be terminated as a whole), and share `globalThis` and built-in prototypes (browsers offer no per-module realm in a worker yet). That is why pooling is opt-in and meant for trusted isolates. Because members can reach each other's bus ports, a pool effectively holds the union of its members' grants; devtools shows that union.
- Supervision gains a group case in M2c: heartbeats are per worker, and a pool restart replays every member.
- **Not in effect** (the warm-up wasn't built, corrected 2026-11-22): an isolate that really is stuck in a loop just after `ready` (or after a restart) is killed after `readyTimeoutMs` rather than `killAfterMs`. With the defaults (10 s each) nothing changes; with plant's 2 s threshold, a kill in the first 10 s after `ready` waits 10 s. A block in that window, such as plant's stress block right after load, shows the busy overlay but doesn't restart the isolate until the window closes (amended 2026-11-20).

## Alternatives considered

- **Own worker only, pools never:** simplest, but leaves no answer for apps with many small headless isolates (ADR 0008) beyond merging them by hand.
- **Pools built in v1:** doubles the supervision cases while the bus and durable log are still being built. Reserving the field gives the same API stability for less work.
- **Pool for "light" isolates chosen by heuristics:** surprising behaviour; rejected as a runtime default. An app can opt in to a library that places by measurement ([ADR 0017](0017-opt-in-balancer.md)).
- **Automatic suspension when all subscriptions are durable:** saves memory without developer effort, but restarts become hard to predict and isolates with in-memory state would lose it silently. Rejected for v1.
- **A snapshot API for suspended state:** a second source of state next to the log; rejected in favour of publishing to a compacted topic on shutdown.
- **Waking every suspended isolate on any record:** wakes hidden visual isolates for records nobody can see; rejected, since they can catch up from the log when shown.
- **A device-derived budget (e.g. cores × 4):** browser-reported figures are coarse or hidden, and the warning would differ per machine; rejected for a fixed default.
- **Suspending isolates as soon as the budget is passed:** turns a warning into behaviour; rejected. Memory is freed only after a real `spawn-failed`.
- **Raising plant's `killAfterMs` to 2.5–3 s** instead of a library rule (2026-11-20): keeps the stress block restarting a pool, but leaves little margin on the runner, and every app with a short threshold would meet the same loop on a slow device. (Corrected 2026-11-22: that loop's cause was the tests; see *Start-up warm-up*.)
- **A longer threshold only in E2E builds** (2026-11-20): makes CI pass while hiding what a slow device hits; rejected.
- **Hard worker limit:** fails apps on capable machines and still doesn't protect weak ones, since the real limit depends on the device. Rejected in favour of a warning.
