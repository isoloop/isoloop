# M3: Adapters and dashboard sandbox (outline)

**Goal:** Preact and React adapters with `useTopic` / `usePublish`, and the flagship markets dashboard, backend-less and shipped to a static host, that runs single-threaded or on Isoloop at the flip of a toggle, beside live metrics.

**Done when** (RFC 0001): the dashboard is live on a public URL and a recorded comparison is in the README.

Gets a full task list when M2 closes.

## Main work items

1. **Preact adapter** (`packages/preact`), for Preact `^10 || ^11`, tested on both majors ([ADR 0010](../adr/0010-own-render-bridge.md#frameworks-and-versions)): `defineIsolate`, `useTopic(topic, { from })`, `usePublish`, `useRequest`, `useHost` (measure, focus, navigate), `useRoute()` (subscribes to `routeTopic` only when used, [ADR 0002](../adr/0002-host-owns-routing.md)). Rendering into `ctx.root`, the `isoloop-dom` subset ([ADR 0010](../adr/0010-own-render-bridge.md)). First, because Preact is small. Starts with the Preact smoke test moved from M1 task 5 ([should-do](../should-do.md)).
2. **React adapter** (`packages/react`), for React `^18 || ^19`, tested on both majors: the same hooks; React DOM renders into the `isoloop-dom` subset (the React smoke test moved from M1 task 5); verify concurrent features and `useSyncExternalStore` for topics.
3. **DOM beyond the frameworks** ([ADR 0010](../adr/0010-own-render-bridge.md#beyond-the-frameworks)): build group 1 (`classList`, `dataset`, `getElementById`, `contains`, `DocumentFragment`, comments). Pick the dashboard's chart, icon and table libraries first, log their DOM usage, and turn what they call from group 2 (queries, HTML parsing, `MutationObserver`) into conformance cases, then code. What the live dashboard still misses goes back into this item.
4. **Isolates built apart from the host** ([ADR 0012](../adr/0012-isolates-built-apart.md)): `defineIsolate` in `runtime` and both adapters stamps `requires` from the package version at build time; the bootstrap reports it in `ready`; the host checks `[FLOOR, VERSION]` and fails the isolate with `runtime-too-old` or `isolate-too-old` (final, both versions in the message); `dev` warnings for deprecated seam members. Tested with an isolate fixture stamped above, inside and below the range.
5. **Adapter conformance tests:** one fixture app per adapter, run through the same E2E suite (render, events, inputs, replay).
6. **Canvas isolates:** `requestCanvas` host call; a small chart helper on `OffscreenCanvas` in the worker; resize events.
7. **The markets dashboard**, in a new `isoloop/examples` repository on prerelease publishes ([should-do](../should-do.md)), so its dependencies stay out of the main repo. It installs from npm once `0.1.0` ships (M4). It needs no backend:
   - **Feed isolates** (headless), one per exchange, on public market-data WebSockets that need no key (e.g. Coinbase, Kraken, Bitstamp, OKX). Each maps its exchange's messages to shared `trades.v1` / `book.v1` schemas, and keeps `prices.v1` (compacted per symbol) current. One exchange's burst, parse error or hung socket affects only its own isolate.
   - **Sources** behind the same topics: `live` (the WebSockets) and `replay` (recorded ticks played back at N× speed). The replay source is what benchmarks, E2E tests and the recorded comparison use, because live markets aren't reproducible.
   - **Aggregator isolate:** cross-market VWAP, spreads and volume per symbol into `aggregates.v1`.
   - **Alerts isolate:** rules in a compacted `alert-rules.v1` edited from the UI, evaluated against prices and aggregates, firing into `alerts.v1` (persistent once M2b lands, memory until then).
   - **UI:** 3 `OffscreenCanvas` charts, a virtualized trades table, an alerts panel, a shared `filters.v1` compacted topic, and per-widget stress controls (block, crash, flood).
8. **Single-thread mode:** the same widget code mounted directly on the main thread through a "local" kernel that shares the API (same hooks, no workers). The fairness of the comparison depends on this: widget code must be identical.
9. **Metrics panel:** main-thread fps, long tasks (`PerformanceObserver`), input latency (Event Timing API), loop lag per worker, memory (`measureUserAgentSpecificMemory` when cross-origin isolated), bus throughput from bus metrics.
10. **Vite plugin** (`@isoloop/vite`): serves the worker bundles, builds isolates as worker-importable modules, and sets dev headers.
11. **Deploy:** public URL (GitHub Pages or Cloudflare Pages), recorded side-by-side video, README section.
12. **"No backend" story on the demo itself:** the live demo, not the README, is where the backend-less use case is told. An "About this demo" panel says that everything runs in the visitor's tab from a static host, draws the pipeline (feed isolates → aggregator → alerts → widgets) with live isolate states, and lists what this approach can't do: no API keys of your own, upstream APIs must allow browser calls, alerts only while a tab is open, and one connection set per tab. Once the demo is live, the README gets one line linking to it ("runs entirely in your tab from a static host, no backend"), and no more.

## Open risks

- React bundle per isolate: measure memory per isolate; the shared runtime-bundle cache from the RFC may be needed here.
- Virtualized table needs `measure` and scroll handling; it's the hardest test of the async-layout limits.
- The single-thread comparison must not be a straw man; publish the code for both modes.
- Exchange feeds change formats, rate-limit or geo-block. Keep each exchange behind its own feed isolate, and keep the replay source as the default for CI. Check each exchange's terms before recording or redistributing ticks.
