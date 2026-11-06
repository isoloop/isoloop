# M3b: Dashboard

**Status:** not started. Second epic of the [M3 initiative](m3-adapters-dashboard.md).

**Goal:** the flagship markets dashboard: backend-less, on a static host, running single-threaded or on Isoloop at the flip of a toggle, beside live metrics. It also grows the DOM subset to what its libraries need.

**Done when** (RFC 0001): the dashboard is live on a public URL and a recorded comparison is in the README.

## Scope

**In:** the `isoloop/examples` repository and prerelease publishes (moved from [should-do](../should-do.md)), library choice and DOM group 2 as needed ([ADR 0010](../adr/0010-own-render-bridge.md#beyond-the-frameworks)), the dashboard's topics and isolates, single-thread mode, the metrics panel, the recorded comparison, deploy, and the "no backend" story on the demo.

**Out:** devtools (M4), persistent alerts (they become `persistent` when M2b lands; memory until then), sharing feeds across tabs ([would-like](../would-like.md)).

**Depends on:** [M3a](m3a-adapters.md) for the adapters, `requestCanvas` and `@isoloop/vite`. Tasks 1–3 and 6–10 need only the vanilla API and can start during M3a.

**Order:** 1 and 2 first. DOM tasks 3–5 follow task 2, only for what it finds. The data pipeline (6–10) runs in parallel with the UI (11–14) once 6 exists. 15–16 need the UI; 17–20 close the epic.

## Tasks

### 1. `isoloop/examples` and prerelease publishes
- **Main repo:** a manual workflow, `.github/workflows/prerelease.yml`, that publishes every `@isoloop/*` package as `0.0.0-next.<sha>` with the npm `next` tag and provenance. This is a stopgap until M4's Changesets pipeline. **Needs the user:** an npm automation token for the `isoloop` org, stored as a repository secret.
- **New repo `isoloop/examples`:** pnpm workspace, the same toolchain pins (ADR 0009), CI with Playwright on all three engines, and `apps/markets` installing `@isoloop/*@next`.
- **Tests:** the examples CI installs from npm and runs one empty isolate E2E.

### 2. Library choice and DOM usage logs
- Pick the dashboard's table, icon and chart approach. The default is our own code, as with the render bridge ([ADR 0010](../adr/0010-own-render-bridge.md)): charts are `OffscreenCanvas` drawing in the worker, so a DOM chart library isn't needed. A library comes in only where writing our own would take longer than this epic allows, typically the virtualized table, and then behind our own small interface.
- Log each chosen library's DOM usage with M3a task 2's tool. The members it calls from group 2 become conformance cases (tasks 3–5); anything in group 3 (synchronous layout) means the library is replaced or wrapped.
- **Files:** `docs/investigations/dashboard-libraries.md` (choices, usage logs, what each needs); the logs in `packages/dom/usage/`.
- **Tests:** the usage check from M3a task 2 covers the new logs.

### 3. DOM group 2: queries (if task 2 needs them)
- `querySelector`, `querySelectorAll`, `matches`, `closest` with a selector subset: tag, class, id, attribute, descendant and child combinators, `:not`. Anything else throws `NotSupportedError` naming the selector.
- **Files:** `packages/dom/src/worker/selectors.ts`, `src/worker/dom.ts`, `src/testing/conformance.ts`.
- **Tests (browser):** conformance cases comparing results with the real DOM's for a table of selectors.

### 4. DOM group 2: HTML parsing and `cloneNode` (if task 2 needs them)
- `innerHTML`, `insertAdjacentHTML`, `<template>`, `cloneNode(true)`, `importNode`, with a forgiving parser for well-formed markup. The output is ordinary `insert` records, so the host's sanitiser still sees everything.
- **Files:** `packages/dom/src/worker/html.ts`, `src/worker/dom.ts`, `src/testing/conformance.ts`.
- **Tests (browser):** conformance cases: parsed trees match the real DOM's for well-formed input; `<script>` in parsed markup never reaches the host (I9); a cloned subtree gets new ids.

### 5. DOM group 2: `MutationObserver` (if task 2 needs it)
- Fed from the records the recorder already collects, delivered as a microtask like the real one.
- **Files:** `packages/dom/src/worker/observer.ts`, `src/worker/dom.ts`.
- **Tests (browser):** `childList`, `attributes` and `characterData` records match the real DOM's for the same edits.

### 6. Topics and contracts
- **Files:** `apps/markets/src/contracts.ts` (examples repo): `trades.v1`, `book.v1`, `prices.v1` (compacted per symbol), `aggregates.v1`, `alert-rules.v1` (compacted), `alerts.v1`, `filters.v1` (compacted), with Zod schemas.
- **Tests (unit):** `testContracts()`; a sample record of each topic validates.

### 7. Replay source
- A recorded tick format, a recording script for the live feeds, and a player that publishes the recording to `trades.v1` and `book.v1` at N× speed. Check each exchange's terms before committing recordings; synthesize ticks where they don't allow it.
- **Files:** `apps/markets/src/sources/replay.ts`, `scripts/record.ts`, `fixtures/ticks/`.
- **Tests (unit):** the same recording at 1× and 10× publishes the same records in the same order.

### 8. Feed isolates: Coinbase and Kraken
- One headless isolate per exchange on its public WebSocket, mapping messages to `trades.v1` and `book.v1` and keeping `prices.v1` current; reconnect with backoff.
- **Files:** `apps/markets/src/isolates/feeds/{coinbase,kraken}.ts`, `src/isolates/feeds/common.ts`.
- **Tests:** unit: mapping recorded raw messages; E2E: a malformed message that crashes one feed leaves the other running.

### 9. Feed isolates: Bitstamp and OKX
- Same as task 8, for two more exchanges.
- **Tests:** unit mapping tests.

### 10. Aggregator and alerts isolates
- Aggregator: cross-market VWAP, spreads and volume per symbol into `aggregates.v1`. Alerts: rules from `alert-rules.v1`, evaluated against prices and aggregates, firing into `alerts.v1`.
- **Files:** `apps/markets/src/isolates/{aggregator,alerts}.ts`.
- **Tests (unit, on the replay source):** known VWAP and spread values for a fixed recording; a rule fires once per crossing.

### 11. UI shell, filters and charts
- The page layout, `filters.v1` shared by every widget, and three `OffscreenCanvas` charts (price, spread, volume) drawn by a small chart helper in the worker, through `requestCanvas`.
- **Files:** `apps/markets/src/shell.ts`, `src/isolates/charts/`, `src/lib/canvas-chart.ts`.
- **Tests (E2E):** changing a filter updates all three charts; a chart isolate crash leaves the others drawing.

### 12. Virtualized trades table
- Uses `measure` and scroll events through `useHost`; the hardest test of async layout.
- **Files:** `apps/markets/src/isolates/trades-table/`.
- **Tests (E2E):** scrolling 10,000 rows renders only visible rows and never shows an empty viewport for more than one frame.

### 13. Alerts panel and rule editor
- Shows `alerts.v1`, edits `alert-rules.v1`.
- **Files:** `apps/markets/src/isolates/alerts-panel/`.
- **Tests (E2E):** a rule added in the editor fires on the replay source and shows in the panel.

### 14. Stress controls
- Per widget: block (busy loop for N s), crash, flood (publish N records/s).
- **Files:** `apps/markets/src/isolates/stress.ts`, wired into each widget.
- **Tests (E2E):** blocking one chart keeps input latency on the others under the [§9](../design/system-design.md#9-performance-budgets) budget.

### 15. Local kernel for single-thread mode
- The same widget code mounted on the main thread, through a kernel that shares the API (same hooks, no workers). It needs the broker in-thread, and `host` must not depend on `bus` source (design §2), so it lives in a new package, `@isoloop/local` (depends on `bus`, `runtime` and `dom`). **Decision for the user:** the package and its dependency exception, as an ADR, before code.
- **Files:** `packages/local/src/index.ts` (main repo).
- **Tests (browser):** the four-loops isolates run unchanged under the local kernel; the adapter conformance fixtures pass on it.

### 16. Single-thread toggle
- A toggle that reloads the dashboard on the local kernel or on Isoloop. Widget code is identical; only the kernel import changes.
- **Files:** `apps/markets/src/main.ts`.
- **Tests (E2E):** both modes render the same data from the replay source.

### 17. Metrics panel
- Main-thread fps, long tasks (`PerformanceObserver`), input latency (Event Timing API), loop lag per worker (from heartbeats), memory (`measureUserAgentSpecificMemory` when cross-origin isolated) and bus throughput (`bus:metrics`).
- **Files:** `apps/markets/src/metrics/`.
- **Tests (E2E):** every metric shows a value within 2 s of start in both modes; memory shows "unavailable" without cross-origin isolation.

### 18. Recorded comparison
- A scripted scenario on the replay source at N× with stress, run in both modes; Playwright records both, and a script puts the numbers and the side-by-side video into the README.
- **Files:** `apps/markets/e2e/comparison.spec.ts`, `scripts/compare.ts`; README section in the main repo.
- **Tests:** the scenario runs in CI and uploads its numbers.

### 19. Deploy and the "no backend" story
- A public URL. Cloudflare Pages if the memory metric needs COOP/COEP headers, which GitHub Pages can't set. The "About this demo" panel: everything runs in the visitor's tab from a static host, the pipeline drawn with live isolate states, and what this approach can't do (no keys of your own, upstream APIs must allow browser calls, alerts only while a tab is open, one connection set per tab). Then one README line linking to it.
- **Files:** `apps/markets/src/about/`, the deploy workflow in the examples repo.
- **Tests (E2E):** a smoke test against the deployed URL after each deploy.

### 20. Write-up
- Post: "A backend-less markets dashboard on Isoloop", with the comparison numbers and video.

## Risks

- **The virtualized table** may need synchronous layout a worker can't give. If `measure` round trips aren't enough, it renders fixed-height rows.
- **Exchange feeds** change formats, rate-limit or geo-block. Each stays behind its own feed isolate, and CI uses the replay source only.
- **A fair comparison:** both modes use the same widget code, and the code for both is published.
- **Prerelease publishes before M4** put `0.0.0-next` versions on npm under the `isoloop` org. They're tagged `next`, never `latest`.
