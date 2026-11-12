# Worker pools

By default every isolate gets its own worker ([ADR 0001](../adr/0001-one-worker-per-isolate.md)): its own thread, heap and copy of the runtime, so one isolate that blocks or crashes affects only itself. A **pool** puts several isolates in one worker instead, headless ones, visual ones (widgets) or both. It saves memory and start-up time, and gives up isolation between the members.

```ts
kernel.spawn({ id: 'feed-t1', src: feedUrl, pool: 'machine-t1' });
kernel.spawn({ id: 'stats-t1', src: statsUrl, pool: 'machine-t1' });
kernel.spawn({ id: 'trend-t1', src: trendUrl, surface: trendEl, pool: 'widgets-t1' });
kernel.spawn({ id: 'gauges-t1', src: gaugesUrl, surface: gaugesEl, pool: 'widgets-t1' });
kernel.spawn({ id: 'login', src: loginUrl, surface: loginEl }); // its own worker
```

Placement belongs to the host: the isolate's code is the same either way, and an isolate can't ask for a pool or refuse one. The pool's worker starts with its first member and goes away after its last.

## What it saves

Measured for 20 small headless isolates, own workers against one pool ([bench/pools](../../bench/pools/README.md), 2026-11-08): 71–86% less memory and 2–3 times faster start-up on Chromium, Firefox and WebKit. Each worker's fixed cost (thread, engine instance, loaded code) is paid once per pool instead of once per isolate. Isolates with large state of their own save a smaller share, because that state costs the same in a pool. CI reports these numbers on every bench run.

For 8 React widgets fed at the plant dashboard's data rate ([bench/visual-pools](../../bench/visual-pools/README.md), 2026-11-09): 35–64% less memory, start-up up to twice as fast, and no change in the time from a record being published to its patch being applied. Widgets built together share one framework instance in a pool, which is where most of the saving comes from.

## What members share

- **An event loop.** A member that runs a long computation delays every other member's records and timers. Keep heavy work in its own worker.
- **Fate.** If a member stops responding or its worker errors (an exception from a timer, say), every member crashes with it and the pool restarts in a new worker. Each member's `isolate:crash` names the `pool`, and the message names the member that caused it. Each member then reads on from its committed offsets, so records it had read but not committed come again (at least once, as after any restart). A member's own fatal error (`start()` throwing, a ready timeout, a version mismatch) crashes only that member.
- **Globals.** Members run in the same realm. A pool worker freezes the built-ins before its first member loads, so `Array.prototype.x = …` throws instead of changing arrays for the neighbours; overriding an inherited property on your own objects (`this.name = 'MyError'`) still works. Other globals (`globalThis.foo`, caches in shared libraries) are still shared.
- **Grants, in effect.** Each member keeps its own grants on the bus, but code in one member can reach the others' bus ports, so treat a pool as holding the union of its members' grants. `kernel.pools()` lists that union with the members.
- **Leftovers.** When one member is stopped or restarted alone, the pool stops routing messages and records to it, but timers it started keep running in the shared worker until they end. Clear them in `ctx.onShutdown`.
- **Suspension.** A pool suspends only as a whole: when every member asks for `suspend` and all of them are idle. A record or `kernel.resume` for any member wakes the whole pool. Registering a member that asks for `suspend` next to one that never suspends warns once.

## Visual pools

Widgets in a pool each render into their own surface, but inside the worker they share one document, as widgets on one page do ([ADR 0015](../adr/0015-visual-pools.md)). On top of everything above, that means:

- **Members of a pool can read each other's DOM and input.** A member can find another member's nodes through `document`, including what users type into its fields, and a key listener on `document` or `window` hears keystrokes in every member's fields. `kernel.pools()` says so for every pool with a visual member (`sharesDocument`, `warning`). **Keep widgets that handle secrets (passwords, tokens, payment details) on their own worker.**
- **One focus.** `document.activeElement` is the pool's, as on a page.
- **Frames.** One `requestAnimationFrame` loop drives every member. A slow render in one widget delays the others' next frame.
- **Nodes stay with their member.** Moving a node from one member's root into another's throws, in the code doing the move.
- **Render errors stay the member's own.** The React and Preact adapters catch a render error at the member's root and report it with `ctx.reportError`, so only that widget crashes and restarts. An error thrown from a timer or a shared scheduler can't be traced to a member, so the whole pool restarts.
- **Headless and visual members can share a pool,** for example a machine's feed with its widgets. They share fate like any members: if the feed hangs, its widgets restart with it.
- **React and Preact widgets can share a pool,** but the memory saving comes from members sharing one framework instance, so prefer one framework per pool. Widgets built apart from the host ([ADR 0012](../adr/0012-isolates-built-apart.md)) bring their own framework copy and save less.

### Modals, tooltips and toasts

Libraries that render overlays usually append them to `document.body`, which reaches no surface, in a pool or in an own worker. Each visual isolate has a portal container inside its own surface instead: `ctx.portalRoot`, or `usePortalRoot()` in the React and Preact adapters. Point the library at it:

```tsx
import { createPortal } from 'react-dom';
import { usePortalRoot } from '@isoloop/react';

function Confirm({ onYes }: { onYes: () => void }) {
  return createPortal(
    <dialog open>
      Delete? <button onClick={onYes}>Yes</button>
    </dialog>,
    usePortalRoot(),
  );
}
```

Most overlay libraries take a container option for the same purpose. The portal container is made on first use and lives inside the widget's surface, so the overlay is clipped to the widget. An overlay that must cover the whole page belongs to the host page, not to an isolate.

## When to pool

| Pool | Keep in its own worker |
|---|---|
| Small headless isolates: feeds, adapters, light transforms, state managers | Heavy computation (it holds up the whole pool) |
| Widgets that belong together: one machine's panel, one feature's views | Widgets that handle secrets (members can read each other's DOM and input) |
| Isolates that belong together and can fail together (one machine's feeds, one feature) | Code you trust less than its neighbours, or from another team |
| Many isolates that each do little, where the worker count adds up | Isolates whose crash must not take others down |

Group by what fails together: a pool is a unit of failure.

## When to pool, and when not to: the plant dashboard's figures

The [plant dashboard](https://github.com/isoloop/examples/tree/main/apps/dashboards/plant) (72 widgets, 8 machines) runs the same code in several placements, so it shows what each choice costs and contains. Unless a row says otherwise, figures are from its latest matched comparison on a dedicated machine ([`comparison/matched-v2/`](https://github.com/isoloop/examples/tree/main/apps/dashboards/plant/comparison/matched-v2), `@isoloop/*@0.0.0-next.d028bc1`): Chromium, 4 physical cores fixed at 2.0 GHz, 1 kHz, medians of 5 rounds. Memory is after GC, 16 s after load. The per-pool costs come from the [plant memory investigation](../investigations/plant-memory.md).

| Do | Don't | Why, measured |
| --- | --- | --- |
| Pool widgets that may stall together | Give each widget its own worker at dashboard scale | An own worker with one React widget costs about 4.4 MB; the same widget in a pool about 1.2 MB. In the plant, going from 9 visual pools to 3 saved 46 MB. `own` runs 105 workers, over the soft budget of 32. |
| Pool small headless isolates | Give every feed and engine its own worker | A headless member in a pool costs about 0.2 MB, against 2.8 MB on its own worker. |
| Keep data and widgets in separate pools when data must not stop | Put a machine's feed in its widgets' pool | Blocking one widget for 3 s: in `machine` (feed and widgets together) that machine lost 3.3 s of data. In `matched` and `split` (data apart) no machine lost any.¹ |
| Split by failure domain | Put everything in one pool | In `one`, a 3 s block stalled every widget and cost every machine 3.3 s of data, as on a native page. After a 10-minute run it took 5.5 s to recover, against 3.4–3.5 s early in a run, because a restarted member that reads from `'earliest'` replays the retained history on the pool's one thread ([investigation](https://github.com/isoloop/isoloop/pull/172)). |
| Add pools for containment, knowing each one costs a thread | Add pools you don't need | CPU across threads rises with the number of workers: 88% in `one` (1 + bus), 95% in `matched` (10 + bus), 110% in `split` (18 + bus). Time to first data: 512, 535 and 816 ms. |

¹ `machine` isn't in the matched comparison; this figure is from the first, local run ([`comparison/desktop-4core/`](https://github.com/isoloop/examples/tree/main/apps/dashboards/plant/comparison/desktop-4core)), which was on a different machine with an unfixed clock. Its data gaps don't depend on the machine; its CPU and memory figures aren't comparable with the table below.

### What each placement cost and contained

Blocking one widget for 3 s, then letting its pool restart. Chromium, 1 kHz, from `matched-v2/` except where marked.

| Placement | Workers | What the block stalls | Data lost | Recovery | CPU across threads | Memory after GC |
| --- | --- | --- | --- | --- | --- | --- |
| native | main thread only | the whole page | 3.8 s on every machine | 3.2 s | 80% | 156 MB |
| native + workers | 9 | the whole page | none | 3.1 s | 86% | 191 MB |
| `one` | 1 + bus | every widget, feed and engine | 3.3 s on every machine | 3.4 s | 88% | 185 MB |
| `matched` | 10 + bus | all 72 widgets (one visual pool) | none | 2.9 s | 95% | 239 MB |
| `split` (default) | 18 + bus | that machine's 8 widgets | none | 3.3 s | 110% | 285 MB |
| `machine`¹ | 10 + bus | that machine's widgets, feed and engines | 3.3 s on that machine | 3.4 s | – | – |
| `shared-engines`¹ | 12 + bus | that machine's 8 widgets | none | 3.4 s | – | – |
| `own`¹ | 105 + bus | that widget only | none | 2.4 s | – | – |

In every Isoloop placement the main thread stayed at 23–28% CPU at 5 kHz, against 80–82% for the native builds, where both native builds slowed typing and Firefox dropped frames. That's a measured behaviour of this workload on this machine, not a guarantee.

### For large desktop dashboards

- **Fewer, larger visual pools** where widgets can stall together. Each plant visual pool carries its own framework, runtime, document and widget code (about 7.7 MB); going from nine visual pools to three saved 46 MB after GC.
- **Data pools per failure domain,** apart from the widgets. A widget that blocks then stalls only its pool's widgets, and every machine's data keeps flowing, so the widgets catch up from the retained topics when the pool restarts.
- **Own workers** for the few widgets that must not stall with anything else, or that handle secrets (see [Visual pools](#visual-pools)), not for every widget.

## Inspecting pools

- `kernel.isolates()`: each member's `pool`.
- `kernel.pools()`: each pool's members, whether its worker runs, its effective grants, and whether its members share a document (`sharesDocument`, with a `warning`).
- A pool counts as one worker against `workers.budget`.
