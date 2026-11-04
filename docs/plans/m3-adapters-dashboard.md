# M3: Adapters and dashboard sandbox (outline)

**Goal:** Preact and React adapters with `useTopic` / `usePublish`, and the flagship sales dashboard that runs single-threaded or on Isoloop at the flip of a toggle, beside live metrics.

**Done when** (RFC 0001): the dashboard is live on a public URL and a recorded comparison is in the README.

Gets a full task list when M2 closes.

## Main work items

1. **Preact adapter** (`packages/preact`): `defineIsolate`, `useTopic(topic, { from })`, `usePublish`, `useRequest`, `useHost` (measure, focus, navigate), `useRoute()` (subscribes to `routeTopic` only when used, [ADR 0002](../adr/0002-host-owns-routing.md)). Rendering into `ctx.root` via the Remote DOM polyfill. First, because Preact is small and works on Remote DOM today.
2. **React adapter** (`packages/react`): the same hooks; Remote DOM's React support for the reconciler; verify concurrent features and `useSyncExternalStore` for topics.
3. **Adapter conformance tests:** one fixture app per adapter, run through the same E2E suite (render, events, inputs, replay).
4. **Canvas isolates:** `requestCanvas` host call; a small chart helper on `OffscreenCanvas` in the worker; resize events.
5. **`examples/dashboard`:** a data isolate generating sales data, 3 `OffscreenCanvas` charts, a virtualized orders table, a shared `filters.v1` compacted topic, and per-widget stress controls (block, crash, flood).
6. **Single-thread mode:** the same widget code mounted directly on the main thread through a "local" kernel that shares the API (same hooks, no workers). The fairness of the comparison depends on this: widget code must be identical.
7. **Metrics panel:** main-thread fps, long tasks (`PerformanceObserver`), input latency (Event Timing API), loop lag per worker, memory (`measureUserAgentSpecificMemory` when cross-origin isolated), bus throughput from bus metrics.
8. **Vite plugin** (`@isoloop/vite`): serves the worker bundles, builds isolates as worker-importable modules, and sets dev headers.
9. **Deploy:** public URL (GitHub Pages or Cloudflare Pages), recorded side-by-side video, README section.

## Open risks

- React bundle per isolate: measure memory per isolate; the shared runtime-bundle cache from the RFC may be needed here.
- Virtualized table needs `measure` and scroll handling; it's the hardest test of the async-layout limits.
- The single-thread comparison must not be a straw man; publish the code for both modes.
