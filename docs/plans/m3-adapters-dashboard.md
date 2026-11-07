# M3: Adapters and dashboard (initiative)

**Goal:** Preact and React adapters with `useTopic` / `usePublish`, and the flagship markets dashboard, backend-less and shipped to a static host, that runs as an idiomatic native app or on Isoloop at the flip of a toggle, beside live metrics.

**Done when** (RFC 0001): the dashboard is live on a public URL and a recorded comparison is in the README.

M3 is an initiative with two epics. Each has its own done-when, demo and write-up.

| Epic | Plan | Done when |
| --- | --- | --- |
| M3a Adapters | [m3a-adapters.md](m3a-adapters.md) | Both adapters pass the adapter conformance suite on every supported major (Preact 10 and 11, React 18 and 19) |
| M3b Dashboard | [m3b-dashboard.md](m3b-dashboard.md) | The initiative's done-when above |
| M3c Make the gain visible | [m3c-visible-gain.md](m3c-visible-gain.md) | At Normal size, native visibly stutters and Isoloop stays smooth |

M3a comes first; M3b's data pipeline (feeds, replay, aggregator, alerts) only needs the vanilla API and can start during M3a. [M2b](m2b-durable-log.md) runs in parallel with both, and M4 needs M3 and M2b.

## What goes where

- **M3a:** the two adapters and their hooks, per-major CI and DOM usage logs, DOM group 1 ([ADR 0010](../adr/0010-own-render-bridge.md#beyond-the-frameworks)), `force` for host-owned inputs, the `requires` version check ([ADR 0012](../adr/0012-isolates-built-apart.md)), adapter conformance, `requestCanvas`, `@isoloop/vite`, the memory-per-isolate bench.
- **M3b:** `isoloop/examples` and prerelease publishes, the dashboard's library choice and DOM group 2 as it needs, the dashboard's topics, isolates and UI, the native build, metrics, the recorded comparison, deploy and the "no backend" story.

## Risks across both epics

- **React's bundle per isolate:** M3a task 17 measures memory per isolate. If React isolates are far over budget, the RFC's shared runtime-bundle cache comes in before the dashboard grows.
- **The DOM subset meets real libraries in M3b.** Whatever the live dashboard still misses goes back into M3b's DOM tasks, not into a later milestone.
- **The comparison must not be a straw man:** native is an idiomatic main-thread app sharing the core, charts and widgets with the Isoloop build, Isoloop's costs are reported beside its gains, and the code is published.
