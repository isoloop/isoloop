# Implementation plans

One plan per milestone of [RFC 0001](../rfcs/0001-threaded-runtime.md#mvp-roadmap-and-repo-structure), built on the [system design](../design/system-design.md).

| Milestone | Plan | Detail | Status | Done when |
| --- | --- | --- | --- | --- |
| M0 Foundations | [m0-foundations.md](m0-foundations.md) | Full | Done | The four-loops demo runs from the repo and CI is green |
| M1 Kernel | [m1-kernel.md](m1-kernel.md) | Full | Done | A blocked or crashed isolate never affects the others, proven by Playwright tests |
| M2 Bus | [m2-bus.md](m2-bus.md) | Full | Done | A restarted isolate rebuilds its state from the log in a test |
| M2b Durable log | [m2b-durable-log.md](m2b-durable-log.md) | Full | Done | A persistent topic loses no acknowledged record across a bus crash or a page reload |
| M2c Worker pools (headless) | [m2c-worker-pools.md](m2c-worker-pools.md) | Full | Done (2026-11-09) | Pooled and own-worker isolates run side by side; a pool crash restarts only that pool |
| M2d Visual pools | [m2d-visual-pools.md](m2d-visual-pools.md) | Full | Done (2026-11-14, with `plant-v0.1.0`) | The plant dashboard ships with 72 widgets in 9 visual pools |
| M3 Adapters + dashboard (initiative) | [m3-adapters-dashboard.md](m3-adapters-dashboard.md) | Overview | M3a, M3b, M3c and M3d done; M3e next | Dashboard live on a public URL; recorded comparison in the README |
| ↳ M3a Adapters (epic) | [m3a-adapters.md](m3a-adapters.md) | Full | Done | Both adapters pass the adapter conformance suite on every supported major |
| ↳ M3b Dashboard (epic) | [m3b-dashboard.md](m3b-dashboard.md) | Full | Done (live since `markets-v0.1.0`) | The M3 done-when |
| ↳ M3c Dashboard sizes (epic) | [m3c-dashboard-sizes.md](m3c-dashboard-sizes.md) | Full | Done (`markets-v0.2.0`) | Lite, Normal and Heavy sizes on every build; the comparison across sizes recorded, whatever it shows |
| ↳ M3d Plant dashboard (epic) | [m3d-plant-dashboard.md](m3d-plant-dashboard.md) | Full | Done (`plant-v0.1.0`, 2026-11-14) | 72-widget plant dashboard on three builds and six placements: what the whole package costs against matched native builds, and what it gives |
| ↳ M3e Live widget creator (epic) | (plan after M3d is under way) | — | Not started | Users compose a widget from a JSON spec (source topic → fixed operators: filter/window/aggregate/combine → view) and add it at runtime; the pipeline runs in a new isolate placed in its own worker or a chosen pool; specs persist in a persistent topic; no user code/eval; measured: creator responsiveness while an expensive custom view computes, on native, native + workers and Isoloop |
| M4 Devtools + 0.1 | [m4-devtools-release.md](m4-devtools-release.md) | Outline | Not started | `0.1.0` on npm with a launch post |
| M5 Shared-memory engine | [m5-shared-memory-engine.md](m5-shared-memory-engine.md) | Outline | Not started | Benchmark results published, whichever engine wins |
| M5b Delivery batching (spike) | [m5b-delivery-batching.md](m5b-delivery-batching.md) | Outline | Not started | Findings written up; ADR amending §6.3 or a recalibrated §9 budget accepted |

An outline gets its full task list when it's next to start, so the list reflects what was learned. M3d (the plant dashboard) shipped as `plant-v0.1.0` on 2026-11-14, which also completed M2d. Next: M3e (the live widget creator), then M4 (0.1). Decided 2026-11-08: pools come before 0.1 so the plant dashboard can use them. M5 and M5b come after 0.1.

```mermaid
flowchart LR
  M0 --> M1 --> M2 --> M3a --> M3b --> M4
  M2 --> M2b --> M4
  M4 --> M5 --> M5b
  M2b --> M2c --> M2d --> M3d --> M3e --> M4
  M3b --> M3c --> M3d
  M3b -. "dashboard metrics reused" .-> M4
```

M1 and M2 overlapped: `packages/bus` is pure TypeScript with no browser dependency, so M2 tasks 1–6 ran in parallel with M1.

## Conventions

- **Initiatives and epics:** a large milestone can be an *initiative* that groups *epics* under one goal (M3: M3a and M3b). The initiative's plan holds the goal, the overall done-when and the risks shared by its epics; each epic has its own plan, done-when, demo and write-up.
- **Task size:** about one evening (2–3 h). If a task grows past two evenings, split it.
- **Every task names its files and its tests.** A task is done when its tests pass in CI.
- **Each milestone (or epic) ends with a demo and a write-up** (a short post or README section). That's the RFC's rule: each milestone ends in something that can be demoed, released and written about.
- **Branches:** `<type>/<slug>`, squash-merged to `main`. Types: `feature/` (new behaviour), `fix/` (a bug), `chore/` (tooling, deps, CI, refactors with no behaviour change), `docs/` (docs only). Milestone tasks put the milestone first in the slug, e.g. `feature/m0-workspace-skeleton`. The squash commit uses the matching conventional prefix (`feat:`, `fix:`, `chore:`, `docs:`). Changesets record user-facing changes from M1 on.
- **Merging:** every change, docs included, reaches `main` through a PR that is squash-merged on GitHub (`gh pr merge --squash`). A ruleset on `main` enforces this: PR required, squash only, linear history, no force-push or deletion. The PR title becomes the squash commit title, so it carries the conventional prefix. From M0 task 9 on, CI must be green before merging.
- **Decisions** made during a milestone become ADRs in [`docs/adr`](../adr/README.md).
- **Deferred ideas** live in [`docs/would-like.md`](../would-like.md), not in a plan, until a milestone takes them on.
- **Committed work that waits on something** (a package, a milestone) lives in [`docs/should-do.md`](../should-do.md), with what it waits on and its target milestone. It moves into a plan when that lands.
