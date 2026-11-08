# M3c: Dashboard sizes

**Status:** done 2026-11-08; ships as `markets-v0.2.0` when the user tags it. Third epic of the [M3 initiative](m3-adapters-dashboard.md), added 2026-11-07 after the first public deploy (`markets-v0.1.0`).

**Results** ([recorded comparison](https://github.com/isoloop/examples/tree/main/apps/markets/comparison), Chromium on a 4-core CI runner, and [engine constraints](../investigations/engine-constraints.md) for WebKit):

- **Isolation:** with one widget blocked (a 3 s busy loop in a chart, M3b's scenario), typing on native waits about 2.8 s; on Isoloop it stays at 29–38 ms and the page keeps 60 fps. A crashed widget restarts on its own while the others keep drawing (E2E `stress.spec.ts`).
- **Costs, measured:** about 1.3–1.5× the CPU across all threads and 1.6–2.7× the memory (754 MB against 278 MB for the React pair at Heavy); about 20–30 ms more per keystroke at every size (Isoloop 27–37 ms, native 5–16 ms); about 60 KB more JavaScript, gzipped; about three times the time to first data. On Playwright's WebKit (Linux, no GPU) there's a further cost: WebKit presents worker-drawn canvases on the main thread, so Isoloop's typing on the CI runner is 170–642 ms at Normal and over budget or timed out at Heavy. The budget check reports WebKit at Normal without asserting it and marks Heavy as expected to fail. Not yet checked in Safari.
- **Main-thread headroom:** at Normal and Heavy, Isoloop's main thread is busy 17–21% of the time against native's 42–59%. On these workloads native never ran out of headroom: neither build dropped frames at any size, so no responsiveness difference appeared outside the fault case, and decision 2's hypothesis isn't borne out. Isoloop isn't faster than native here; it keeps more of the main thread free and contains faults, at the costs above.
- **Open question:** whether a realistic heavy workload, taken from real apps rather than inflated, shows a responsiveness difference. The fair native baseline there includes hand-written workers, not only a single-threaded app.
- **Deviations from the tasks:** Normal and Heavy E2E run at the replay's own rate, not 10×; the canvas E2E allows up to 30 s for the engines to fill; the DOM widgets E2E checks that each build fills them rather than parity; the panel shows thread time per category, with per-isolate figures in `timings.v1`; there is no throttled-CPU column (CDP throttling doesn't slow workers); a widget header with where it runs and its updates/s was added (task 9b).

**Goal:** grow the markets dashboard into a realistic, larger app with selectable sizes and more kinds of widgets, and measure the native and Isoloop builds at each size, so readers can see how each behaves as an app grows and which kinds of work account for the difference.

**Why:** the M3b dashboard is small: 6 widgets, 3 symbols, 2 trades a second per source. At that size native is faster when nothing is stressed (11 ms against 34 ms per keystroke), and the builds only differ under the stress buttons. That's a correct result for a small app, but it says little about the larger apps Isoloop is meant for. Measuring a larger app, with work it would really do, answers that, whichever way the numbers go.

**Done when:** the dashboard offers Lite, Normal and Heavy sizes on every build; every widget is tagged with its category; and the comparison across sizes is recorded, with the per-category breakdown, and kept with whatever results it gives.

**Depends on:** [M3b](m3b-dashboard.md). [M4](m4-devtools-release.md) waits for this epic.

## Decisions (grilling, 2026-11-07)

1. **Only work a real dashboard does.** Larger sizes add computations a markets dashboard plausibly runs: correlations, volatility, depth, scanners and charts redrawn on each tick. No busy loops or other work added only to load the page. The cases where native is faster stay in the results.
2. **Report what we measure.** The hypothesis is that, from Normal size up, the native page drops frames and input slows, while Isoloop keeps closer to 60 fps and under 100 ms on 4 or more cores. If the measurements don't bear that out with realistic work, the results are reported as they are, with the per-category breakdown, and the user decides what follows. The work is never made heavier to change the outcome.
3. **Three sizes:** `?size=lite|normal|heavy`, a switch in the page header that carries over when toggling builds.
   - **Lite:** today's 6 widgets and 3 symbols.
   - **Normal (default):** 16 widgets, 20 symbols.
   - **Heavy:** 24 or more widgets, 20 symbols, 5× the tick rate.
   Symbol count, tick rate and widget counts are also URL parameters, for tests only.
4. **Categories on two axes.** Every widget is tagged by **data**: raw (records as they arrive), filtered (a view over `filters.v1`), aggregated (rolling computations over one stream) or combined (joins several topics). It's also tagged by **output**: canvas or DOM. Each size is a count per category. What we expect to see: aggregated and combined work drawn on canvas moves off the main thread on Isoloop, while DOM widgets still cost main-thread time in both builds, because their DOM changes are applied there.
5. **20 synthesized symbols in replay.** Live mode keeps the exchanges' real symbols and rates; there the sizes choose only the widgets.
6. **Shared engines.** Derived data that several widgets use (rolling stats, correlations, the depth model) lives in `src/core`. On Isoloop it runs as headless engine isolates publishing result topics (for example `stats.v1`, `correlations.v1`, `depth.v1`); on native the same code runs as main-thread services. Widgets only subscribe.
7. **Responsiveness shown on the page, in every build:** a ticker tape scrolled by `requestAnimationFrame`, an input echo box, and a small fps and input-latency badge.
8. **Where the time goes:** the metrics panel shows main-thread milliseconds per second per category. On native, each widget's compute and render is wrapped in `performance.measure`. On Isoloop, it shows each surface's main-thread DOM apply time, and each isolate's own thread time separately.
9. **Limits, stated on the page.** Heavy stays at 32 isolates or fewer, ADR 0001's soft budget, and grows by work per isolate instead. The About panel says pooling ([M2c](m2c-worker-pools.md)) is how real apps go further. It also shows the visitor's `navigator.hardwareConcurrency` and notes below 4 cores that Isoloop has little room to move work.
10. **The comparison is a matrix:** 3 sizes × 4 builds (the React and Preact pairs), 12 rows, with the same columns as M3b's table, plus memory. The side-by-side video is the React pair at Normal. The results are kept as artifacts; where they're published (README, a post) is decided after the user has seen the demo.
11. **CI checks Isoloop, not native.** CI asserts Isoloop's own input budget (200 ms × `PERF_BUDGET_SCALE`) at every size it runs, as a regression check. The native-to-Isoloop ratios are reported, not asserted. Pull requests run Lite and Normal (every build on Chromium, the React pair on all three engines); `markets-v*` tags, the weekly run and the comparison add Heavy.
12. **Ships as `markets-v0.2.0`**, tagged by the user or on the user's word.

## Tasks

All in `isoloop/examples`, `apps/markets`, unless a task says otherwise.

### 1. Sizes and the widget registry
- A registry of widgets with their category tags (data × output), and the three sizes as counts per category. `?size=` plus the test-only parameters, the header switch, and the size carried over by the toggle (`src/url.ts`).
- **Tests:** unit tests for the URL round trip and per-size widget sets; (E2E) the switch reloads into the chosen size on every build.

### 2. Twenty symbols in replay
- The replay source synthesizes 20 symbols with realistic, correlated price paths and per-symbol tick rates; Heavy's 5× rate.
- **Tests (unit):** the same seed gives the same records; correlation between paired symbols is within the configured range.

### 3. Engine: rolling stats
- `src/core/engines/stats.ts`: VWAP, volatility and volume profile per symbol over rolling windows, published as `stats.v1`. Headless isolate on Isoloop, main-thread service on native.
- **Tests (unit, on the replay source):** known values for a fixed recording.

### 4. Engine: correlations
- Rolling correlation across 20 symbols at three horizons, published as `correlations.v1`.
- **Tests (unit):** a known matrix for a fixed recording; symmetric, ones on the diagonal.

### 5. Engine: depth model
- The order-book depth over time per symbol, from `book.v1`, published as `depth.v1`.
- **Tests (unit):** the depth snapshot matches the book after a known sequence.

### 6. Canvas widgets
- The sparkline grid (filtered), VWAP, volatility and volume-profile charts (aggregated), the correlation heatmap and the depth heatmap (combined). Drawing goes in `src/charts/`, as in M3b.
- **Tests (E2E):** each draws within 2 s on every build; parity between builds on the replay source.

### 7. DOM widgets
- Top movers and the arbitrage scanner (combined), the per-exchange tape (filtered) and the market summary strip (aggregated).
- **Tests (E2E):** parity between builds on the replay source.

### 8. Heavy additions
- Correlation at three horizons, depth heatmaps per symbol, a second sparkline grid, order-flow imbalance, all at 32 isolates or fewer.
- **Tests (E2E):** Heavy starts with no `budget` warning; the isolate count is at most 32.

### 9. Responsiveness on the page
- The ticker tape, the input echo box and the fps and latency badge, the same code in every build.
- **Tests (E2E):** the badge shows values within 2 s; the tape's frame times are recorded.

### 10. Time per category
- The metrics breakdown (decision 8), and the About panel's core count and budget notes (decision 9).
- **Tests (E2E):** every category shows a value on both builds; Isoloop shows per-isolate thread time.

### 11. Budget checks per size
- Isoloop's input budget asserted at each size CI runs (decision 11); the native and Isoloop medians and their ratio written to the test report.
- **Tests:** this is the check.

### 12. The comparison matrix
- `scripts/compare.ts` and `comparison.yml` run 3 sizes × 4 builds and record the React pair at Normal as the video. Results, including the hypothesis from decision 2 checked against them, and the per-category breakdown are kept as artifacts.
- **Tests:** the scenario runs in CI and uploads its numbers.

### 13. Ship
- Plans index and the M3 initiative updated; the M3c status set. The release is `markets-v0.2.0`, tagged by the user or on the user's word.

## Risks

- **The hypothesis may not hold** at Normal with realistic work, for example if DOM widgets dominate. Decision 2 applies; the per-category breakdown is what explains the result.
- **CI noise:** about 30 workers on a 4-core runner. CI asserts only Isoloop's own budget; absolute comparisons come from the recorded run.
- **Memory:** about 30 React isolates at about 1 MB each idle. Heavy's memory goes in the matrix as a cost.
