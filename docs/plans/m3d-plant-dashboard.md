# M3d: Plant dashboard

**Status:** planned 2026-11-08; starts after [M2d](m2d-visual-pools.md). Fourth epic of the [M3 initiative](m3-adapters-dashboard.md), and the heavy-workload study [M3c](m3c-dashboard-sizes.md) left as an open question.

**Goal:** a second, larger example: a telemetry dashboard for a fictional plant of eight machines, 72 widgets, with sensor data heavy enough to matter. It's built four ways, including a native build that uses hand-written workers, and measured on desktop and on a mid-range phone, so readers can see what Isoloop and its pools cost and give under a realistic heavy workload, against a fair native baseline.

**Why:** M3c showed no responsiveness difference outside the fault case, because its workloads never filled native's main thread. A dashboard with many machines and high-rate sensors does real heavy work (spectra, percentiles, correlations). Measuring it answers whether Isoloop's design shows a difference under that load, whichever way the numbers go.

**Done when:** `apps/dashboards/plant` runs on all its builds and placements at `/dashboards/plant/`; the comparison across builds, placements, browsers and the phone is recorded, along with a guide on when to pool with whatever results it gives; and it ships as `plant-v0.1.0`, tagged by the user or on the user's word.

**Depends on:** [M2c](m2c-worker-pools.md) (headless pools for the feeds and engines), [M2d](m2d-visual-pools.md) (visual and mixed pools for the widgets) and [M2b](m2b-durable-log.md) (persistent alarms and events). [M4](m4-devtools-release.md) waits for this epic.

## Decisions (grilling, 2026-11-08)

1. **Fictional and neutral.** "Plant 1", machines T1–T8. No vendor or manufacturer names, no real equipment models, generic units and limits.
2. **72 widgets.** 8 machines × 8 widgets, plus 8 fleet widgets.
   - **Per machine:** vibration spectrum (FFT, canvas), vibration waveform (canvas), temperature trends (canvas), gauges for speed, power and pressure (SVG/DOM), health score (aggregated), active alarms (DOM list), a filterable event log (DOM table), a sensor table with min, max and percentiles (DOM).
   - **Fleet:** status grid, total power, anomaly ranking, cross-machine correlation heatmap, combined alarm feed, fleet trend, hottest bearings, load distribution.
   Widgets are tagged with M3c's categories (raw, filtered, aggregated, combined × canvas, DOM).
3. **Synthetic, plausible, seeded data.** Per machine: vibration at about 1 kHz; bearing and exhaust temperatures, pressure, speed and power at 1–10 Hz; faults injected on a schedule (bearing wear, overheating, trips). Same seed, same data, in every build. The generators are headless feed isolates ([M2c](m2c-worker-pools.md)).
4. **Data format: chunks, not samples.**
   - **Fast signals** (vibration): one record per machine per 50 ms, `{ machine, sensor, t0, dtMs, values: Float32Array }`. The codec ([ADR 0014](../adr/0014-own-codec.md)) encodes typed arrays as raw bytes.
   - **Slow signals** (temperatures, pressure, speed, power): one row per machine every 100–250 ms with all slow sensors in it.
   - That's about 200 records a second in total instead of more than 8,000. The native builds get identical chunks, so every build does the same work per record.
5. **Topics.**
   - `plant.<M>.vib` and `plant.<M>.scalars`: memory topics that retain the last N seconds, so a restarted isolate catches up.
   - `plant.<M>.spectrum` and `plant.<M>.health`: derived by the machine's data pool; the FFT runs on a sliding 1024-sample window.
   - `plant.alarms` and `plant.events`: persistent topics in OPFS ([M2b](m2b-durable-log.md)).
6. **Placement is a switch:** `?placement=split|machine|shared-engines|own`. Same code and data; only the host manifest changes.
   - **`split` (default):** per machine, a visual pool (its 8 widgets) and a data pool (its feed plus the FFT, stats and health engines); a fleet visual pool; the fleet engine (correlations, anomaly ranking, aggregates) on its own worker. About 18 workers.
   - **`machine`:** data and widgets of a machine in one pool each (mixed pools, [M2d](m2d-visual-pools.md)).
   - **`shared-engines`:** one engine pool for all machines.
   - **`own`:** every isolate on its own worker, about 90.
   Block and crash behave the same in every placement, so each placement's blast radius is visible.
7. **Four React builds.**
   - **native:** everything on the main thread.
   - **native + workers:** the heavy computation (FFT, percentiles, correlation) in hand-written workers, rendering on the main thread. This is the fair native baseline a careful team would build.
   - **Isoloop, one worker per isolate:** `?placement=own`, about 90 workers, over the soft budget of 32; the budget warning is shown, not hidden.
   - **Isoloop, pooled:** placed by decision 6 (`split` by default).
   Preact and mixed builds aren't repeated; M3b and M3c covered them.
8. **Headers say where each widget runs:** `pool T3`, `pool fleet`, `worker 41` or `main thread`, with visible updates per second (M3c's definition).
9. **The block button shows the trade-off.** Pooled: everything in the blocked widget's pool stalls, then the pool restarts (in `machine` placement that includes the machine's feed and engines). `own`: only that widget stalls. Native and native + workers: the whole page stalls.
10. **Hypothesis, stated so it can fail.** Under this load, on a mid-range phone and on a 4-core desktop, the native build drops frames and typing slows past 100 ms, while both Isoloop builds stay closer to 60 fps and under 100 ms; against native + workers the difference is smaller, and may be none. It's falsified if native's main thread keeps headroom (no dropped frames, typing under 100 ms) or if Isoloop's builds do no better than native + workers. Results are reported as measured; the work is never made heavier to change the outcome (M3c decision 1).
11. **What's measured:** typing latency, frames, main-thread CPU and total CPU across threads, memory, worker count, startup and time to first data, time per category, visible updates per second, and data gaps after a fault. Each placement (decision 6) is measured. On desktop Chromium, Firefox and WebKit, and on a mid-range phone. WebKit's worker-canvas cost is referenced from [engine constraints](../investigations/engine-constraints.md).
12. **CI checks Isoloop, not native** (M3c decision 11): Isoloop's input budget asserted (200 ms × `PERF_BUDGET_SCALE`), ratios reported, WebKit handled as in M3c (report-only where it varies). Full-scope runs are sharded as in the markets app.
13. **Where it lives:** `apps/dashboards/plant` in `isoloop/examples`, URL `/dashboards/plant/`, listed on the `/dashboards/` index, tags `plant-v*`.

## Tasks

All in `isoloop/examples`, `apps/dashboards/plant`, unless a task says otherwise.

### 1. App skeleton and builds
- The app, its four builds by Vite alias (as markets does), the `/dashboards/` index entry, CI app detection and deploy path.
- **Tests (E2E):** each build loads and shows the header and the build switch.

### 2. Sensor generator and topics
- `src/core/sensors/`: seeded, plausible signals per machine and the fault schedule, emitted as decision 4's chunks and rows on decision 5's topics; feed isolates on Isoloop, main-thread or worker services on the native builds.
- **Tests (unit):** same seed, same chunks; injected faults appear at their scheduled times; about 200 records a second in total; `Float32Array` values round-trip through the codec as raw bytes.

### 3. Analysis core
- `src/core/analysis/`: FFT over vibration windows, rolling min, max and percentiles, health score, anomaly scores, cross-machine correlation. One implementation used by every build.
- **Tests (unit):** known values (a pure tone's spectrum peak, percentiles of a fixed series, a known correlation matrix).

### 4. Machine canvas widgets
- Spectrum, waveform, temperature trends.
- **Tests (E2E):** each draws on every build; parity between builds on the same seed.

### 5. Machine DOM widgets
- Gauges, health score, active alarms, event log with filter, sensor table.
- **Tests (E2E):** parity between builds; the filter works on every build.

### 6. Fleet widgets
- The 8 fleet widgets of decision 2.
- **Tests (E2E):** parity between builds.

### 7. Placements and headers
- The four placements of decision 6 as host manifests behind `?placement=`; headers per decision 8; the block, crash and flood buttons per decision 9.
- **Tests (E2E):** in each placement, blocking a widget stalls exactly its pool's isolates (or only itself in `own`) and not another machine's; the pool restarts and catches up from the retained topics; `plant.alarms` and `plant.events` keep every acknowledged record across the restart.

### 8. Native + workers build
- The heavy computation moved into hand-written workers, written the way a careful team would, without Isoloop.
- **Tests (E2E):** parity with the native build.

### 9. Responsiveness and metrics on the page
- The ticker tape, echo box and badge, the metrics and category panels, reused from markets where they fit.
- **Tests (E2E):** values show on every build; no layout shift while the page fills (markets #40).

### 10. Budget checks
- Isoloop's input budget asserted on both Isoloop builds (decision 12); medians and ratios in the test report.

### 11. The comparison
- `scripts/compare.ts` and the workflow: the native builds and each Isoloop placement × 3 engines, with the M3c columns plus worker count, startup and data gaps after a fault. A manual run on a mid-range phone, recorded with its model and browser.
- **Acceptance:** results kept as artifacts with the hypothesis (decision 10) checked against them.

### 12. When to pool, and when not to
- A guide written from task 11's measurements: what each placement cost and contained, and when pooling helps or doesn't. It feeds the M4 docs site.

### 13. Ship
- README and write-up with the results as measured; plans index updated. Released as `plant-v0.1.0`, tagged by the user or on the user's word.

## Open risks

- **The hypothesis may not hold**, especially against native + workers. Decision 8 applies.
- **72 widgets on a 4-core CI runner** is heavy; full-scope E2E is sharded, and absolute comparisons come from the recorded runs.
- **Memory** with about 90 workers in the `own` placement; recorded as a cost.
- **WebKit** canvas presentation ([engine constraints](../investigations/engine-constraints.md)) will weigh on 24 canvas widgets.
- **The phone run** is manual and depends on a device being available.
