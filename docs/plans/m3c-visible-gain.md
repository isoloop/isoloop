# M3c: Make the gain visible

**Status:** not started. Third epic of the [M3 initiative](m3-adapters-dashboard.md), added 2026-11-07 after the first public deploy (`markets-v0.1.0`).

**Goal:** at the dashboard's default size, a visitor sees the difference between native and Isoloop without pressing a stress button, and can see why, from the kind of work each widget does.

**Why:** on the M3b dashboard (6 widgets, 3 symbols, 2 trades a second per source) nothing is heavy, so native is ahead when calm (11 ms against 34 ms per keystroke) and the gain only appears under the stress buttons. That's honest, but it doesn't show what Isoloop is for.

**Done when:** at **Normal** size, on a machine with 4 or more cores, native visibly drops frames (under about 40 fps) and typing goes over 200 ms, while Isoloop holds about 60 fps and under 100 ms, with realistic work only. CI checks it as ratios (task 11); the recorded comparison checks the absolute numbers (task 12).

**Depends on:** [M3b](m3b-dashboard.md). [M4](m4-devtools-release.md) waits for this epic; the launch post uses its recording.

## Decisions (grilling, 2026-11-07)

1. **Only work a real dashboard does.** The load comes from computations a markets dashboard plausibly runs: correlations, volatility, depth, scanners and redrawing charts on each tick. No hidden busy loops. The calm cases where native wins stay in the comparison.
2. **If the prediction fails, stop.** If Normal doesn't show the gain with realistic work, report the numbers and the per-category breakdown. Don't make the work heavier to get there: that would be a finding about Isoloop, and the decision is the user's.
3. **Three sizes:** `?size=lite|normal|heavy`, a switch in the page header that carries over when toggling builds.
   - **Lite:** today's 6 widgets and 3 symbols. Native is expected to win or tie, and the page shows it.
   - **Normal (default):** 16 widgets, 20 symbols.
   - **Heavy:** 24 or more widgets, 20 symbols, 5× the tick rate.
   Symbol count, tick rate and widget counts are also URL parameters, for tests only.
4. **Categories on two axes.** Every widget is tagged by **data**: raw (records as they arrive), filtered (a view over `filters.v1`), aggregated (rolling computations over one stream) or combined (joins several topics). It's also tagged by **output**: canvas or DOM. Each size is a count per category. The prediction to test: the gain grows with aggregated and combined work drawn on canvas, and stays small for raw DOM widgets, whose DOM changes are still applied on the main thread.
5. **20 synthesized symbols in replay.** Live mode keeps the exchanges' real symbols and rates; there the sizes choose only the widgets.
6. **Shared engines.** Derived data that several widgets use (rolling stats, correlations, the depth model) lives in `src/core`. On Isoloop it runs as headless engine isolates publishing result topics (for example `volatility.v1`, `correlations.v1`, `depth.v1`); on native the same code runs as main-thread services. Widgets only subscribe.
7. **Visible jank, always on, in every build:** a ticker tape scrolled by `requestAnimationFrame`, an input echo box, and a small fps and input-latency badge.
8. **Where the time goes:** the metrics panel shows main-thread milliseconds per second per category. On native, each widget's compute and render is wrapped in `performance.measure`. On Isoloop, it shows each surface's main-thread DOM apply time, and each isolate's own thread time separately.
9. **Limits, stated openly.** Heavy stays at 32 isolates or fewer, ADR 0001's soft budget, and grows by work per isolate instead. The About panel says pooling ([M2c](m2c-worker-pools.md)) is how real apps go further. It also shows the visitor's `navigator.hardwareConcurrency` and warns below 4 cores: on 2 cores Isoloop has nowhere to move the work.
10. **The comparison is a matrix:** 3 sizes × 4 builds (the React and Preact pairs), 12 rows, with the same columns as M3b's table. The side-by-side video is the React pair at Normal. The results are kept as artifacts; where they're published (README, a post) is decided after the user has seen the demo.
11. **CI:** pull requests run Lite and Normal (every build on Chromium, the React pair on all three engines). `markets-v*` tags, the weekly run and the comparison add Heavy. Latency budgets use `PERF_BUDGET_SCALE`.
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

### 9. Visible jank
- The ticker tape, the input echo box and the fps and latency badge, the same code in every build.
- **Tests (E2E):** the badge shows values within 2 s; the tape's frame times are recorded.

### 10. Time per category
- The metrics breakdown (decision 8), and the About panel's core count and budget notes (decision 9).
- **Tests (E2E):** every category shows a value on both builds; Isoloop shows per-isolate thread time.

### 11. The visible-gain check
- At Normal, Isoloop's median input latency is under a third of native's and its fps at least 1.5× native's, plus the absolute 200 ms × `PERF_BUDGET_SCALE`. Lite and Normal on pull requests, Heavy on tags, weekly and in the comparison (decision 11).
- **Tests:** this is the test. If it fails with realistic work, stop (decision 2).

### 12. The comparison matrix
- `scripts/compare.ts` and `comparison.yml` run 3 sizes × 4 builds, check the done-when's absolute numbers, and record the React pair at Normal as the video. Results and the per-category breakdown are kept as artifacts.
- **Tests:** the scenario runs in CI and uploads its numbers.

### 13. Ship
- Plans index and the M3 initiative updated; the M3c status set. The release is `markets-v0.2.0`, tagged by the user or on the user's word.

## Risks

- **Normal may not show the gain** with realistic work, for example if DOM widgets dominate. Decision 2 applies; the per-category breakdown is what explains it.
- **CI noise:** 30 workers on a 4-core runner. Ratios on CI, absolute numbers only in the recorded comparison.
- **Memory:** about 30 React isolates at about 1 MB each idle. Heavy's memory goes in the matrix as a cost.
