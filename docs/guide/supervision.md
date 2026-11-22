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
- **After `killAfterMs` (10 000 ms) without a beat,** the kernel terminates the worker and counts a crash with reason `unresponsive`. During the [start-up warm-up](#start-up-warm-up) it waits longer.

`lagMs` comes with a beat, so a block shows in it only once the block ends and the late beat arrives; while the block lasts, `lagMs` keeps the last beat's value, often 0. To see a block in progress, read `state` and the time since `lastBeatAt` (`sinceBeatMs` in the dev MCP's `isoloop_isolates`).

### Start-up warm-up

An isolate says `ready` before its `start()` runs, so mounting and the first replay could look like a hang. So each start has a warm-up. While it lasts, a kill waits until there's been no beat for `readyTimeoutMs` (10 000 ms), or for `killAfterMs` if that's longer. It ends once the beats have been on time (no more than 100 ms late) for 1 s, or `readyTimeoutMs` after `ready`, whichever comes first. Then `killAfterMs` applies again.

- **`blocked` isn't delayed:** the overlay shows after `blockedAfterMs` as usual.
- **In a pool,** the warm-up starts again with each member's `ready`, for every member on that worker, since they share a loop.
- **With a `killAfterMs` under `readyTimeoutMs`,** a block in about the first second after a start or a restart (longer on a loop that's still busy) can end without a kill, and a real hang there is killed up to `readyTimeoutMs` later. The defaults are equal, so they change nothing.
- **The bus worker has none:** `killAfterMs` applies to it from the start.

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

1. **Counts it** against the restarts in the last `withinMs`.
2. **Restarts after a backoff** while that count is below `maxRestarts`. The delay is `initialMs × factor^n`, capped at `maxMs`, where `n` is the number of restarts already in the window. With the defaults it's 250 ms, 500 ms, then 1 s.
3. **Gives up as `failed`** when the window is full, when `strategy` is `never`, or when the reason is one that isn't restarted. It emits `isolate:failed` and shows the fallback.

With the defaults, a fourth crash within 60 s fails the isolate. Old restarts leave the window as they age, so an isolate that crashes now and then keeps being restarted. A **manual restart** (`kernel.restart(id)`, the fallback's Retry) clears the window; the `restarts` count in the snapshot keeps counting crash restarts since the spawn.

Other isolates are untouched. A restart starts a new worker, so the isolate's in-memory state is gone: what it rebuilds from is the bus ([below](#catching-up-after-a-restart)).

### In a pool

The heartbeat belongs to the worker, so a pool's members block and are killed together ([pools guide](pools.md#what-members-share)).

- **The worker fails:** when a member crashes with `unresponsive` or `worker_error`, every other member on that worker crashes with the same reason. The worker is terminated, and every member restarts in a new one. Each member's `isolate:crash` carries the `pool`. The message names no member, because the worker can't tell which one caused it. A [kill](inspection.md#controls) is the exception: the others' message names the member that was killed.
- **A member's own failure:** a fatal error, a ready timeout or a version mismatch crashes only that member. It restarts alone and rejoins the running worker.
- **Limits are per isolate.** Each member counts the shared crash in its own window, so a pool that keeps failing usually reaches `failed` for all its members together.

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
    withinMs: 30_000,
    backoff: { initialMs: 500, factor: 2, maxMs: 8000 },
  },
  heartbeat: { blockedAfterMs: 400, killAfterMs: 5000 },
});
```

Every field is optional. `backoff` takes any of its three fields; the rest keep their defaults.

| Option | Default | Meaning |
| --- | --- | --- |
| `supervisor.strategy` | `'one-for-one'` | `'one-for-one'` restarts only the isolate that crashed (and its pool, above). `'never'` fails on the first crash. |
| `supervisor.maxRestarts` | `3` | Restarts allowed within `withinMs`; the next crash fails the isolate. |
| `supervisor.withinMs` | `60000` | The window, in ms. |
| `supervisor.backoff.initialMs` | `250` | Delay before the first restart in a window. |
| `supervisor.backoff.factor` | `2` | Growth per restart already in the window. |
| `supervisor.backoff.maxMs` | `4000` | The cap. |
| `heartbeat.everyMs` | `100` | How often a worker beats. |
| `heartbeat.blockedAfterMs` | `400` | Silence before `blocked`. |
| `heartbeat.killAfterMs` | `10000` | Silence before the worker is terminated, outside the [warm-up](#start-up-warm-up). |
| `heartbeat.readyTimeoutMs` | `10000` | Time a worker gets to say `ready`, and the most the warm-up after it lasts. |

A lower `killAfterMs` frees a stuck widget sooner once it has warmed up, and kills a slow but healthy one sooner too. A worker that does heavy work in one synchronous run needs a limit longer than that run.

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

A `failed` isolate stays down until someone restarts it: nothing retries after the window. A visual isolate shows a **fallback** in its surface: a message and a Retry button that respawns it. `kernel.restart(id)` does the same from code, and either one clears the restart window.

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

## Limits

- **State in the isolate's memory is lost on a restart.** Keep what must survive on the bus, in a persistent topic.
- **Delivery is at least once.** A restart can replay up to one commit interval of records that were already handled.
- **A hang is only caught after `killAfterMs`** (10 s by default; later during a [warm-up](#start-up-warm-up) when you set it lower), and a hidden tab isn't judged until it's visible. Until then a stuck isolate is `blocked` and a pool's other members are blocked with it.
- **A pool fails together.** One member that hangs restarts its neighbours and counts against each one's limit. Keep isolates that must not share fate in their own workers.
- **A failed isolate isn't retried.** The window ends the automatic retries; a person or your code restarts it.
- **Some failures skip the retries.** A render format mismatch, a version mismatch or a bus that can't load its contracts fails the isolate on the first crash.
- **The supervisor can't see inside a worker.** A memory blow-up that the browser doesn't turn into a worker error, or an isolate that beats but does nothing useful, looks healthy.
- **There's one `supervisor` config per kernel.** You can't give one isolate its own limits.

## See also

- [Worker pools](pools.md): what members share, including fate.
- [Hosting](hosting.md): the bus worker and the contracts module, spawn failures, stopping.
- [The inspection feed](inspection.md): `restart`, `kill` and `block` for watching containment work.
- [The balancer](balancer.md): moves isolates out of a pool that blocks or crashes.
- [What Isoloop can't hide](limits.md)
