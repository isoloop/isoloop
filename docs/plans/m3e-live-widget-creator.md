# M3e: Live widget creator

**Status:** planned (grilled 2026-11-16). Built in `isoloop/web`; ships as `plant-v0.2.0`, then `markets-v0.4.0`, tagged by the user.

**Goal:** show that the drawer that creates widgets and the dashboard it adds them to don't block each other, in either direction: heavy work in the drawer doesn't slow the dashboard, and a dashboard under load doesn't make the drawer lag.

**Why:** M3b–M3f showed what a running dashboard gets from Isoloop. M3e shows the case where the page changes while it runs: the user adds, edits and removes widgets, each a new isolate, while the rest keeps drawing. It also defines the widget spec format the [Isoloop Builder](builder.md) builds on.

**Done when:** plant and markets in `isoloop/web` each have an interactive page, opened from their header, that starts with 4–8 starter widgets you can edit or delete, with an Add button that creates new ones from that dashboard's topics, placed manually in an existing pool or a new one. On plant at `?rate=5` both directions are measured against native on Chromium and Firefox and written up, whatever it shows. It ships as `plant-v0.2.0`, then `markets-v0.4.0`.

**Depends on:** [M3d](m3d-plant-dashboard.md) and [M3f](m3f-markets-parity.md) (the dashboards, `packages/compare`), [M2d](m2d-visual-pools.md) (visual pools), [M2b](m2b-durable-log.md) (persistent topics). [M3h](m3h-auto-placement.md) comes after it and adds automatic placement.

## Decisions (grilling, 2026-11-16)

### Pages

1. **An example, not a package.** M3e is an interactive mode for the existing example dashboards, built in `isoloop/web`. The [Isoloop Builder](builder.md) is a separate Isoloop app in its own repo.
2. **The current pages stay as they are.** Plant and markets keep every build, placement and control they have; each only gains an "Interactive mode" entry in its header. Their recorded figures, budgets and comparison specs don't change.
3. **Interactive mode is its own page:** `/dashboards/plant/interactive/` and `/dashboards/markets/interactive/`, each with its own entry and its own contracts module, on the same simulator and topics as its dashboard.
4. **The page starts with 4–8 starter widgets,** which are specs themselves, so they can be edited or deleted like the ones the user adds. Every widget has edit and delete buttons; Add opens the drawer. The page is always editable: there's no edit toggle.
5. **The header** keeps the **Native | Isoloop** switch and the load dial (plant `Rate`, markets `Size`), plus a link back to the full dashboard. It drops Build and Placement: the page is React only, and placement is chosen per widget.
6. **Native** runs the same drawer and widget code on the main thread, through the dashboards' `#env` pattern. The per-widget placement field is shown but disabled, with "Not used", as plant shows Placement on native builds.
7. **Built once.** The drawer, the spec format, the views and the widget runtime live in a shared `packages/creator` in `isoloop/web`. Each dashboard supplies only its topic catalog (decision 18), its starter specs and its contracts module. Plant comes first, then markets, which also proves the creator isn't plant-specific. `packages/creator` gets its own copy of the generic draw code (`drawChart`, `drawHeatmap`); removing the duplication across apps would touch the current pages, so it waits.

### Isolates and topics

8. **The drawer frame belongs to the host,** because an isolate's surface can't sit inside another's. It has two slots:
   - **the form:** the drawer isolate, in its own worker, never pooled
   - **the preview:** a real widget isolate in its own worker

   A heavy preview can't make the form lag, and the form can't stall the preview. On Add, the preview stops and the widget is spawned in its place on the grid.
9. **One visual isolate per widget.** It subscribes to its source topic, runs its operators and draws. Its grants allow its source topic and its own spec record, nothing else. There are no pipeline or source isolates.
10. **Widgets read their spec from a topic,** not once at spawn:
    - **Preview:** the form publishes the draft to `creator.draft.v1` (memory, keyed by draft id). The preview rebuilds its pipeline 300 ms after the last change, so typing respawns nothing.
    - **Edit:** a change to operators, view or title publishes the new spec, and the running widget reconfigures in place.
    - **Respawn:** a change to the source topic or the placement stops the widget and spawns it again, because grants and placement are fixed at spawn.
11. **Two creator topics, declared at boot.** Contracts can't change at run time ([ADR 0003](../adr/0003-schema-format-standard-schema.md), decision 9), so each interactive page's contracts module declares `creator.specs.v1` and `creator.draft.v1` up front.
12. **Persistence:** `creator.specs.v1` is compacted and persistent, keyed by widget id; a delete is a tombstone. When the topic is empty (a first visit), the starter specs are seeded. "Reset to starter" tombstones every widget and seeds again. There's no undo: the Builder will want change-set history, which a compacted topic doesn't keep, so it gets a topic of its own.

### Placement

13. **Manual only in M3e.** The placement field lists the page's creator pools ("Pool 1", "Pool 2", named automatically), each with its member count and live lag from the heartbeat's `lagMs`, plus **"Create new"**. A new pool with one member is the same as an own worker, and others can join it later, so there's no separate "own worker" choice. A new widget's field preselects the last pool used.
14. **Room for automatic placement.** The spec keeps `placement: { "mode": "manual", "pool": "pool-1" }`; v1 accepts only `manual`. [M3h](m3h-auto-placement.md) adds `auto` without a format change. The form shows no disabled "Automatic" option before then.

### The spec

15. **`isoloop-spec@1`, a widget spec:**
    ```json
    { "id": "w7", "title": "Pump 3 vibration p95",
      "source": { "topic": "plant.sensors.v1", "key": "pump-3" },
      "operators": [
        { "op": "filter", "where": { "field": "sensor", "op": "==", "value": "vibration" } },
        { "op": "window", "ms": 60000 },
        { "op": "aggregate", "every": 1000, "fn": "percentile", "p": 95, "field": "value" }
      ],
      "view": { "type": "line", "size": "m" },
      "placement": { "mode": "manual", "pool": "pool-1" } }
    ```
    The topic and field names above are illustrative; the catalog has the real ones.
16. **Operators, run in order, with no user code or `eval`:**
    - `filter`: structured predicates (`field`, `op`, `value`) with `and`, `or` and `not`
    - `window`: by time (`ms`) or by count (`n`)
    - `aggregate`: count, sum, avg, min, max, last and percentile, every `every` ms, with an optional `groupBy`

    No `combine` in v1: a widget has exactly one source ([would-like](../would-like.md)). No expression syntax either.
17. **Five views:** line, bar, heatmap, table, and stat (a number with an optional gauge), with `size` `s`, `m` or `l`. Each view states the pipeline output it takes (series, grid, rows or scalar), and a mismatch is a validation error. The gauge and table are new and read no plant constants (`SENSOR` and the like).
18. **A curated topic catalog per dashboard,** written by hand: each offered topic's name and key, its fields with type (`number`, `string` or `time`) and unit, and `history`, how far back the topic keeps records (2 minutes on plant; markets per topic). A test checks the catalog against the dashboard's zod schemas and retention.
19. **Validation:** zod, behind our own `validateSpec(spec, catalog)`. It checks the shape, that fields exist in the catalog with the right type, that a window is no longer than its topic's `history`, and that the view takes the pipeline's output. Errors carry a path (`operators[1].ms`), and the form shows each on its field. The library's tail start (`{ since }`) stays unbuilt: a widget subscribes from `earliest` and keeps its own window.
20. **Layout and limits:** a fixed grid in add order, each widget taking the space its `size` gives it. No reordering in v1 (move buttons are in would-like; drag and drop isn't possible in the DOM subset). At most 24 widgets per page, the preview not counted, on Native too.

### Sources left out

21. **Dashboard topics only.** CSV and JSON uploads and polled URLs are dropped from M3e and move to the Builder ([builder.md](builder.md), decision 3), with the two questions they raise:
    - **Uploads:** `File` objects never reach an isolate; forwarded events carry strings only. The host would attach the chosen `File`s to a forwarded `change` event of `<input type="file">`, which changes `isoloop-dom@1` events and needs an ADR.
    - **Network:** there's no `fetch` grant. Workers fetch freely and only the page's CSP `connect-src` limits them; a grant that wraps `fetch` could be bypassed with `XMLHttpRequest`, `WebSocket` or `EventSource`.

### Measured

22. **Plant only, both directions, against native,** at `?rate=5`, on Chromium and Firefox, with the shared `packages/compare` runner and the M3f method (pairs interleaved one page at a time, 5 rounds, on the bench server):
    - **Drawer → dashboard:** while the drawer previews a heavy widget (a heatmap or percentile aggregate over every sensor's 2-minute history) and the form is being typed in, the starter widgets' late frames.
    - **Dashboard → drawer:** while plant runs at `?rate=5`, typing and click latency in the drawer's fields.

    Reported as measured. markets' interactive page gets E2E tests, no measurement.
23. **Tests:** unit tests for the operators, `validateSpec` and the catalogs; E2E on Chromium, Firefox and WebKit for add, edit (reconfigure and respawn), delete, reset, reload persistence, the 24 cap, a blocked or crashed widget restarting alone, and the Native page. If a test stalls on WebKit, as plant's Isoloop page does (engine constraint 2), it's `test.fail` with a note.
24. **Library fixes:** a small, scoped library fix with its test may land as a `next` prerelease and is reported. Anything that touches an ADR or the API stops for the user.

## Tasks

| # | Task | Repo | Review |
| --- | --- | --- | --- |
| 1 | This plan, M3h's outline and the roadmap | isoloop | User |
| 2 | `packages/creator` core: `isoloop-spec@1` types, `validateSpec`, the operators as pure functions, the catalog type, unit tests (decisions 15, 16, 19) | web | Self-merge on green |
| 3 | The five views and the draw code in `packages/creator` (decision 17) | web | Self-merge on green |
| 4 | The widget isolate: spec subscription, reconfigure and respawn, grants; native counterpart (decisions 9, 10) | web | Self-merge on green |
| 5 | The drawer: host frame with form and preview slots, the form with inline errors, manual placement, the creator topics, persistence, reset, the cap (decisions 8, 11–13, 20) | web | Self-merge on green |
| 6 | Plant's interactive page: catalog and its test, starter specs, contracts, header entry, Native, E2E (decisions 2–6, 18, 23) | web | Self-merge on green |
| 7 | The two measured scenarios in `packages/compare`, then the bench-server run (decision 22) | web | Self-merge on green |
| 8 | Plant's write-up and `example.json` | web | User |
| 9 | Markets' interactive page: catalog, starters, contracts, header entry, E2E | web | Self-merge on green |
| 10 | Roadmap: M3e done | isoloop | User |
| 11 | `plant-v0.2.0` after task 8, `markets-v0.4.0` after task 9, each on its own commit | web | User pushes the tags |

Tasks 2 and 3 run in parallel; 4 needs both; 5 needs 4; 6 needs 5; 7 and 9 need 6 and can run in parallel.

## Follow-ups

- [M3h](m3h-auto-placement.md) adds automatic placement to the interactive pages.
- The Builder takes the spec format out of `packages/creator` into a package when it starts.
