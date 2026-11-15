# M3f: Markets parity

**Status:** done; ships as `markets-v0.3.0`, tagged by the user. Planned, built and measured 2026-11-15: tasks 2–4 in isoloop/web #98–#101, the write-up in #102 ([final run](https://github.com/isoloop/web/tree/main/apps/dashboards/markets/comparison/final)). The last epic of the [M3 initiative](m3-adapters-dashboard.md): M3 is done when this ships. M3e, the live widget creator, moved out of the initiative on 2026-11-15 and is a standalone epic before M4.

**Goal:** the markets dashboard gets what the plant has, a native + workers build and pooled placements, and is measured head to head with the plant's matched method, so its figures can go back on the website.

**Why:** today's markets figures ([M3c](m3c-dashboard-sizes.md)) compare native on one thread with Isoloop on a worker per isolate (22 workers at Normal, 30 at Heavy, each with its own runtime and React copy). That is the most expensive placement against the cheapest native build, so the website leaves the figures out until a fair comparison exists (decided 2026-11-14).

**Done when:** `apps/dashboards/markets` in `isoloop/web` runs a `native-workers` build and `?placement=own|one|matched` on every Isoloop build; the matched pairs are recorded on the bench server in `comparison/final/`, with a write-up; `example.json` shows the figures again; and it ships as `markets-v0.3.0`, tagged by the user.

**Depends on:** [M3d](m3d-plant-dashboard.md) (the matched method and `run.ts`), [M2c](m2c-worker-pools.md) and [M2d](m2d-visual-pools.md) (pools).

## Decisions (grilling, 2026-11-15)

1. **M3 closes with M3f.** M3's done-when (a dashboard live on a public URL, with a recorded comparison) was met with M3b; M3f makes the markets comparison fair. M3e keeps its id and becomes a standalone epic between M3f and M4.
2. **A `native-workers` build, React only.** Every headless job runs in its own plain worker, on the same `core/` code as the Isoloop isolates: the replay, the aggregator, alerts and each engine (correlations, depth, stats), and in live mode the four feeds. The widgets stay on the main thread and read over `postMessage`. Preact gets no `native-workers` build.
3. **Placements: `?placement=own|one|matched`,** on every Isoloop build (React, Preact, mixed); only the host manifests change.
   - **`own`:** a worker per isolate, as today. **The default.** Markets is the site's containment example: in a pool a block restarts the whole loop, so under `matched` the "block one chart" control would stall and restart every widget. The comparison names its placements explicitly, so the default doesn't change the figures.
   - **`matched`:** the `native-workers` build's data workers, plus one visual pool for every widget.
   - **`one`:** every isolate in one pool, the nearest to native's single thread.
   The plant's `split`, `machine` and `shared-engines` have no markets counterpart (no machines). Every placement also runs the bus's worker, which worker counts leave out.
4. **Labels and switchers.** Each widget header says where it runs (`pool widgets`, `worker 12`), as the plant's do. The header bar gets a placement switcher next to size and build, and the stress panel names the placement in use.
5. **Tests and CI.** The parity, smoke and budget specs cover `native-workers`; each placement gets a smoke test on Chromium, Firefox and WebKit. If `one` or `matched` stalls on WebKit, as the plant's Isoloop page does (engine constraint 2), that test is `test.fail` with a note, not a blocker. `comparison.yml` (GitHub runner; weekly and on `markets-v*`) runs the new pairs; the bench server is the source of the shipped figures.
6. **One runner.** The plant's `comparison/run.ts` moves to a shared module in `isoloop/web` and both apps use it. The plant's spec and recorded figures don't change.
7. **The measured run,** on the bench server, as the plant's [final run](https://github.com/isoloop/web/tree/main/apps/dashboards/plant/comparison/final): pairs interleaved one page at a time, the gap taken as B − A within each round.
   - Pairs: `native` against `isoloop:one`, `native-workers` against `isoloop:matched`; `isoloop:own` measured alongside.
   - React; Normal and Heavy; Chromium and Firefox; 5 rounds; no 10-minute hold. About 100 runs, about 2 hours.
   - Not measured: WebKit, phones, the 10-minute hold, the CPU probe, Preact, a new side-by-side video.
8. **Figures,** the plant's set: late frames (the ticker tape's frames), typing (into the alerts panel), main-thread CPU, CPU across all threads, memory at 16 s after GC, first data, all widgets with data, and recovery after a 3 s block of one chart (M3b's scenario). Reported as measured.
9. **Write-up.** The new run goes in `comparison/final/` and the markets README leads with it. The M3c recording stays as history, labelled with its placement (native on one thread, Isoloop on a worker per isolate). `example.json` gets headline figures with their placement stated, in place of "figures will follow"; the hub card shows them. The landing page's cost table stays plant-only.
10. **Library fixes.** A small, scoped library fix with its test may land as a `next` prerelease and is reported. Anything that touches an ADR or the API stops for the user.

## Tasks

| # | Task | Repo | Review |
| --- | --- | --- | --- |
| 1 | This plan | isoloop | User |
| 2 | `native-workers` build, placements, labels and switchers, specs, `comparison.yml` (decisions 2–5) | web | Self-merge on green |
| 3 | The shared runner; the plant switched to it with its tests green (decision 6) | web | Self-merge on green |
| 4 | The markets pairs in the runner, then the bench-server run (decisions 7, 8) | web | Self-merge on green |
| 5 | The write-up and `example.json` (decision 9) | web | User |
| 6 | Roadmap: M3f and M3 done, M3e standalone | isoloop | User |
| 7 | `markets-v0.3.0`, then `site-v0.1.1`, each on its own commit | web | User pushes the tags |

Tasks 2 and 3 run in parallel; 4 needs both.
