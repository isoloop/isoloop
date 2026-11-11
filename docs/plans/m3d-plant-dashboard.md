# M3d: Plant dashboard

**Status:** in progress. Planned 2026-11-08; tasks 1–11 built 2026-11-09 and 2026-11-10; decisions 6, 7, 10 and 11 revised 2026-11-11 after the first results. Fourth epic of the [M3 initiative](m3-adapters-dashboard.md), and the heavy-workload study [M3c](m3c-dashboard-sizes.md) left as an open question.

**Goal:** a second, larger example: a telemetry dashboard for a fictional plant of eight machines, 72 widgets, with sensor data heavy enough to matter. It's built three ways, including a native build that uses hand-written workers, and the Isoloop build can place its isolates several ways. It's measured so readers can see what Isoloop costs against matched native builds under a realistic heavy workload, and what they get for that cost.

**Why:** M3c showed no responsiveness difference outside the fault case, because its workloads never filled native's main thread. A dashboard with many machines and high-rate sensors does real heavy work (spectra, percentiles, correlations). Isoloop adds threads, a bus and a kernel to what a native build runs, so it always costs more CPU and memory than a native build doing the same work. The question isn't whether it's faster; it's what the whole package costs and what it gives: containment, restart and catch-up, a broker with retention, replay and durable history, budgets and reports, and one placement model.

**Done when:** `apps/dashboards/plant` runs on all its builds and placements at `/dashboards/plant/`; the cost and behaviour of each build is recorded against its matched native build (decisions 10 and 11), along with a guide on when to pool; and it ships as `plant-v0.1.0`, tagged by the user or on the user's word.

**Depends on:** [M2c](m2c-worker-pools.md) (headless pools for the feeds and engines), [M2d](m2d-visual-pools.md) (visual and mixed pools for the widgets) and [M2b](m2b-durable-log.md) (persistent alarms and events). [M4](m4-devtools-release.md) waits for this epic.

## Decisions (grilling, 2026-11-08; 6, 7, 10 and 11 revised 2026-11-11)

1. **Fictional and neutral.** "Plant 1", machines T1–T8. No vendor or manufacturer names, no real equipment models, generic units and limits.
2. **72 widgets, fixed.** 8 machines × 8 widgets, plus 8 fleet widgets. There are no Lite/Normal/Heavy sizes; the load knob is the vibration sampling rate, `?rate=1|2|5` (kHz, default 1).
   - **Per machine:** vibration spectrum (FFT, canvas), vibration waveform (canvas), temperature trends (canvas), gauges for speed, power and pressure (SVG/DOM), health score (aggregated), active alarms (DOM list), a filterable event log (DOM table), a sensor table with min, max and percentiles (DOM).
   - **Fleet:** status grid, total power, anomaly ranking, cross-machine correlation heatmap, combined alarm feed, fleet trend, hottest bearings, load distribution.
   Widgets are tagged with M3c's categories (raw, filtered, aggregated, combined × canvas, DOM).
3. **Synthetic, plausible, seeded data.** Per machine: vibration at 1 kHz by default (decision 2's `?rate=`); bearing and exhaust temperatures, pressure, speed and power at 1–10 Hz; faults injected on a schedule (bearing wear, overheating, trips). Same seed, same data, in every build. The generators are headless feed isolates ([M2c](m2c-worker-pools.md)).
4. **Data format: chunks, not samples.**
   - **Fast signals** (vibration): one record per machine per 50 ms at any rate, `{ machine, sensor, t0, dtMs, values: Float32Array }` (50 samples at 1 kHz, 250 at 5 kHz). The codec ([ADR 0014](../adr/0014-own-codec.md)) encodes typed arrays as raw bytes.
   - **The waveform scrolls continuously,** every frame, drawn about 50 ms behind real time so the next chunk has always arrived.
   - **Slow signals** (temperatures, pressure, speed, power): one row per machine every 100–250 ms with all slow sensors in it.
   - That's about 200 records a second in total instead of more than 8,000. The native builds get identical chunks, so every build does the same work per record.
5. **Topics.**
   - `plant.<M>.vib` and `plant.<M>.scalars`: memory topics, so a restarted isolate catches up. Retention: the last 30 s of raw vibration (about 1 MB plant-wide at 1 kHz) and 5 min of slow signals.
   - `plant.<M>.spectrum` and `plant.<M>.health`: derived by the machine's data pool. The FFT uses a 1024-sample Hann window with a hop of 256 (75% overlap): about 4 spectra a second per machine at 1 kHz, scaling with the rate.
   - `plant.alarms` and `plant.events`: persistent topics in OPFS ([M2b](m2b-durable-log.md)), capped at 10,000 records each (oldest dropped), with a "clear history" button. Where OPFS isn't available, they fall back to memory topics and the page says so.
   - **The fleet engine subscribes only to derived topics** (`spectrum`, `health`, `scalars`), never to raw vibration.
6. **Placement is a switch:** `?placement=split|machine|shared-engines|own|matched|one`. Same code and data; only the host manifest changes.
   - **`split` (default):** per machine, a visual pool (its 8 widgets) and a data pool (its feed plus the FFT, stats and health engines); a fleet visual pool; the fleet engine (correlations, anomaly ranking, aggregates) on its own worker. 18 workers plus the bus worker.
   - **`machine`:** data and widgets of a machine in one pool each (mixed pools, [M2d](m2d-visual-pools.md)). 10 workers plus the bus.
   - **`shared-engines`:** a machine's widgets in its own visual pool; every feed in one `feeds` pool and every engine in one `engines` pool. 12 workers plus the bus.
   - **`own`:** every isolate on its own worker, 105 plus the bus, over the soft budget of 32. It stays available with a warning on the page.
   - **`matched` (added 2026-11-10):** native + workers' data layout, one data pool per machine and the fleet engine on its own worker, plus **one** visual pool for all 72 widgets. 10 workers plus the bus, against native + workers' 9. Isoloop can't render on the main thread, so one widget thread is the fewest it can add.
   - **`one` (added 2026-11-10):** every feed, engine and widget in a single pool. 1 worker plus the bus, against native's main thread alone.
   The page's worker count leaves the bus worker out in every placement; the results say "N + bus" where it matters. Block and crash behave the same in every placement, so each placement's blast radius is visible.
7. **Three React builds, compared in matched pairs.**
   - **native:** everything on the main thread.
   - **native + workers:** one data worker per machine (its feed and engines, plain `postMessage`) and one fleet worker; widgets on the main thread. This is the fair native baseline a careful team would build.
   - **Isoloop:** placed by decision 6's `?placement=`.
   - **The pairs (revised 2026-11-10):** native against Isoloop `one`, and native + workers against Isoloop `matched`, each with about the same number of threads. `split` is measured alongside for reference. Each pair runs interleaved (A, B, A, B…), so drift on the machine hits both sides of a gap alike.
   Preact and mixed builds aren't repeated; M3b and M3c covered them.
8. **Headers say where each widget runs:** `pool T3`, `pool fleet`, `worker 41` or `main thread`, with visible updates per second (M3c's definition).
9. **The block button shows the trade-off.** Pooled: everything in the blocked widget's pool stalls, then the pool restarts (in `machine` placement that includes the machine's feed and engines; in `one`, everything). `own`: only that widget stalls. Native and native + workers: the whole page stalls (a widget's code runs on the main thread in both).
10. **Two questions, not a speed hypothesis (revised 2026-11-11).** The first plan stated a hypothesis that native would drop frames under this load while Isoloop stayed near 60 fps. Isoloop isn't pitched as faster than native, so the comparison now answers:
    - **What the package costs** against its matched native build: CPU across threads, memory after GC (and as read, with the difference explained), typing latency, start-up and time to first data, and worker count.
    - **What it gives,** as a per-build behaviour table: what a blocked or crashed widget takes down (by placement), the data gap and recovery time, restart and catch-up from retained topics, persistent alarms and events across restarts, budgets and reports.
    Results are reported as measured; the work is never made heavier or lighter to change the outcome (M3c decision 1). Where Isoloop happens to keep the main thread freer, that's reported as a measured behaviour, not as the point of the product.
11. **How it's measured (revised 2026-11-10).**
    - **A dedicated machine,** not a development machine running other work: a home server (AMD Ryzen 7 5825U, 30 GB, Ubuntu 24.04) with its other containers paused and every core fixed at 2.0 GHz (governor `performance`, no boost). Runs use Playwright's official Docker image, pinned to 4 physical cores, one thread each (`--cpuset-cpus=2,4,6,8`).
    - **Interleaved pairs** (decision 7), at least 3 rounds; the gap is taken per round and reported as a median with its spread. A change counts only where it falls outside that spread.
    - **Memory** is renderer PSS from `/proc`, read as is and again after a forced GC on every thread, at about 16 s and after a 10-minute hold.
    - **CPU per thread:** a probe takes a CPU profile and a trace on the page and every worker, and splits each thread's time into buckets (browser messaging, Isoloop's messaging code, canvas, style and layout, GC, the app's own work…). Library changes that target CPU are judged with it, because the comparison's total CPU is too coarse to show changes of a few percentage points.
    - **Engines:** Chromium and Firefox on the server; WebKit in CI only, where the Playwright WebKit canvas limit applies ([engine constraint 2](../investigations/engine-constraints.md)). Safari on an iPad doesn't show that limit.
    - **Columns:** worker count, late frames, typing, main-thread CPU, CPU across threads, memory (as read and after GC, at 16 s and 10 min), time to first data, all 72 widgets with data, recovery after a 3 s block, and the data gap per machine.
12. **CI checks Isoloop, not native** (M3c decision 11): Isoloop's input budget asserted (200 ms × `PERF_BUDGET_SCALE`), ratios reported, WebKit handled as in M3c (report-only where it varies). Full-scope runs are sharded as in the markets app. The recorded comparisons come from the dedicated machine (decision 11), not from CI runners.
13. **Where it lives:** `apps/dashboards/plant` in `isoloop/examples`, URL `/dashboards/plant/`, listed on the `/dashboards/` index, tags `plant-v*`.

## Findings so far

In isoloop/examples, `apps/dashboards/plant/comparison/` [`matched/`](https://github.com/isoloop/examples/tree/main/apps/dashboards/plant/comparison/matched) (with the bus retention fix) and [`matched-q6/`](https://github.com/isoloop/examples/tree/main/apps/dashboards/plant/comparison/matched-q6) (after the app's own timings stopped going over the bus). Chromium, 4 cores at 2.0 GHz, medians of 5 rounds (3 for the 10-minute rows), figures from `matched-q6/` unless noted.

**What it costs**, Isoloop minus its matched native build:

| | native → `one` | native + workers → `matched` |
| --- | --- | --- |
| Threads | main → main + 1 + bus | main + 9 → main + 10 + bus |
| CPU across threads, 1 kHz / 5 kHz | +11 / +16 pp | +13 / +22 pp |
| Memory after GC, 16 s | +36 MB | +47 MB |
| Memory after GC, 10 min | +39 MB | +21 MB |
| Memory as read, 10 min | +106 MB | +202 MB |
| First data | +159 ms | +242 ms |

**What the main thread does,** Isoloop against its matched native build:

| | native → `one` | native + workers → `matched` |
| --- | --- | --- |
| Main-thread CPU, 5 kHz | −59 pp (23% against 82%) | −51 pp (27% against 78%) |
| Typing, Chromium 5 kHz | −52 ms | −41 ms |
| Late frames, Firefox 5 kHz | −123 | −86 |

At 1 kHz in Chromium every build types within noise of the others; the main-thread differences show under the heavier loads on this fixed-clock machine. An earlier unfixed run on a faster desktop CPU kept 60 fps in every build at every rate.

**What a 3 s block takes down** (from `matched/`): native and native + workers stall the whole page; native loses 3.8 s of data on every machine, native + workers none. `one` stalls everything and loses 3.3 s of data on every machine. `matched` stalls the widgets' pool and loses no data. `split` loses no data. Recovery is 2.9–3.7 s in every build, Chromium and Firefox.

**Where the cost goes:**
- **Memory** ([isoloop#162](https://github.com/isoloop/isoloop/pull/162)): after GC, each visual pool's own copy of the framework, runtime, document and plant code (about 7.7 MB per plant pool), and the bus worker. As read, mostly garbage not yet collected, which follows how much is allocated per record. A bus retention bug kept expired records for up to 17 minutes; it's fixed ([isoloop#163](https://github.com/isoloop/isoloop/pull/163)), and Isoloop's memory no longer grows faster than native's over 10 minutes.
- **CPU** ([isoloop#165](https://github.com/isoloop/isoloop/pull/165)): most of the gap is moving records between threads, a fixed cost per `MessagePort` message (+101 ms/s in the browser and +45 ms/s in Isoloop's own messaging code, of a +180 ms/s gap for `matched` at 5 kHz). The demo's own metrics sampler was another +23 ms/s; it now samples once a second (examples#61).
- **Fewer messages** ([ADR 0016](https://github.com/isoloop/isoloop/pull/164), proposed): combined commits cut port messages by 20% and the browser's messaging work by 8–14 ms/s, with the renderer total within the spread. Batching per port cut messages by 3–5% and moved no CPU figure beyond the spread. Every record still crosses threads at least twice (producer → bus → subscriber, [ADR 0005](../adr/0005-bus-topology-message-channels.md)), which is the remaining cost of having a broker.
- **WebKit** ([isoloop#161](https://github.com/isoloop/isoloop/pull/161)): Playwright's WebKit on Linux stops the Isoloop page when workers present many canvas frames. Safari 26.5 on an iPad held 60 fps at every load in the standalone repro, so the limit is Playwright's headless, software-rendered WebKit, not Safari.

**Open:**
- `one` recovers more slowly after the 10-minute hold (5.5 s, with a 5.6–5.9 s data gap) than early in a run (3.4–3.5 s). The other placements don't change. Not yet looked into.
- In `one` at 5 kHz the app's own feeds and engines take 96 ms/s of CPU, against 62 on native's main thread; in `matched` they're equal (57 and 57). Not yet explained (isoloop#165, "Not explained yet").
- The plant itself hasn't been recorded on an iPad or phone yet; it's deployed at `plant-v0.1.0-rc.2`, and each page has a "Record 10 s" panel.

## Tasks

All in `isoloop/examples`, `apps/dashboards/plant`, unless a task says otherwise. Tasks 1–10 are built (examples #42–#51).

### 1. App skeleton and builds
- The app, its three builds by Vite alias (as markets does), the `?rate=` and `?placement=` parameters, the `/dashboards/` index entry, CI app detection and deploy path.
- **Tests (E2E):** each build loads and shows the header and the build switch.

### 2. Sensor generator and topics
- `src/core/sensors/`: seeded, plausible signals per machine and the fault schedule, emitted as decision 4's chunks and rows on decision 5's topics; feed isolates on Isoloop, main-thread or worker services on the native builds.
- **Tests (unit):** same seed, same chunks; injected faults appear at their scheduled times; about 200 records a second in total; `Float32Array` values round-trip through the codec as raw bytes.

### 3. Analysis core
- `src/core/analysis/`: FFT (decision 5's window and hop), rolling min, max and percentiles, health score, anomaly scores, cross-machine correlation. One implementation used by every build.
- **Tests (unit):** known values (a pure tone's spectrum peak, percentiles of a fixed series, a known correlation matrix).

### 4. Machine canvas widgets
- Spectrum, waveform (continuous scroll, decision 4), temperature trends.
- **Tests (E2E):** each draws on every build; parity between builds on the same seed.

### 5. Machine DOM widgets
- Gauges, health score, active alarms, event log with filter, sensor table.
- **Tests (E2E):** parity between builds; the filter works on every build.

### 6. Fleet widgets
- The 8 fleet widgets of decision 2.
- **Tests (E2E):** parity between builds.

### 7. Placements and headers
- The placements of decision 6 as host manifests behind `?placement=`; headers per decision 8; the block, crash and flood buttons per decision 9.
- **Tests (E2E):** in each placement, blocking a widget stalls exactly its pool's isolates (or only itself in `own`) and not another machine's; the pool restarts and catches up from the retained topics; `plant.alarms` and `plant.events` keep every acknowledged record across the restart, stay within 10,000, and clear on "clear history"; without OPFS the memory fallback and its notice appear; `own` shows its warning.

### 8. Native + workers build
- One data worker per machine and one fleet worker (decision 7), with plain `postMessage`, written the way a careful team would, without Isoloop.
- **Tests (E2E):** parity with the native build.

### 9. Responsiveness and metrics on the page
- The ticker tape, echo box and badge, the metrics and category panels, reused from markets where they fit.
- **Tests (E2E):** values show on every build; no layout shift while the page fills (markets #40).

### 10. Budget checks
- Isoloop's input budget asserted in the default placement at each rate (decision 12); medians and ratios in the test report.

### 11. The comparison
- **Built:** `comparison/run.ts` (`compare:pairs`) runs decision 7's pairs interleaved, in Playwright's Docker image ([`comparison/Dockerfile`](https://github.com/isoloop/examples/tree/main/apps/dashboards/plant/comparison)), and writes each run's JSON and a summary with per-round gaps and their spread. The CPU probe is in [`docs/investigations/assets/plant-cpu/`](../investigations/assets/plant-cpu/) (isoloop#165).
- **Recorded:** `matched/` and `matched-q6/` (above).
- **Remaining:**
  - Re-record `matched/` once the library changes in flight are released (the bus retention fix is in; ADR 0016 decision 1 waits for approval), so the shipped figures match the shipped libraries.
  - The behaviour table of decision 10, from the E2E fault tests and the comparison's fault columns.
  - The plant on an iPad or phone, recorded with its model and browser.
- **Acceptance:** results kept with decision 10's two questions answered against them.

### 12. When to pool, and when not to
- `docs/guide/pools.md` in the main repo, written from task 11's measurements: a table of pool / don't pool / why, each row backed by a plant figure, and what each placement cost and contained. The demo's About panel links it. It feeds the M4 docs site.

### 13. Ship
- README and write-up led by what the package gives (decision 10's behaviour table), with its cost against the matched native builds stated plainly. Plans index updated. Released as `plant-v0.1.0`, tagged by the user or on the user's word.

## Open risks

- **Results depend on the machine.** The fixed 2.0 GHz clock shrinks every build's headroom; a faster desktop shows smaller main-thread differences. The write-up says which machine each figure comes from.
- **72 widgets on a 4-core CI runner** is heavy; full-scope E2E is sharded, and recorded comparisons come from the dedicated machine.
- **Memory** with about 105 workers in the `own` placement; recorded as a cost. On a phone it may not run at all (decision 6).
- **WebKit** in Playwright stops the Isoloop page under many canvas presents ([engine constraint 2](../investigations/engine-constraints.md)); Safari on an iPad doesn't. CI keeps WebKit Isoloop page tests skipped or report-only.
- **The phone or iPad run** of the plant is manual and depends on a device being available.
- **Follow-up: [M3e](README.md), the live widget creator,** builds on this dashboard: M3d's topics and its generic widgets (charts, tables, gauges) should stay reusable by user-composed widgets, so keep them free of plant-specific assumptions where it costs nothing.
