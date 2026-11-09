# Visual pools benchmark gate (M2d task 1)

[ADR 0015](../../docs/adr/0015-visual-pools.md), decision 12, and [M2d](../../docs/plans/m2d-visual-pools.md), decision 6: before any pool code, 8 React widgets in one worker (one `isoloop-dom` document, a root per widget) are measured against 8 own workers. M2d stops if either:

- pooling saves less than about 30% memory **and** doesn't start the widgets faster; or
- the pooled p95 update latency is more than twice the own-worker p95 **and** more than 50 ms.

**Result (2026-11-09): the gate passes on all three engines.** Pooling the 8 widgets used 35–64% less memory, started them up to 2 times faster on Chromium and Firefox (about the same on WebKit), and left update latency unchanged.

## Method

- **The widgets:** 8 React 19 widgets, as one machine's panel in the plant dashboard ([M3d](../../docs/plans/m3d-plant-dashboard.md)) would have them. Widgets 0–3 draw vibration (an SVG polyline of 50 samples, RMS and peak); widgets 4–7 show slow signals (a table of the last 20 rows, 6 columns).
- **Same worker script both ways** (`app/widget-worker.tsx`): one `isoloop-dom` document installed before React loads, and a root element per widget in it (ADR 0015, option D). Told to host one widget, it is an own worker; told to host eight, it is a pool. Widgets built together share one React instance in a pool. It is a prototype: no runtime context, heartbeat, supervision or per-member record routing.
- **The data:** a feed worker (`app/feed-worker.ts`) stands in for the bus and sends each widget its records over its own `MessagePort` at the plant dashboard's rates: vibration in 50 ms chunks of 50 samples (1 kHz), slow signals every 200 ms. That's 100 records a second for the 8 widgets.
- **On the page** (`app/main.ts`): each worker's batches are applied with `@isoloop/dom`'s host applier on animation frames, as the host's compositor does.
- **Memory:** the browser's whole process tree, PSS (as in the [M2c gate](../pools/README.md)), after 3 s of warm-up and 10 s of updates, minus the same page before the widgets started. On Chromium also `performance.measureUserAgentSpecificMemory()`, the bytes of the worker realms.
- **Start-up:** from the first `new Worker` to every widget's first render applied on the page.
- **Update latency:** from the feed stamping a record (`performance.timeOrigin + performance.now()`) to the animation frame on which the page found its patch applied, p50 and p95 over 10 s, after 3 s of warm-up. Frame-quantised: it includes the wait for the next frame.
- **Runs:** 7 per mode and engine, each in a fresh browser, alternating which mode goes first. Playwright 1.64.1 on Linux (WSL2, 32 cores, no GPU): Chromium 156, Firefox 157, WebKit 27.2. Medians, with the range.
- Run it with `pnpm bench:visual-pools` (`GATE_RUNS` sets the runs; default 5). Results go to `bench-results/visual-pools.json`.

## Results

| Engine | Memory, own workers | Memory, one pool | Saving | Start, own | Start, pool | p95 latency, own | p95 latency, pool |
|---|---|---|---|---|---|---|---|
| Chromium | 96.7 MB (94.6–97.1) | 63.0 MB (62.0–64.0) | 35% | 75 ms (69–81) | 36 ms (34–44) | 9.8 ms (9.5–10.5) | 9.6 ms (8.4–11.0) |
| Firefox | 83.3 MB (82.4–86.3) | 30.4 MB (28.1–30.9) | 64% | 62 ms (53–71) | 39 ms (35–51) | 17.4 ms (16.7–18.0) | 17.3 ms (17.2–17.5) |
| WebKit | 132.6 MB (130.1–140.2) | 66.3 MB (65.1–69.5) | 50% | 35 ms (33–57) | 33 ms (30–38) | 16.8 ms (16.6–17.8) | 16.6 ms (16.5–18.0) |

All runs delivered about 1,000 updates in the 10 s window in both modes, the feed's full rate. Chromium's worker realms alone (JavaScript heaps): 12.8 MB for 8 own workers, 2.9 MB for the pool.

**Gate:** memory saving at or above 30% on every engine, start-up faster on Chromium and Firefox, and the pooled p95 within a few tenths of a millisecond of the own-worker p95. Neither stop condition is met.

## What this doesn't say

- **Light widgets.** These widgets do little work per update, so one event loop keeps up with all 8. Heavier widgets in one pool delay each other (ADR 0015, consequences); the plant dashboard keeps heavy computation in data pools for that reason, and measures it with its own placements.
- **A prototype.** No runtime, supervision or per-member record routing; the real pool adds some cost to each.
- **Frame-quantised latency.** p95 sits near one frame (about 17 ms at 60 Hz on Firefox and WebKit). The bench can't tell differences smaller than a frame.
- **Widgets built together.** They share one React instance. Widgets built apart (ADR 0012) bring their own copies and save less.
- **One machine.** Desktop Linux with many cores. The plant dashboard measures a mid-range phone.
