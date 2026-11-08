# M3d: Plant dashboard

**Status:** planned 2026-11-08; starts after [M2d](m2d-visual-pools.md). Fourth epic of the [M3 initiative](m3-adapters-dashboard.md), and the heavy-workload study [M3c](m3c-dashboard-sizes.md) left as an open question.

**Goal:** a second, larger example: a telemetry dashboard for a fictional plant of eight machines, 72 widgets, with sensor data heavy enough to matter. It's built four ways, including a native build that uses hand-written workers, and measured on desktop and on a mid-range phone, so readers can see what Isoloop and its pools cost and give under a realistic heavy workload, against a fair native baseline.

**Why:** M3c showed no responsiveness difference outside the fault case, because its workloads never filled native's main thread. A dashboard with many machines and high-rate sensors does real heavy work (spectra, percentiles, correlations). Measuring it answers whether Isoloop's design shows a difference under that load, whichever way the numbers go.

**Done when:** `apps/dashboards/plant` runs on all four builds at `/dashboards/plant/`; the comparison across builds, browsers and the phone is recorded with whatever results it gives; and it ships as `plant-v0.1.0`, tagged by the user or on the user's word.

**Depends on:** [M2c](m2c-worker-pools.md) (headless pools for the feeds) and [M2d](m2d-visual-pools.md) (visual pools for the widgets). [M4](m4-devtools-release.md) waits for this epic.

## Decisions (grilling, 2026-11-08)

1. **Fictional and neutral.** "Plant 1", machines T1–T8. No vendor or manufacturer names, no real equipment models, generic units and limits.
2. **72 widgets.** 8 machines × 8 widgets, plus 8 fleet widgets.
   - **Per machine:** vibration spectrum (FFT, canvas), vibration waveform (canvas), temperature trends (canvas), gauges for speed, power and pressure (SVG/DOM), health score (aggregated), active alarms (DOM list), a filterable event log (DOM table), a sensor table with min, max and percentiles (DOM).
   - **Fleet:** status grid, total power, anomaly ranking, cross-machine correlation heatmap, combined alarm feed, fleet trend, hottest bearings, load distribution.
   Widgets are tagged with M3c's categories (raw, filtered, aggregated, combined × canvas, DOM).
3. **Synthetic, plausible, seeded data.** Per machine: vibration at about 1 kHz; bearing and exhaust temperatures, pressure, speed and power at 1–10 Hz; faults injected on a schedule (bearing wear, overheating, trips). Same seed, same data, in every build. The generators are headless feed isolates, pooled per machine ([M2c](m2c-worker-pools.md)).
4. **Pools by machine.** One visual pool per machine (8 widgets) and one for the fleet widgets: 9 visual pools ([M2d](m2d-visual-pools.md)).
5. **Four React builds.**
   - **native:** everything on the main thread.
   - **native + workers:** the heavy computation (FFT, percentiles, correlation) in hand-written workers, rendering on the main thread. This is the fair native baseline a careful team would build.
   - **Isoloop, one worker per widget:** about 72 widget workers, over the soft budget of 32; the budget warning is shown, not hidden.
   - **Isoloop, pooled:** 9 visual pools plus the pooled feeds.
   Preact and mixed builds aren't repeated; M3b and M3c covered them.
6. **Headers say where each widget runs:** `pool T3`, `pool fleet`, `worker 41` or `main thread`, with visible updates per second (M3c's definition).
7. **The block button shows the trade-off.** Pooled: the machine's whole panel stalls, then its pool restarts. One worker per widget: only that widget stalls. Native and native + workers: the whole page stalls.
8. **Hypothesis, stated so it can fail.** Under this load, on a mid-range phone and on a 4-core desktop, the native build drops frames and typing slows past 100 ms, while both Isoloop builds stay closer to 60 fps and under 100 ms; against native + workers the difference is smaller, and may be none. It's falsified if native's main thread keeps headroom (no dropped frames, typing under 100 ms) or if Isoloop's builds do no better than native + workers. Results are reported as measured; the work is never made heavier to change the outcome (M3c decision 1).
9. **What's measured:** typing latency, frames, main-thread CPU and total CPU across threads, memory, worker count, startup and time to first data, time per category, visible updates per second. On desktop Chromium, Firefox and WebKit, and on a mid-range phone. WebKit's worker-canvas cost is referenced from [engine constraints](../investigations/engine-constraints.md).
10. **CI checks Isoloop, not native** (M3c decision 11): Isoloop's input budget asserted (200 ms × `PERF_BUDGET_SCALE`), ratios reported, WebKit handled as in M3c (report-only where it varies). Full-scope runs are sharded as in the markets app.
11. **Where it lives:** `apps/dashboards/plant` in `isoloop/examples`, URL `/dashboards/plant/`, listed on the `/dashboards/` index, tags `plant-v*`.

## Tasks

All in `isoloop/examples`, `apps/dashboards/plant`, unless a task says otherwise.

### 1. App skeleton and builds
- The app, its four builds by Vite alias (as markets does), the `/dashboards/` index entry, CI app detection and deploy path.
- **Tests (E2E):** each build loads and shows the header and the build switch.

### 2. Sensor generator
- `src/core/sensors/`: seeded, plausible signals per machine and the fault schedule; feed isolates pooled per machine on Isoloop, main-thread or worker services on the native builds.
- **Tests (unit):** same seed, same records; injected faults appear at their scheduled times; rates match decision 3.

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

### 7. Pools and headers
- The pooled build's manifest (decision 4); headers per decision 6; the block, crash and flood buttons per decision 7.
- **Tests (E2E):** blocking a pooled widget stalls its pool's widgets and not another machine's; the pool restarts; on one-worker-per-widget only the blocked widget stalls.

### 8. Native + workers build
- The heavy computation moved into hand-written workers, written the way a careful team would, without Isoloop.
- **Tests (E2E):** parity with the native build.

### 9. Responsiveness and metrics on the page
- The ticker tape, echo box and badge, the metrics and category panels, reused from markets where they fit.
- **Tests (E2E):** values show on every build; no layout shift while the page fills (markets #40).

### 10. Budget checks
- Isoloop's input budget asserted on both Isoloop builds (decision 10); medians and ratios in the test report.

### 11. The comparison
- `scripts/compare.ts` and the workflow: 4 builds × 3 engines, with the M3c columns plus worker count and startup. A manual run on a mid-range phone, recorded with its model and browser.
- **Acceptance:** results kept as artifacts with the hypothesis (decision 8) checked against them.

### 12. Ship
- README and write-up with the results as measured; plans index updated. Released as `plant-v0.1.0`, tagged by the user or on the user's word.

## Open risks

- **The hypothesis may not hold**, especially against native + workers. Decision 8 applies.
- **72 widgets on a 4-core CI runner** is heavy; full-scope E2E is sharded, and absolute comparisons come from the recorded runs.
- **Memory** with 72 widget workers in the one-worker-per-widget build; recorded as a cost.
- **WebKit** canvas presentation ([engine constraints](../investigations/engine-constraints.md)) will weigh on 24 canvas widgets.
- **The phone run** is manual and depends on a device being available.
