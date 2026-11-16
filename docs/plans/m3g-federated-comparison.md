# M3g: Federated comparison

**Status:** planned (grilled 2026-11-16). Built in `isoloop/web`, in parallel with [M3e](m3e-live-widget-creator.md); ships as the next free `markets-v*` minor when it's tagged (`markets-v0.4.0` if it lands before M3e's markets page, `markets-v0.5.0` after), then a `site-v0.1.x`, tagged by the user.

**Goal:** measure what Isoloop's React + Preact markets build (`mixed`) gives and costs against the way teams combine parts from several teams today: a native host that loads another team's part at run time.

**Why:** the website lists "Apps built from many teams' parts" as a use with no figures behind it. `mixed` has no native counterpart today (`COUNTERPART.mixed` is `undefined`, so the header shows Native as unavailable on `/mixed`), so there's nothing to compare it with.

**Done when:** `apps/dashboards/markets` in `isoloop/web` runs a `native-mixed` build and a `teams` placement on `mixed`; the pair and the placements measured alongside it are recorded on the bench server in `comparison/federated/`, with a write-up; the site's "many teams" use carries a measured sentence linking to it; and it ships as a `markets-v*` tag, then a `site-v0.1.x` tag, pushed by the user.

**Depends on:** [M3f](m3f-markets-parity.md) (the `native-workers` build, the placements, `packages/compare` and the matched method), [M3b](m3b-dashboard.md) task 16b (`mixed`, built apart per [ADR 0012](../adr/0012-isolates-built-apart.md)). Doesn't depend on M3e and touches none of its pages.

## Decisions (grilling, 2026-11-16)

### The native build

1. **`native-mixed`:** the `native-workers` build (the replay, the aggregator, alerts and the three engines in a worker each, the widgets on the main thread), with `filters` and `alerts-panel` on Preact, the same split as `mixed`. The two Preact parts are built and shipped apart, as another team's bundle, and the host loads them at run time with `import()`. It's built on `native-workers` rather than `native`, so the comparison doesn't mix the data leaving the main thread with the parts being loaded apart.
2. **The contract between the host and a part:** each part exports `mount(el, host) → unmount`. `host` is a plain object over the native store, `subscribe(stream, cb)`, `get(stream)` and `set(stream, value)`, for the filters, the alert rules and the alerts. Its types live in `src/parts/contract.ts`, which both sides import as types only. No module instance (store, context, React) is shared between the bundles.
3. **Nothing shared at run time.** The Preact part carries its own Preact (and its own zod, if it uses it): no import map, no shared-dependency scope, no Module Federation plugin. That's what makes the second runtime a real cost, and it's what `mixed` loads too.
4. **Our own manifest:** `parts/parts-manifest.json`, shaped `{ "parts": { "filters": { "entry": "…", "css": "…" } } }`, written from the build output by a few lines of Vite plugin. The host checks it with zod on load, as `mixed` checks `preact/isoloop-manifest.json`. Vite's internal `.vite/manifest.json` isn't read. A part's CSS is loaded next to its entry.
5. **Native gets the containment teams usually write, nothing more:**
   - the React widgets keep their slot error boundaries
   - each Preact part has its own Preact error boundary inside it
   - the host wraps `import()` and `mount` in try/catch and shows a fallback in the slot, so a part that fails to load doesn't break the page
   - no restart logic after a crash; a `block` freezes the main thread, and that's measured
6. **On the page:** `native-mixed` is deployed like the other builds, at `/native-mixed/`. The header's Native side gets "React + Preact", and `mixed` and `native-mixed` become each other's `COUNTERPART`. The build gets the parity and smoke specs on Chromium, Firefox and WebKit.

### Placements

7. **A `teams` placement, on `mixed` only:** the data on its own workers, as in `matched`, plus one pool per team: `react` for the 15 React widgets, `preact` for `filters` and `alerts-panel`. 8 workers, the bus's not counted. Under `matched`, both runtimes share the `widgets` pool, so one team's blocked widget stalls the other team's too; `teams` is the placement that answers "what does one team's failure take down" at a pool's price.
8. **On the page:** the placement switcher offers `teams` only on `/mixed`; elsewhere it isn't shown, not shown disabled. The explainer box (web#108) gets an entry worded like the others: "Each team's widgets share a pool of their own, and the data runs on its own workers. A blocked widget stalls its own team's widgets only." Widget headers say `pool react` or `pool preact`. `teams` gets a placement smoke test on the three browsers; if it stalls on WebKit, as `one` and `matched` can (engine constraint 2), the test is `test.fail` with a note.

### Measured

9. **The pair:** `native-mixed` (6 workers) against `mixed` in `matched` (7). Measured alongside: `mixed` in `teams` (8) and in `own` (a worker per isolate).
10. **Figures:**
    - M3f's set, unchanged: late frames (the ticker tape's), typing (into the alerts panel), main-thread CPU, CPU across all threads, memory at 16 s after GC, first data, every widget filled.
    - **JS bytes loaded,** per build and placement, so the second runtime's cost shows.
    - **Two containment scenarios, both on the Preact team's `alerts-panel`:**
      - `block` for 3 s: the React team's widgets' late frames and missed updates during the block, and the time until every widget is updating again
      - `crash`: what still updates afterwards, and whether the part comes back, and when

    M3f already measured blocking a React chart, so that isn't repeated.
11. **The run,** with the M3f method on the bench server: the shared `packages/compare` runner, pairs interleaved one page at a time, the gap taken as B − A within each round. Normal and Heavy; Chromium and Firefox; 5 rounds; no 10-minute hold. About 80 runs, 1.5–2 hours. Not measured: WebKit, phones, Lite, the 10-minute hold, React-only or Preact-only builds. Reported as measured.

### Write-up and site

12. **Write-up:** `apps/dashboards/markets/comparison/federated/`, the results JSON next to a README in the results layout: findings first, then the A/B/Δ tables, then collapsed details; no TL;DR. Costs (JS bytes, memory, CPU) are reported as plainly as what's contained. The markets README gets a short section linking to it; `comparison/final/` (M3f) stays the dashboard's main comparison.
13. **Site:** the "Apps built from many teams' parts" item in `apps/site/src/copy.ts` gets one measured sentence and a link to the write-up. `example.json`'s summary names the native + workers build with a Preact part loaded apart and the `teams` placement; its result line stays M3f's. The site changes ship as the next `site-v0.1.x` after the markets tag.
14. **Library fixes:** a small, scoped library fix with its test may land as a `next` prerelease and is reported. Anything that touches an ADR or the API stops for the user.

## Tasks

| # | Task | Repo | Review |
| --- | --- | --- | --- |
| 1 | This plan and the roadmap | isoloop | User |
| 2 | `native-mixed`: the parts contract, the manifest plugin and its zod check, the two Preact parts built apart, the guarded load, header and `COUNTERPART`, deploy, parity and smoke specs (decisions 1–6) | web | Self-merge on green |
| 3 | The `teams` placement on `mixed`: placement table, switcher, explainer entry, widget labels, smoke specs (decisions 7, 8) | web | Self-merge on green |
| 4 | In `packages/compare`: JS bytes loaded and the two `alerts-panel` scenarios; the markets federated pairs; then the bench-server run into `comparison/federated/` (decisions 9–11) | web | Self-merge on green |
| 5 | The write-up, the markets README section, `example.json` and the site sentence (decisions 12, 13) | web | User |
| 6 | Roadmap: M3g done | isoloop | User |
| 7 | The `markets-v*` tag after task 5, then `site-v0.1.x`, each on its own commit | web | User pushes the tags |

Tasks 2 and 3 run in sequence, since both touch the markets header and builds; 4 needs both.
