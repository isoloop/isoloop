# Supervision and restarts

The kernel watches every isolate's heartbeat, restarts one that blocks or crashes, gives up after too many restarts, and tells the page what happened through events and a fallback.

## When to use it

Supervision is on for every isolate, with defaults, and you don't call anything to get it. Read this page to tune the limits, to react to a crash or a failure in the page, or to change what a failed widget shows.

- **To keep a crash from taking neighbours down,** you already have it: each isolate has its own worker unless it names a [pool](pools.md).
- **To watch or trigger crashes from a tool,** use the [inspection feed](inspection.md) and its `restart`, `kill` and `block` controls.
- **To place isolates by measured load,** use the [balancer](balancer.md), which reads the same events.

## What the supervisor watches

Each isolate is in one state, shown by `kernel.isolates()` (`state`, `lagMs`, `restarts`, and `reason` and `error` after a crash) and by the `isolate:state` event.

| State | Meaning |
| --- | --- |
| `loading` | The worker is starting and hasn't said `ready` yet. |
| `running` | It's beating on time. |
| `blocked` | No beat for `heartbeat.blockedAfterMs`. A visual isolate shows a "Not responding…" overlay. |
| `crashed` | A crash was judged. The state is passed through: it moves on to `restarting` or `failed` at once. |
| `restarting` | Waiting out the backoff, then a new worker starts. |
| `failed` | The supervisor gave up. A visual isolate shows its fallback. |
| `suspended` | Idle by its own choice and shut down, until something wakes it ([below](#suspension-and-resume)). |
| `stopped` | Stopped with `kernel.stop(id)`. |

The runtime in each worker sends a **heartbeat** every `heartbeat.everyMs` (100 ms) with `lagMs`: how late the beat itself ran. The kernel checks every 50 ms. An isolate that runs a long synchronous task can't beat, so:

- **After `blockedAfterMs` (400 ms) without a beat,** the isolate is `blocked`. A beat that arrives brings it back to `running`.
- **After `killAfterMs` (10 000 ms) without a beat,** the kernel terminates the worker and counts a crash with reason `unresponsive`.

`lagMs` comes with a beat, so a block shows in it only once the block ends and the late beat arrives; while the block lasts, `lagMs` keeps the last beat's value, often 0. To see a block in progress, read `state` and the time since `lastBeatAt` (`sinceBeatMs` in the dev MCP's `isoloop_isolates`).

A crash also comes from the other causes in `CrashReason`:

| Reason | Cause | Restarted? |
| --- | --- | --- |
| `error` | A fatal error from the isolate: `start()` threw, the module failed to import, or `ctx.reportError(e)` (fatal unless you pass `{ fatal: false }`). | Yes |
| `worker_error` | The worker's own `error` or `messageerror` event. | Yes |
| `ready_timeout` | No `ready` within `heartbeat.readyTimeoutMs` (10 000 ms) of the spawn. | Yes |
| `unresponsive` | No beat for `killAfterMs`. | Yes |
| `spawn_failed` | `new Worker` threw. Before each retry the kernel suspends every idle isolate that opted in, to free memory. | Yes |
| `render_format_mismatch` | The isolate speaks a render format the host doesn't. | No |
| `runtime_too_old`, `isolate_too_old` | The isolate's required runtime version is outside what this host supports. | No |
| `bus_failed` | The contracts module couldn't load, so no isolate can run. | No |

A restart can't fix the last four, so they fail the isolate on the first crash.

**Non-fatal errors only get reported.** An exception caught in a bus handler, or `ctx.reportError(e, { fatal: false })`, emits `isolate:error` and changes no state.

**A hidden tab isn't judged.** While `document.hidden` is true, nothing becomes `blocked` or is killed, and the ready timeout waits. Worker errors are still handled. When the tab is visible again, or the page resumes after being frozen, every heartbeat clock starts from zero, so coming back never kills an isolate for beats missed while away.

## What it does about them

On a crash the kernel terminates the worker, emits `isolate:crash`, and:

1. **Counts it** two ways: against the restarts in the last `withinMs`, and, if the isolate's healthy run before it was shorter than `withinMs`, against the crashes in a row after short runs. A healthy run lasts from the isolate's `ready` to its last heartbeat, so the time it took to notice the crash isn't part of it. A worker that never sent `ready` had none. A run of `withinMs` or longer clears the second count, and the crash after it is the first of a new one.
2. **Restarts after a backoff** while both counts are within `maxRestarts`. The delay is `initialMs × factor^n`, capped at `maxMs`, where `n` is the larger of the two counts before this crash. With the defaults it's 250 ms, 500 ms, then 1 s.
3. **Gives up as `failed`** when either count is past `maxRestarts`, when `strategy` is `never`, or when the reason is one that isn't restarted. It emits `isolate:failed` and shows the fallback. The message ends with the limit that was met: `(3 restarts in 60000 ms)` or `(4 crashes, each after less than 60000 ms of healthy running)`.

With the defaults, a fourth crash fails the isolate unless it ran for 60 s or more before one of them. That holds however long each crash takes to detect: an isolate that runs 10 s after each start and then hangs is killed 10 s later each time (`killAfterMs`), and fails on its fourth crash, about 80 s after it first started. An isolate that runs for a minute or more between crashes keeps being restarted. A **manual restart** (`kernel.restart(id)`, the fallback's Retry) clears both counts; the `restarts` count in the snapshot keeps counting crash restarts since the spawn.

Other isolates are untouched. A restart starts a new worker, so the isolate's in-memory state is gone: what it rebuilds from is the bus ([below](#catching-up-after-a-restart)).

### In a pool

The heartbeat belongs to the worker, so a pool's members block and are killed together ([pools guide](pools.md#what-members-share)).

- **The worker fails:** when a member crashes with `unresponsive` or `worker_error`, every other member on that worker crashes with the same reason. The worker is terminated, and every member restarts in a new one. Each member's `isolate:crash` carries the `pool`. The message names no member, because the worker can't tell which one caused it. A [kill](inspection.md#controls) is the exception: the others' message names the member that was killed.
- **A member's own failure:** a fatal error, a ready timeout or a version mismatch crashes only that member. It restarts alone and rejoins the running worker.
- **Limits are per isolate.** Each member counts the shared crash itself, judged by its own healthy run. Heartbeats are the worker's, so every member's run ends at the worker's last beat, and a pool that keeps failing usually reaches `failed` for all its members together.

[restart-own-worker](../diagrams/restart-own-worker.html) and [restart-pool](../diagrams/restart-pool.html) show both sequences end to end.

## Configuring it

```ts
import { createKernel } from '@isoloop/host';

const app = createKernel({
  contracts,
  workers,
  supervisor: {
    strategy: 'one-for-one',
    maxRestarts: 5,
    withinMs: 120_000,
    backoff: { initialMs: 500, factor: 2, maxMs: 8000 },
  },
  heartbeat: { blockedAfterMs: 400, killAfterMs: 5000 },
});
```

Every field is optional. `backoff` takes any of its three fields; the rest keep their defaults.

| Option | Default | Meaning |
| --- | --- | --- |
| `supervisor.strategy` | `'one-for-one'` | `'one-for-one'` restarts only the isolate that crashed (and its pool, above). `'never'` fails on the first crash. |
| `supervisor.maxRestarts` | `3` | Restarts allowed within `withinMs`, and crashes in a row allowed after runs shorter than `withinMs`; the next crash fails the isolate. |
| `supervisor.withinMs` | `60000` | The restart window, in ms, and the healthy run that clears the count of short runs. |
| `supervisor.backoff.initialMs` | `250` | Delay before the first restart. |
| `supervisor.backoff.factor` | `2` | Growth per crash already counted. |
| `supervisor.backoff.maxMs` | `4000` | The cap. |
| `heartbeat.everyMs` | `100` | How often a worker beats. |
| `heartbeat.blockedAfterMs` | `400` | Silence before `blocked`. |
| `heartbeat.killAfterMs` | `10000` | Silence before the worker is terminated. |
| `heartbeat.readyTimeoutMs` | `10000` | Time a worker gets to say `ready`. |

A lower `killAfterMs` frees a stuck widget sooner and kills a slow but healthy one sooner too. A worker that does heavy work in one synchronous run needs a limit longer than that run.

The same settings apply to the bus worker ([below](#the-bus-worker)). Isolates can't set their own: supervision belongs to the host.

## Listening to events

```ts
kernel.on('isolate:crash', ({ id, reason, message, pool }) => {
  console.warn(`${id} crashed (${reason})${pool ? ` in pool ${pool}` : ''}: ${message}`);
});

const off = kernel.on('isolate:failed', ({ id, reason }) => {
  showToast(`${id} stopped working: ${reason}`);
});
// later
off();

declare function showToast(text: string): void;
```

`kernel.on(event, fn)` returns the function that stops listening. The events about isolates, which every `KernelEvent` of the form `isolate:*` names:

| Event | Payload | When |
| --- | --- | --- |
| `isolate:state` | `{ id, state, prev }` | Every state change. |
| `isolate:ready` | `{ id }` | The isolate said `ready`. |
| `isolate:crash` | `{ id, reason, message, pool? }` | A crash, before the restart. |
| `isolate:failed` | `{ id, reason, message, pool? }` | The supervisor gave up. |
| `isolate:error` | `{ id, message }` | A non-fatal error. |
| `isolate:beat` | `{ id, pool?, lagMs, busyMs?, at }` | Each heartbeat. The kernel emits it only while something listens. |

`KernelEvents` holds the payload of each event, including the `bus:*`, `workers:budget`, `route:*` and `agents:unmatched` events; the [hosting](hosting.md), [pools](pools.md) and [agents](agents.md) guides cover those. The [inspection feed](inspection.md) forwards the same events to tools.

`kernel.isolates()` gives the current state of each isolate as a snapshot, for a status panel that doesn't want to track events.

## Failed isolates and the fallback

A `failed` isolate stays down until someone restarts it: nothing retries after the restart limit. A visual isolate shows a **fallback** in its surface: a message and a Retry button that respawns it. `kernel.restart(id)` does the same from code, and either one clears both counts.

Replace the fallback for one isolate with `fallback` in its manifest. It's a `FallbackRender`: a function that fills the `slot` element, in the surface's shadow root, from a `FallbackInfo`.

```ts
import type { FallbackRender } from '@isoloop/host';
import chartUrl from './chart?isolate';

const fallback: FallbackRender = (slot, { id, reason, message, respawn }) => {
  const text = document.createElement('p');
  text.textContent = `${id} stopped (${reason}): ${message}`;
  const retry = document.createElement('button');
  retry.textContent = 'Try again';
  retry.addEventListener('click', respawn);
  slot.append(text, retry);
};

kernel.spawn({
  id: 'chart',
  src: chartUrl,
  surface: document.getElementById('chart')!,
  fallback,
});
```

- **`FallbackInfo`:** `id`, `reason` (the `CrashReason`, as text), `message`, and `respawn()`, which respawns the isolate and resets its restart window.
- **The slot is yours to fill** and is emptied when the fallback goes away. It sits over the surface and outside the isolate's own DOM, so the isolate can't touch it.
- **The surface is kept across restarts,** so the busy overlay and the fallback sit in the same place the isolate renders.
- **A headless isolate has no fallback.** React to `isolate:failed` instead.

## Catching up after a restart

A restarted isolate is a new worker with no memory of the old one, so it rebuilds from the bus. Its grants and its place in the bus are the same, and each subscription starts where its `from` says:

- **`committed`:** reads on after the isolate's last commit. Commits go out at most once per `bus.commitIntervalMs` (100 ms), so records handled shortly before the crash come again: delivery is at least once, and handlers should cope with a repeat.
- **`earliest`:** reads everything the topic still retains.
- **`latest`,** the default: starts with new records only.

Persistent topics replay the same way after a page reload. A pool restart does this for every member, each from its own offsets ([pools guide](pools.md#what-members-share)).

## The bus worker

The bus worker is supervised like an isolate, with the same `supervisor` and `heartbeat` settings. When it crashes:

1. **The kernel emits `bus:crash` and `bus:restart`,** and starts a new bus worker after the backoff.
2. **Running isolates keep running.** They get a new bus port, re-send their subscriptions and carry on. Persistent topics resume after the committed offset; memory topics are gone, so each subscription gets a `reset` and starts again from `earliest`. An isolate that can't handle a reset sets `bus: { onReset: 'restart' }` in its manifest and is restarted instead.
3. **Publishes made meanwhile are buffered,** up to 1 000 unanswered calls per isolate, then rejected with `bus_unavailable`.
4. **Past the restart limit,** the kernel emits `bus:failed`. Isolates keep running and every publish rejects with `bus_unavailable`.

If the bus crashes twice while loading, it starts in safe mode and sets aside the newest segment of each persistent topic; `bus:recovered` lists them.

## Suspension and resume

An isolate can opt in to being shut down while idle, with `suspend: 'when-idle'` (60 s) or `{ whenIdle: { afterMs } }` in its manifest. It becomes `suspended`, and wakes into `loading` when a visual isolate's surface is visible again, when a headless isolate's topic gets a record, or when you call `kernel.resume(id)`. A restart wakes every suspended headless isolate, as the new bus has lost what they were waiting for. At most `suspend.maxConcurrentWakes` (4) isolates start at once.

An isolate is **idle** when all of these hold: its surface isn't visible (off-screen, `display: none` or in a hidden tab; a headless isolate never is), nothing has been delivered to it for `afterMs`, it holds no `ctx.keepAwake()`, and no host call or unacknowledged publish of its own is in flight. A `keepAwake()` hold has no time limit; with `KernelConfig.dev` set, the kernel warns once one has been held for 10 minutes.

Suspension never touches the restart window. A pool suspends only as a whole, when every member has `suspend` set and is idle.

## Measured: a CPU-starved Firefox

Two sets of runs of the plant dashboard's Isoloop page (12 workers, one pool of 72 isolates), with nothing watching the page but a probe that samples it every 2 s. In both, the browser's workers were runnable but waiting for a CPU.

**2026-11-22, `0.1.0-next.11`, `killAfterMs` 2000** ([#389](https://github.com/isoloop/isoloop/issues/389)). A laptop-class 8-core CPU, Linux, Playwright 1.65 with Firefox 159, 4 threads limited by a CPU quota: 2 pages at once on 1 CPU (3 rounds) and 3 pages at once on 1.5 CPUs (4 rounds), 18 pages. Each run ended when all of its pages showed data.

- Every page had a heartbeat kill: 2,128 `unresponsive` crashes and 68 `ready_timeout` crashes in all.
- No isolate reached `failed`. One page had no data at the end. The median time to data was 19.4 s.
- Chromium under the same starvation had no crash in 7 pages.

**2026-11-24, 0.1.0 and the short-run rule, `killAfterMs` 2000 and 10 000** ([#389, the second set](https://github.com/isoloop/isoloop/issues/389#issuecomment-7130353263)). The short-run rule is the host built from `df2287f`, which counts crashes after short runs as well as the window. A desktop-class 16-core CPU, Linux in a virtual machine, Playwright 1.65 with Firefox 159. Every process was pinned to one logical CPU with 4 pages at once, or to one core (2 logical CPUs) with 6 pages at once. Each run lasted 150 s, whatever the page showed. 3 rounds, the four builds interleaved, 30 pages per build. On this faster machine, 2 pages on one CPU gave no kills, so the runs are more starved than the first set and the numbers don't compare one to one.

| Host | `killAfterMs` | Pages with a heartbeat kill | Pages with an isolate in `failed` | Isolates in `failed` | Pages without data after 150 s |
| --- | --: | --: | --: | --: | --: |
| 0.1.0 | 2000 | 24 of 30 | 17 of 30 | 1,224 | 3 |
| short-run rule (`df2287f`) | 2000 | 28 of 30 | 21 of 30 | 1,504 | 3 |
| 0.1.0 | 10 000 (default) | 3 of 30 | 2 of 30 | 83 | 4 |
| short-run rule (`df2287f`) | 10 000 (default) | 3 of 30 | 1 of 30 | 9 | 2 |

- At 2000 ms, a page with an isolate in `failed` had the whole pool of 72 in `failed`, 33 to 134 s after it started, on both hosts.
- At the default 10 s, most crashes were `ready_timeout`: 587 on 0.1.0 and 517 with the short-run rule.
- All 9 isolates that failed with the short-run rule failed after `ready_timeout` crashes. On 0.1.0, 30 of the 83 did, and 53 after heartbeat kills.

**2026-11-24, at a level where 0.1.0 recovers at the defaults** ([#389, the third set](https://github.com/isoloop/isoloop/issues/389#issuecomment-7132987368)). The same machine, browser and 150 s runs, with 6 pages at once pinned to one core (2 logical CPUs). The hosts are 0.1.0 and the short-run rule built from `main` at `eaaa863`, alternating run by run, 30 pages each.

| Host | `killAfterMs` | Pages with a heartbeat kill | Pages with an isolate in `failed` | Isolates in `failed` | Pages without data after 150 s |
| --- | --: | --: | --: | --: | --: |
| 0.1.0 | 10 000 (default) | 0 of 30 | 0 of 30 | 0 | 0 |
| short-run rule (`eaaa863`) | 10 000 (default) | 0 of 30 | 0 of 30 | 0 | 0 |
| 0.1.0 | 2000 | 30 of 30 | 11 of 30 | 792 | 1 |
| short-run rule (`eaaa863`) | 2000 | 29 of 30 | 18 of 30 | 1,296 | 0 |

- At the defaults, no isolate crashed on either host.
- At 2000 ms, every page had heartbeat kills.
- More pages reached `failed` with the short-run rule (18 of 30) than on 0.1.0 (11 of 30). The short-run rule counts heartbeat kills that 0.1.0's window let pass.

**2026-11-24, at a level where 0.1.0 crashes and recovers at the defaults** ([#389, the fourth set](https://github.com/isoloop/isoloop/issues/389#issuecomment-7135514962)). The same machine, browser and 150 s runs, with 8 pages at once pinned to one core (2 logical CPUs), at the default `killAfterMs`. The hosts are 0.1.0 and the short-run rule built from `main` at `eaaa863`, alternating run by run, 30 pages each.

| Host | Heartbeat kills | Ready timeouts | Pages with an isolate in `failed` | Pages without data after 150 s |
| --- | --: | --: | --: | --: |
| 0.1.0 | 216 | 323 | 0 of 30 | 1 |
| short-run rule (`eaaa863`) | 144 | 499 | 0 of 30 | 2 |

- Both hosts crashed and restarted isolates on these pages, and neither had an isolate in `failed`.

## Limits

- **State in the isolate's memory is lost on a restart.** Keep what must survive on the bus, in a persistent topic.
- **Delivery is at least once.** A restart can replay up to one commit interval of records that were already handled.
- **A hang is only caught after `killAfterMs`** (10 s by default), and a hidden tab isn't judged until it's visible. Until then a stuck isolate is `blocked` and a pool's other members are blocked with it.
- **A pool fails together.** One member that hangs restarts its neighbours and counts against each one's limit. Keep isolates that must not share fate in their own workers.
- **A failed isolate isn't retried.** The restart limit ends the automatic retries; a person or your code restarts it.
- **An isolate that crashes after each run of `withinMs` or longer is restarted every time.** Each long run clears the count, so it never reaches `failed`. Raise `withinMs` if crashes that far apart should still add up.
- **Some failures skip the retries.** A render format mismatch, a version mismatch or a bus that can't load its contracts fails the isolate on the first crash.
- **A starved browser looks like a hang.** A heartbeat's silence is measured in wall-clock time, so the supervisor can't tell a worker that waits for a CPU from one that's stuck. On a badly CPU-starved Firefox it kills workers that are only waiting. Those crashes count toward the restart limit like any other, so with a short `killAfterMs` such a page can reach `failed` ([measured above](#measured-a-cpu-starved-firefox)).
- **A worker starved before `ready` times out.** It crashes with `ready_timeout` after `heartbeat.readyTimeoutMs`. It never ran, so each such crash counts toward the limit, and a page that stays starved can reach `failed` at the defaults too. Raising `readyTimeoutMs` and `killAfterMs` gives a slow device more room, but a real hang then takes longer to catch. Telling a starved worker from a hung one is planned ([#389](https://github.com/isoloop/isoloop/issues/389)).
- **The supervisor can't see inside a worker.** A memory blow-up that the browser doesn't turn into a worker error, or an isolate that beats but does nothing useful, looks healthy.
- **There's one `supervisor` config per kernel.** You can't give one isolate its own limits.

## See also

- [Worker pools](pools.md): what members share, including fate.
- [Hosting](hosting.md): the bus worker and the contracts module, spawn failures, stopping.
- [The inspection feed](inspection.md): `restart`, `kill` and `block` for watching containment work.
- [The balancer](balancer.md): moves isolates out of a pool that blocks or crashes.
- [What Isoloop can't hide](limits.md)
