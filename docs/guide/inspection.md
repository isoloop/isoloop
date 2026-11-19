# The inspection feed

`kernel.inspect()` (`@experimental`) gives a live view of a running page: its isolates, pools and bus, the kernel's events, and records copied from the bus as they're appended. The devtools panel ([devtools guide](devtools.md)) and the dev MCP's `isoloop_*` tools ([agents guide](agents.md#in-development-the-dev-mcp)) both read it, and an app can read it too. The decisions are in [ADR 0020](../adr/0020-inspection-feed.md).

```ts
const inspector = kernel.inspect();

const { isolates, pools, bus, events } = inspector.snapshot();
const stop = inspector.on((m) => {
  if (m.t === 'event' && m.p.event === 'isolate:crash') console.warn(m.p.data);
});
const untap = inspector.tap(
  { topics: ['orders.*'], maxPerSec: 20, onSkipped: (n) => console.log(n, 'skipped') },
  (r) => console.log(r.topic, r.offset, r.preview),
);
// later
untap(); stop(); inspector.close();
```

Every message is plain, structured-cloneable data, the same for the host's `Inspector`, an isolate's `ctx.inspector` and the dev MCP's WebSocket.

## The Inspector

| Call | What it does |
| --- | --- |
| `snapshot()` | Isolates, pools, the bus (its state, restart count and latest metrics) and the last 200 events. |
| `on(fn)` | Feed messages from now on (below). Returns the function that stops them. |
| `tap(o, fn)` | Copies records appended to topics matching `o.topics` to `fn`, at most `o.maxPerSec` a second (default 50). `o.onSkipped` gets each count of records left out over the cap, at most once a second. Returns the function that ends it. Throws `bus_unavailable` without contracts. |
| `records(topic, { last })` | The last `last` records the topic still retains (at most 100), oldest first. Rejects with a `BusError`. |
| `restart(id)`, `kill(id)`, `block(id, ms)` | The controls (below). |
| `close()` | Stops this inspector's listeners and taps, and makes its controls reject. `snapshot()` still works. |

**Messages** (`m.t`, with the payload in `m.p`):
- `event`: a kernel event as it happens (`isolate:state`, `isolate:crash`, `isolate:failed`, `bus:crash`, `bus:recovered`, …), sent at once.
- `beats`: each isolate's latest beat (lag, busy time), coalesced to about one message a second.
- `metrics`: the bus's latest figures (per topic: rates, head offset, retained count; per subscription: lag and credit; rejected publishes), at most one a second.
- `memory`: each isolate's memory after a measurement, at most one every 5 s, only where memory can be measured (below).

The format is versioned and grows by additions only: a reader ignores fields and message types it doesn't know.

**Records** from `tap()` and `records()` are previews: topic, offset, key, time, producer, `req` (the request's id and `via`) when there is one, the value's size in bytes (`bytes`), and the value as text of at most 2,048 characters (`preview`, with `truncated` when it was cut). A tap isn't a consumer: it has no cursor or credit, and isn't in the bus figures. It's opened again after a bus restart; records appended while no bus runs aren't seen.

## Cost

Nothing runs for the feed until a reader listens, apart from a ring buffer of the last 200 supervisor and bus events, kept from the kernel's start so a reader that arrives after a crash still sees it. While a reader listens, events go out as they happen, and beats and bus metrics once a second.

Measured on the plant dashboard at 5 kHz, feed open against closed, 5 rounds on a dedicated bench machine (Ryzen 7 5825U, 4 cores at 2.0 GHz, Chromium 158 and Firefox from Playwright 1.65; [investigation](../investigations/inspect-feed-cost.md)):
- **Main-thread CPU:** gaps of −0 pp (−2 to +1) on cross-origin isolated Chromium and +0 pp (0 to +0) on headless Chromium.
- **CPU, all threads:** +1 pp (−7 to +1) on cross-origin isolated Chromium, where the feed also measured memory; −3 pp (−13 to +7) on headless Chromium.
- **Memory, first reading:** before GC, +3 MB (−3 to +7) on isolated Chromium and +4 MB (+2 to +7) on headless Chromium, where every round had the feed side higher. After a forced GC both spreads cross zero.
- **Firefox:** recovery after a 3 s block was faster with the feed open in all 5 rounds (median −110 ms, −297 to −4), which isn't explained yet.
- **The ring buffer:** about 18 KB as JSON on Chromium and 15 KB on Firefox, full within plant's first seconds.

Medians with their lowest-to-highest spread. That's one page, one load and one machine, with a reader that does nothing with what it gets. A tap wasn't open. CI's *Comparison (plant)* workflow runs a 3-round version weekly, report-only.

## The `inspect` grant and `ctx.inspector`

An isolate reads the feed through the `inspect` grant:

```ts
kernel.spawn({ id: 'my-devtool', src: toolUrl, surface: el, grants: { inspect: true } });
```

```ts
export default defineIsolate({
  async start(ctx) {
    const inspector = ctx.inspector!;      // undefined without the grant
    const snap = await inspector.snapshot();
    inspector.on((m) => { /* … */ });
  },
});
```

- **A port of its own:** the feed comes over a port from the host, not through bus topics. It keeps working while the bus restarts, and its traffic isn't in the bus figures it shows.
- **Never pooled:** spawning a pooled isolate with `inspect: true` fails with `invalid_config`, because a pool merges its members' grants.
- **The same calls** as the host's `Inspector`, asynchronous where they cross the port: `snapshot()`, `records()` and the controls return promises. It has no `close()`: the port ends with the isolate, and its controls then reject.

A tool that reads only the app's own topics needs no grant: it subscribes like any isolate. Only the kernel's feed needs `inspect`.

## Controls

| Control | What it does |
| --- | --- |
| `restart(id)` | Restarts the isolate, as `kernel.restart(id)` does. |
| `kill(id)` | Ends the isolate's worker as a crash (`worker-error`), so the supervisor restarts it like any other. Resolves once the kill is sent, not when the isolate is back. |
| `block(id, ms)` | Busy-loops the isolate's worker for `ms`, at most 10 s, so you can watch containment work: its beat goes late, it shows as `blocked`, and past the kernel's limit it's restarted. |

- **Pools:** for a pooled isolate, `kill` and `block` act on the pool's worker. A kill crashes and restarts every member, and the feed shows each one.
- **Errors:** they reject for an unknown id, and once the inspector is closed or its port has ended.
- **No production gate:** nothing stops them in a production build. Whoever holds an `Inspector`, or an isolate with `inspect`, can use them. The app grants that, the same as any other grant.

## Memory per isolate

Where the page is cross-origin isolated (COOP `same-origin` and COEP `require-corp`) and the browser has `performance.measureUserAgentSpecificMemory()`, which today means Chromium, the host measures the page's memory and attributes it to each worker by its URL:
- **When:** only while a reader listens, at most every 5 s.
- **Where it shows:** in the snapshot's isolates (`memory: { bytes, at, shared? }`) and as `memory` messages.
- **For a pool member,** the figure is the whole pool's worker, marked `shared`.
- **It's coarse and seconds old.** Chromium answers a measurement at its next garbage collection: in Playwright's Chromium 158, the first figure came 16 s after a reader started listening, then about every 17 s (isoloop#259). A reader should show the figure's age.
- **Only workers started from `@isoloop/runtime/worker`** are attributed, which is what `virtual:isoloop/workers` gives you with `@isoloop/vite` (see the [hosting guide](hosting.md) for the entry without Vite).
- **Elsewhere,** there's no `memory` field: Firefox, WebKit, and any page that isn't cross-origin isolated.

`@isoloop/vite`'s `crossOriginIsolated: true` sends the two headers from the dev and preview servers. In production, the host has to send them; the [hosting guide](hosting.md) lists them.
