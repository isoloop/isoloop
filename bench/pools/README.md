# Pools benchmark gate (M2c task 0)

[M2c](../../docs/plans/m2c-worker-pools.md), decision 3: before any pool code, 20 small headless isolates hosted in one worker are measured against 20 own workers. If pooling saves less than about 30% memory **and** doesn't start them faster, M2c stops and pools are dropped.

**Result (2026-11-08): the gate passes on all three engines.** Pooling the 20 isolates used 71–86% less memory and started them 2–3 times faster.

## Method

- **The members:** 20 distinct headless isolate modules (`virtual:member/<n>` in `vite.config.ts`), each with its own coefficient table, keeping a rolling window and computing a weighted mean every 100 ms. Each gets its own runtime context from `@isoloop/runtime`'s `createVanillaIsolate` (headless, its own bus port), as the real bootstrap would give it.
- **Same worker script both ways** (`app/pool-worker.ts`): told to host one member, it is an own worker; told to host twenty, it is a pool. The only difference measured is how many workers the members are spread over. It is a prototype: no heartbeat, supervision or host protocol.
- **Memory:** the browser's whole process tree, proportional set size (PSS, Linux `/proc/<pid>/smaps_rollup`), 2 s after the members started, minus the same page 2 s before they started. On Chromium also `performance.measureUserAgentSpecificMemory()`, which counts only the workers' JavaScript realms.
- **Start-up:** in the page, from the first `new Worker` to the last member's `start()` returning.
- **Runs:** 7 per mode and engine, each in a fresh browser (both modes start cold), alternating which mode goes first. Playwright 1.64.1 on Linux (WSL2, 32 cores, no GPU): Chromium 156, Firefox 157, WebKit 27.2. Medians, with the range.
- Run it with `pnpm bench:pools` (`GATE_RUNS` sets the runs; default 5). Results go to `bench-results/pools.json`. CI's bench job runs it with 3 runs per mode on tags, pull requests and the weekly run, and reports the numbers without asserting them (M2c task 9); they are in the job log and the `bench-results` artifact.

## Results

| Engine | Memory, own workers | Memory, one pool | Saving | Start, own workers | Start, one pool |
|---|---|---|---|---|---|
| Chromium | 64.3 MB (63.7–65.4) | 8.9 MB (8.7–9.6) | 86% | 57 ms (53–70) | 23 ms (22–27) |
| Firefox | 75.0 MB (74.5–76.1) | 21.4 MB (20.9–22.3) | 71% | 93 ms (90–96) | 46 ms (43–48) |
| WebKit | 63.7 MB (62.8–64.9) | 12.1 MB (11.5–12.2) | 81% | 63 ms (50–80) | 21 ms (20–22) |

Chromium's worker realms alone (JavaScript heaps): 7.6 MB for 20 own workers, 0.7 MB for the pool. Most of the per-worker cost is outside the JavaScript heap: each worker has its own thread, its own V8 isolate and its own copies of the loaded code.

Per isolate, that's about 3.2 / 3.8 / 3.2 MB as an own worker against 0.4 / 1.1 / 0.6 MB in a pool (Chromium / Firefox / WebKit).

## What this doesn't say

- **Small isolates only.** These members do almost nothing, so the fixed cost of a worker dominates. Isolates with large state (big buffers, a framework, caches) save a smaller share, because their own memory is the same in a pool.
- **Not the cost of sharing.** Pool members share an event loop and fail together (ADR 0001). This gate measures what pooling saves, not what it costs; tasks 3 and 8 cover restarts and blast radius.
- **One machine.** Desktop Linux with many cores. Phones may differ in both directions; the plant dashboard ([M3d](../../docs/plans/m3d-plant-dashboard.md)) measures a mid-range phone.
