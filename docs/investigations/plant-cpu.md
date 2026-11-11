# Investigation: where the plant dashboard's extra Isoloop CPU goes

- **Date:** 2026-11-10
- **Question:** in the plant dashboard's matched head-to-head (isoloop/examples `apps/dashboards/plant/comparison/matched-q6/`), the Isoloop builds use 10–20 percentage points more CPU across the renderer's threads than the matched native builds. Cutting about 25% of the bus messages (Q6, examples#59) moved no CPU figure beyond the round spread. Where does the extra CPU go, what can be fixed, and should [ADR 0016](https://github.com/isoloop/isoloop/pull/164) (fewer messages per record, on hold) come back?
- **Answer:** most of the gap is the cost of **moving records between threads**, and most of that is a fixed cost per message, not per byte.
  - **Messaging in the browser** is half the gap at 5 kHz. That's Chromium delivering each `MessagePort` message (a mojo receive, a wake-up, `MessagePort::Accept`), serializing and deserializing.
  - **Isoloop's own messaging code** comes next, on both ends: the bus broker, the runtime's bus client, and the host's dispatch on the main thread.
  - **Kernel time and native task overhead** on the busy threads grow with the number of messages too.
  - **The demo's own metrics sampler** is another 10–14%, which Isoloop's build pays and the native builds don't.

  Against that, Isoloop spends less on canvas work and on style, layout and paint. Those differences are offsets, not savings, and part of them may come from how time is attributed (see [Caveats](#caveats)).

  Ranked, Isoloop minus native, in ms of CPU per second (one core = 1,000):

  | Cause | native + workers → `matched`, 5 kHz | native → `one`, 5 kHz | `matched`, 1 kHz | `one`, 1 kHz |
  | --- | --- | --- | --- | --- |
  | **Renderer CPU gap** | **+180** (1,001 → 1,181) | **+186** (942 → 1,128) | **+144** (822 → 966) | **+186** (791 → 977) |
  | Messaging in the browser: port delivery, serialize, deserialize | +101 (56%) | +96 (52%) | +74 (52%) | +76 (41%) |
  | Isoloop messaging JS: bus broker, schema validation, protocol guards, the runtime's bus client, the host's bus controller | +45 (25%) | +34 (18%) | +33 (23%) | +24 (13%) |
  | CPU not covered by trace events on JS threads (mostly kernel time) | +39 (22%) | +35 (19%) | +40 (28%) | +34 (18%) |
  | Native task overhead | +24 (13%) | +33 (18%) | +16 (11%) | +25 (13%) |
  | The demo's metrics panels | +23 (13%) | +19 (10%) | +21 (14%) | +21 (11%) |
  | Host on the main thread, other: dispatch of worker messages, kernel snapshots | +21 (12%) | +26 (14%) | +23 (16%) | +26 (14%) |
  | Runtime other, patch apply, worker DOM, animation frames in workers | +15 (8%) | +16 (9%) | +15 (11%) | +14 (8%) |
  | React, app widgets, browser API calls | +15 (8%) | +10 (5%) | +8 (5%) | +8 (4%) |
  | App feeds and engines (the same code in every build) | 0 | +35 (19%) | −8 | +10 (5%) |
  | GC | −2 | +10 (5%) | +1 | +7 (4%) |
  | Other threads: compositor, thread pool, IO | −2 | 0 | −5 | −2 |
  | Canvas: drawing JS, raster and present | −58 (−32%) | −59 (−32%) | −52 (−36%) | +7 (4%) |
  | Style, layout, paint, commit | −37 (−21%) | −61 (−33%) | −46 (−32%) | −53 (−29%) |

  Each share is of that column's gap; the positive rows add up to more than 100% because of the negative rows.
  - **Messaging taken together** (the first two rows plus the host's dispatch) is +167 ms/s for `matched` at 5 kHz, more than the whole gap. The kernel time and task overhead that come with each message are on top of that.
  - **The GPU process isn't in these figures:** it uses another 45–57 ms/s for Isoloop (289 → 334 for `matched`, 284 → 337 for `one`, at 5 kHz).
- **ADR 0016:** bus messaging is a real share, the largest. **It should come back.**
  - **Why Q6 showed nothing:** Q6's cut was too small for the comparison to see. About 25% of messaging is roughly 25–35 ms/s, or 2–3 percentage points. The comparison's round spread at 5 kHz is several points, and Q6 measured −2 points there.
  - **Measuring it next time:** ADR 0016's changes should be measured with this probe, which reports the messaging buckets directly, and not only by the comparison's total.

## Method

- **Machine:** the benchmark server, the same as the matched comparison. AMD Ryzen 7 5825U, Ubuntu 24.04.3, Docker 28.5.1, other containers paused, every core fixed at 2.0 GHz (`bench-mode on`). Playwright's image `v1.64.1-noble`, Chromium 156 headless, pinned to 4 physical cores (`--cpuset-cpus=2,4,6,8`).
- **Builds:** isoloop/examples at `db898eb` (after Q6), with `@isoloop/*@0.0.0-next.61245db`, built **unminified** (`vite build --minify false`), so profiles have function names. Isoloop's libraries ship unminified already. A minified build measured the same way, untraced, gives the same renderer CPU within 1%: `matched` 1,165 against 1,158 ms/s, `one` 1,110 against 1,104, native + workers 991 against 992, native 941 against 956 (median of 3 each, at 5 kHz).
- **Configurations:** native + workers against Isoloop `matched`, and native against Isoloop `one`. 5 kHz and 1 kHz, 4 rounds each, interleaved, one page at a time, in a fresh browser per run. The URL is the comparison's (`?rate=…&seed=7&placement=…`), at a viewport of 1,400 × 900.
- **Per run** ([`assets/plant-cpu/probe.mjs`](assets/plant-cpu/probe.mjs)): wait for first data plus 15 s, then three 10 s windows on the same page:
  1. **Untraced.** Each renderer thread's CPU from `/proc/<pid>/task/<tid>/stat` (user and kernel time), plus the GPU and browser processes. These are the figures this page reports. They add up to Chromium's own per-process CPU (`SystemInfo.getProcessInfo`) within 1%.
  2. **Events trace.** Timeline, blink, canvas, Skia, GPU-client, IPC and GC trace events, which carry thread time, with no sampling profiler.
  3. **Profile trace.** The V8 sampling profiler on every thread (main and workers), only to split time in JS by source module.
- **Attribution** ([`assets/plant-cpu/analyze.mjs`](assets/plant-cpu/analyze.mjs)), per renderer thread:
  - **Native work:** each trace event's self thread time (its `tdur` minus its children's), bucketed by event name.
  - **JS:** the self time of the events that run JS (`FunctionCall`, `RunMicrotasks`, `TimerFire`, `FireAnimationFrame`, …) is split by the V8 samples on that thread. Each sample is mapped to a source module through the bundle's region comments and, for Isoloop's libraries, through their own `dist` files' region comments.
  - **Scaling:** the split is scaled to the thread's untraced CPU, so tracing's own cost doesn't count. CPU the events don't cover is reported as its own row.
  - **Coverage:** the events cover 89–94% of the busy threads' traced CPU in every configuration.
- **Results:** per-run figures and the summaries are in [`assets/plant-cpu/results/`](assets/plant-cpu/results/). The traces themselves (about 1 GB) stayed on the server. [`drill.mjs`](assets/plant-cpu/drill.mjs) gives the event-level and function-level breakdowns quoted below, and [`run-cpu.sh`](assets/plant-cpu/run-cpu.sh) is the whole session.

## Per thread

Medians of 4 runs, ms of CPU per second:

| | Main thread | Workers (count) | Other renderer threads | Renderer total | Of which kernel time | GPU process |
| --- | --- | --- | --- | --- | --- | --- |
| native, 5 kHz | 838 | 0 (0) | 104 | 942 | 24 | 284 |
| Isoloop `one`, 5 kHz | 247 | 754 (2) | 128 | 1,128 | 63 | 337 |
| native + workers, 5 kHz | 826 | 82 (9) | 97 | 1,001 | 34 | 289 |
| Isoloop `matched`, 5 kHz | 284 | 795 (11) | 102 | 1,181 | 64 | 334 |
| native, 1 kHz | 699 | 0 (0) | 94 | 791 | 22 | 284 |
| Isoloop `one`, 1 kHz | 260 | 604 (2) | 110 | 977 | 47 | 341 |
| native + workers, 1 kHz | 686 | 46 (9) | 100 | 822 | 29 | 286 |
| Isoloop `matched`, 1 kHz | 280 | 580 (11) | 98 | 966 | 60 | 323 |

- **The totals agree with the comparison:** `matched` against native + workers at 5 kHz is 118% against 100% here, and 119% against 101% in `matched-q6`.
- **Worker counts:** Isoloop's include the bus worker, so 10 + bus = 11 for `matched`, and 1 + bus = 2 for `one`.
- **"Other renderer threads"** are the compositor, the thread pool (GC helpers, compile, raster tasks) and IO, which are about the same in every build.

## Where the gap goes

### 1. Messaging in the browser: +74 to +101 ms/s

Self thread time of the messaging events, `matched` at 5 kHz, traced (before scaling to untraced CPU):

| Thread | Event | Isoloop `matched` | native + workers |
| --- | --- | --- | --- |
| workers | `SerializedScriptValueFactory::deserialize` | 23.3 | 0.1 |
| workers | `MessagePort::Accept` | 22.1 | – |
| workers | `SimpleWatcher::OnHandleReady` (a port has a message) | 21.5 | – |
| workers | `SerializedScriptValueFactory::create` (serialize) | 21.1 | 3.8 |
| workers | `Receive mojo message` | 14.4 | – |
| workers | `DedicatedWorkerGlobalScope::postMessage` | 2.4 | 3.3 |
| main | `HandlePostMessage`, outside the JS it runs | 22.0 | 2.6 |
| main | `SerializedScriptValueFactory::deserialize` | 3.3 | 4.0 |
| IO and others | `EpollEvent`, mojo | 20.5 | 8.6 |

- **What differs:** Isoloop's isolates talk to the bus over `MessageChannel` ports ([ADR 0005](adr/0005-bus-topology-message-channels.md)). Every message on a port is a mojo message: the receiving thread wakes on its handle (`SimpleWatcher`), reads it (`Receive mojo message`), accepts it (`MessagePort::Accept`), and only then deserializes.
- **What native + workers does instead:** each worker posts to the page with its own `postMessage`, which skips those steps. It also sends far fewer messages: one per record batch to the main thread, and no bus hop.
- **Fixed cost per message:** the port steps (Accept, the watcher, the mojo receive and the IO-thread epoll) are about 80 of the ~150 traced ms/s, and the main thread's dispatch outside JS is another 22. Serialize and deserialize together are about 48. So roughly two thirds of the browser's messaging cost doesn't depend on payload size.

### 2. Isoloop's messaging code: +24 to +45 ms/s

The bus broker (`#publish`, `#fanOut`, `#commit`, `post`, `estimateSize`), the runtime's bus client (its port listener, `send`, `receive`, `drain`, `publish`), schema validation (zod, 1–2 ms/s) and protocol guards (under 2 ms/s). The codec doesn't show up, because memory topics use structured clone. Every part of it runs once per message.

### 3. Host on the main thread: +21 to +26 ms/s

The host's `message` listener on each worker and its `onMessage` routing are the main thread receiving DOM batches, reports and host calls from the isolates. `kernel.isolates()` builds a snapshot of every isolate (about 90), and the demo's sampler calls it every frame (cause 5).

### 4. CPU not covered by trace events, and native task overhead: +16 to +40 ms/s each

- **Kernel time:** on the renderer's threads it's 47–64 ms/s for Isoloop, against 22–34 for native, and most of the difference is on the worker threads (+14 to +31). That's mostly the uncovered row: thread wake-ups and the IPC behind each port message.
- **Native task overhead** (posting and running tasks, interrupts) grows the same way.
- Both follow the number of messages. Timers aren't the cause: the heartbeat already runs once per worker, not once per pool member (`startHeartbeat` in `packages/runtime/src/bootstrap.ts`).

### 5. The demo's metrics panels: +19 to +23 ms/s

- **The source:** `src/metrics/isoloop.ts` runs `sample()` on every animation frame. It calls `kernel.isolates()` to read each surface's last apply time. On top of that comes the per-thread timing batch from Q6.
- **The native builds' equivalent** reads counters in-thread.
- **Like `plant.timings` before Q6,** this is the dashboard measuring itself, and only Isoloop's build pays for it.

### What Isoloop does less of: −37 to −61 ms/s in style, layout, paint and commit, and −52 to −59 ms/s in canvas work at 5 kHz

- **Canvas raster costs about the same in every build.** There is no GPU here, so it's software raster (`SkCanvas::drawPath` and friends). It happens on the main thread in the native builds and on the visual pool's worker in Isoloop.
- **What's cheaper in Isoloop:** canvas JS and present, and style, layout and paint on the main thread, which applies DOM batches instead of React commits.
- **What's more expensive elsewhere:** the GPU process, for compositing each worker canvas's own frames, at +45 to +57 ms/s. That isn't part of the renderer total.

### Not explained yet

- **`one`'s feeds and engines:** at 5 kHz in `one`, the app's feeds and engines (`stats.push`, `vibChunk`, `fft`) take 96 ms/s, against 62 on native's main thread. In `matched` the same code takes the same time as in native + workers (57 against 57). `one` runs all eight machines' engines and all 72 widgets in one pool on one thread. Candidates that weren't tested:
  - V8 getting less from its optimizations when one heap runs every machine's code
  - the pool worker's frozen built-ins (M2c task 7)
  - wall-time samples on a nearly saturated thread

## Fixes

The agreed rule applies to each: a change goes in if it keeps every feature and measures as a saving beyond the round spread. A change that weakens a feature comes to the user on its own.

| Fix | Targets | Estimated saving, `matched` at 5 kHz | Keeps every feature? | ADR |
| --- | --- | --- | --- | --- |
| **1. ADR 0016: batching per port per task, combined commits, results only on failure** | Causes 1–4: one message carries several records, and fewer commits and results are sent | About 30% fewer port messages (ADR 0016's estimate, from about 1,760 to 1,150–1,250 a second). On the fixed part per message, about **−45 to −60 ms/s** (25–35% of the gap). That's an estimate, to be measured with this probe | Yes, with ADR 0016's costs: up to ~100 ms of redelivery after a crash, and memory-topic `publish` resolving on send | [0016](https://github.com/isoloop/isoloop/pull/164) (amends 0005 and 0003) |
| **2. Event-driven metrics in the demo:** read apply times from a kernel event, or sample once a second instead of every frame | Cause 5, and part of cause 3 | Up to **−20 ms/s** (10–14%) | Yes; the panels show the same figures | None (app only, examples) |
| **3. Deliver once per pool worker** (ADR 0016's deferred C) | Causes 1–2 inside pools | Deliveries from about 815 to about 593 a second; on top of fix 1, perhaps −10 to −20 ms/s | No: pool members would share record objects. It goes to the user on its own | 0005 |

**Inherent:**
- **The extra hop through the bus worker** ([ADR 0005](adr/0005-bus-topology-message-channels.md)). A record crosses at least two ports (into the bus, then out to each subscribing worker), where native + workers posts once to the page.
- **The cost of a `MessagePort` message in Chromium,** compared with a worker's own `postMessage`. Ports are the only direct channel between sibling workers.

Removing these would need shared-memory rings between the bus and the workers. That requires cross-origin isolation ([engine constraint 5](engine-constraints.md#5-shared-memory-and-memory-measurement-need-cross-origin-isolation)), which GitHub Pages can't provide without a service-worker workaround.

## ADR 0016 decision 1, measured: combined commits

- **Date:** 2026-11-11. The build is isoloop#166 (not merged), measured before merge.
- **What changed:** subscribers send one `commits` message per port per commit interval instead of one `commit` per record.
- **Answer:**
  - **Messages:** port messages fall by 20% at 100 ms and by 27% at 250 ms (`matched`, 5 kHz).
  - **Messaging CPU in the browser** falls by 8–14 ms/s, beyond the round spread.
  - **Isoloop's own messaging JS** falls by up to 4 ms/s, beyond the spread only at 250 ms.
  - **The renderer total** doesn't move beyond the spread at either interval.

  Commits turn out to be cheap messages: about 600 fewer a second save about 10 ms/s, roughly a third of what an average port message costs. Most of the messaging cost is in the deliveries, which decision 1 leaves alone.

**How it was measured:**
- **Session:** one session on the benchmark server, as in [Method](#method): 4 physical cores fixed at 2.0 GHz, Chromium, the probe above, 4 interleaved rounds.
- **Interleaved per round:**
  - native + workers and native
  - the stock libraries `0.0.0-next.61245db` (`isobase`)
  - #166's libraries, packed, at `commitIntervalMs` 100 (`isoloop`) and 250 (`isoc250`)
- **App:** both Isoloop builds run isoloop/examples `8f22ce0`, which includes the metrics-sampler fix (examples#61). They differ only in the libraries and the interval.
- **Port messages a second** are `MessagePort::Accept` trace events in the renderer, which counts every message any thread receives on a port. Native + workers' own messages use `DedicatedWorkerGlobalScope::postMessage` and hardly show in this count.
- **Data:** [`assets/plant-cpu/adr16-commits/`](assets/plant-cpu/adr16-commits/) holds per-run buckets, message counts, and the scripts (`run-adr16.sh`, `session.sh`, `msgs.mjs`, `compare.py`).

**Medians of 4 runs, ms of CPU per second, with the lowest to highest run in brackets:**

| `matched`, 5 kHz | Renderer | Messaging in the browser | Isoloop messaging JS | Port messages/s |
| --- | --- | --- | --- | --- |
| native + workers | 978 [960–995] | 19 | 0 | 36 |
| stock | 1,167 [1,146–1,181] | 121 [118–122] | 44 [41–46] | 3,007 [2,999–3,011] |
| commits, 100 ms | 1,144 [1,083–1,159] | 112 [106–114] | 43 [41–45] | 2,401 [2,393–2,403] |
| commits, 250 ms | 1,142 [1,131–1,153] | 107 [106–108] | 40 [37–40] | 2,206 [2,198–2,210] |

| `one`, 5 kHz | Renderer | Messaging in the browser | Isoloop messaging JS | Port messages/s |
| --- | --- | --- | --- | --- |
| native | 946 [941–1,015] | 6 | 0 | 32 |
| stock | 1,127 [1,103–1,133] | 102 [101–104] | 34 [32–38] | 2,904 [2,898–2,908] |
| commits, 100 ms | 1,123 [1,092–1,164] | 94 [93–96] | 32 [29–33] | 2,319 [2,300–2,336] |
| commits, 250 ms | 1,088 [1,084–1,107] | 92 [89–93] | 30 [29–31] | 2,132 [2,126–2,144] |

At 1 kHz the pattern is the same:

| | Port messages/s: stock → 100 ms → 250 ms | Messaging in the browser | Renderer |
| --- | --- | --- | --- |
| `matched` | 1,890 → 1,594 → 1,443 | 89 → 87 → 86, within the spread | 923 → 945 → 918, within the spread |
| `one` | 1,818 → 1,545 → 1,398 | 80 → 73 → 76 | 884 → 906 → 880, within the spread |

The GPU process doesn't change: 340 → 335 → 334 for `matched` at 5 kHz.

**What it means:**
- **The message count fell more than ADR 0016 estimated.** About −600 port messages a second at 5 kHz, where the ADR estimated −160 commits. The early sends at half the credit rarely fire at these rates, and many ports commit far less often than once per record.
- **The CPU saved is about a third of an average message's cost.** Stock `matched` pays 121 + 44 ms/s across 3,007 messages a second, or about 0.055 ms each. At that average rate the cut would be worth ~33 ms/s; the measured saving is ~10. A commit is small, has no fan-out, and the broker's handling of it is short. Deliveries and publishes carry the rest.
- **100 against 250 ms:** 250 ms saves another ~200 messages and ~5 ms/s of messaging at 5 kHz, beyond the spread for the browser's messaging. The cost is a redelivery window after a crash that is 2.5 times longer. The renderer totals of the two overlap.
- **Against the rule** (keeps every feature, saves beyond the round spread):
  - **Pass:** the messaging buckets.
  - **Within the spread:** the renderer total.
  - **Kept:** the features, with decision 1's stated cost.
- **For the rest of ADR 0016:** what's left is mostly deliveries and publishes, as decisions 2 and 3 and the deferred C target. Their estimates should be scaled by what a delivery costs, not by the average message, so they should be measured the same way before more is assumed.

## Caveats

- **Software rendering.** The container has no GPU, so canvases and tiles are rasterized on the CPU in every build. With a GPU, the canvas rows would shrink in both builds and messaging would be a larger share of a smaller gap.
- **Wall-time samples.** The JS split uses V8 samples, which measure wall time. On a thread that is waiting for a core, wall time overstates its CPU. The split is scaled to each thread's CPU, but the shares within a thread assume its JS and its native work are delayed alike. The canvas and style/paint offsets may partly come from this.
- **Tracing overhead.** Traced windows use more CPU than untraced ones: +40 to +50 ms/s per small worker with the profiler on. The events trace and the profile trace are separate windows, and every figure is scaled to the untraced window. The overhead still shapes which events are recorded.
- **Chromium only, at a fixed 2.0 GHz.** Firefox has no per-thread attribution here. A faster clock shrinks every row, not necessarily in proportion.
