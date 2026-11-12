# Investigation: where the plant dashboard's Isoloop memory goes

- **Date:** 2026-11-09
- **Question:** in the [M3d](../plans/m3d-plant-dashboard.md) comparison (Chromium, 4 cores, 1 kHz), the Isoloop build in its `machine` placement used 451 MB with 10 workers, and native + workers 248 MB with 9. Where do the other 200 MB go, which causes can be fixed, and what would each fix save?
- **Answer:** worker count explains little of it. At the moment the comparison samples, about two thirds of the gap is **garbage not yet collected**. The rest is **live memory**: each visual pool's own framework, runtime and document, plus the bus worker. One more cause shows up only over time: the bus keeps expired records of slow topics much longer than their retention, so the gap **grows** by about 3–4 MB a minute for the first 17 minutes. In order of size:

  | Cause | MB of the gap (16 s after load) | Fixable? |
  | --- | --- | --- |
  | Garbage: more allocation per record, across every thread | about 100 | Partly: fewer messages per record |
  | Each visual pool's framework, runtime, DOM and code | about 45 | Only by having fewer visual pools (a placement choice) |
  | The bus worker and the fleet engine's own worker | about 8 | No; inherent to ADR 0005 |
  | Bus retention keeping expired records | 0 at 16 s; about 50 at 10 min | Yes; a bug fix, no ADR |

  The figures here were measured for this investigation (Chromium 156, below), not taken from the comparison: the same build measured the same way gives a 157 MB gap at 16 s, against the comparison's 203 MB. The viewport differs (see [Method](#method)), and a single reading also depends on when each heap last collected, which by itself moves the gap by tens of MB.

## Method

- **Environment:** Playwright 1.64.1 headless shell, Chromium 156.0.8078.4. Linux under WSL2 on a 32-core host, with each run held to 4 cores by `taskset`. The plant app was built from `isoloop/examples` `main` at `78daaa6`, with `@isoloop/*@0.0.0-next.62ef495`; seed 7, `?rate=1`, viewport 1600 × 1000, one page per fresh browser.
- **The comparison's figure** (`rendererPssMb` in `apps/dashboards/plant/e2e/comparison.spec.ts`) is the renderer process's PSS from `/proc/<pid>/smaps_rollup`. It's taken at the end of the 10 s quiet window, about 16 s after load, in a 1280 × 720 viewport. All of a page's dedicated workers live in that one renderer process. `performance.measureUserAgentSpecificMemory()` wasn't usable, because the plant page isn't cross-origin isolated.
- **Per thread:** CDP on each page and worker target. `Runtime.getHeapUsage` gives each V8 heap's used and committed size, its embedder (Oilpan) heap and its ArrayBuffer memory. `HeapProfiler.collectGarbage` on every thread, twice, gives the after-GC ("live") figures. `HeapProfiler.startSampling`, including collected objects, gives each thread's allocation rate and where it allocates, read from an unminified build.
- **Per allocator:** a detailed Chromium memory-infra dump (`Tracing.requestMemoryDump`) gives the renderer's malloc, V8, PartitionAlloc, Oilpan, cc, canvas and shared memory.
- **Ladder:** a minimal page with no plant code ([`bench/memory-ladder`](../../bench/memory-ladder/)) starts one rung per fresh browser and measures renderer PSS after GC, against the same page with nothing started. There are 8 runs per rung; the first run of each set reads about 6 MB high, so medians are used.
- **Runs:** 3 per configuration unless a row says otherwise; medians. The 10-minute rows are single runs. The throwaway placements (`half`, `one`) and the 10-minute runs ran two browsers at a time on separate cores, which splits shared file pages between them, so those rows compare **anonymous** PSS (`Pss_Anon`), which is private to the process.
- The scripts are in [`assets/plant-memory/`](assets/plant-memory/): `probe.mjs` (PSS and allocators), `heaps.mjs` (per thread), `alloc.mjs` (allocation), `ladder.mjs` (ladder rungs).

## Builds, 16 s after load

Renderer PSS in MB. "After GC" is the same page after a forced GC on every thread.

| Build | Workers | PSS | After GC | Collectable |
| --- | --- | --- | --- | --- |
| Native | 0 | 200 | 157 | 43 |
| Native + workers | 9 | 243 | 200 | 43 |
| Isoloop, `machine` | 11 | 400 | 255 | 145 |
| Isoloop, `split` | 19 | 426 | 282 | 144 |
| Isoloop, `shared-engines` | 13 | 386 | | |
| Isoloop, `own` | 106 | 773 | | |

The worker counts include the bus worker; the comparison counts 10 for `machine` because it leaves the bus out. The gap between `machine` and native + workers is **157 MB** before GC and **55 MB** after.

**Ruled out:**
- **Canvas.** Canvas backing stores (10.4 MB), cc tile memory (13–14 MB) and shared memory (about 41 MB on Isoloop, 46 MB on native) are the same in every build, or lower on Isoloop. The 24 transferred canvases cost no more in workers than on the main thread.
- **The main thread.** Its V8 heap after GC is 4–5 MB on Isoloop, against 5–6 MB on the native builds. The host's reports, the supervisor and the appliers don't add to it.
- **Topic retention at 16 s, codec and OPFS buffers.** The bus worker's heap after GC is 2.6 MB used, with 1.6 MB of ArrayBuffers. It holds each retained record once, not once per subscriber. Over time it's a different story: see [Growth over time](#growth-over-time).
- **The app's metrics sampler.** `src/metrics/isoloop.ts` calls `kernel.isolates()` on every animation frame, about 1.6 MB/s of short-lived objects on the main thread. Turning it off changed PSS by less than run-to-run noise (356 against 351 MB before GC, 211 against 216 MB after).
- **Young-generation size.** Capping it (`--js-flags=--max-semi-space-size=1`) took 25 MB off Isoloop and nothing off native, so it's part of the garbage below, not a separate cause.

## The ladder

PSS above the empty page, after GC, in MB. Medians of 8 runs (6 for the rows marked *).

| Rung | Total | Each additional worker or member |
| --- | --- | --- |
| 1 plain worker * | 4.2 | |
| 8 plain workers | 19.1 | 2.1 per worker |
| 1 headless isolate, own worker * | 5.2 | |
| 8 headless isolates, own workers | 25.0 | 2.8 per worker |
| 1 headless isolate in a pool | 5.8 | |
| 8 headless isolates in one pool | 7.1 | 0.2 per member |
| 1 vanilla visual isolate, own worker * | 7.2 | |
| 8 vanilla visual isolates, own workers * | 28.1 | 3.0 per worker |
| 8 vanilla visual isolates in one pool | 9.0 | 0.2 per member |
| 1 React widget in a pool | 9.7 | |
| 8 React widgets in one pool | 17.9 | 1.2 per widget |
| 8 React widgets, own workers | 40.5 | 4.4 per worker |
| 1 React widget on the main thread | 3.5 | |
| 8 React widgets on the main thread | 8.8 | 0.8 per widget |

The React widget is a table of 20 rows by 6 columns, about 140 nodes, rendered once.

- **An idle worker costs about 2 MB**, its thread and V8 isolate. The Isoloop runtime adds about 0.7 MB to that, and a document about 0.2 MB more. React and its adapter add about 1.4 MB more, so an own worker running one React widget costs about 4.4 MB.
- **In a pool, a member costs about 0.2 MB**, and a React widget of this size about 1.2 MB, against 0.8 MB for the same widget on the main thread. The extra 0.4 MB per widget is its worker-side document and the bookkeeping that ties it to the page's nodes, about 3 KB per node at this size.

## The live gap, 55 MB

By allocator, after GC, `machine` minus native + workers: V8 worker heaps +23 MB (old space +13, code +6, bytecode and other trusted objects +4), malloc +21 MB, PartitionAlloc +8 MB, Oilpan in workers +4 MB.

By cause:

- **Each visual pool's own copy of the code, about 45 MB.** Each machine pool loads React, the adapter, `@isoloop/runtime` and `@isoloop/dom`, and the widget and engine modules: 2.6 MB of live V8 heap per pool, against 0.6 MB for a native data worker. The page's main thread holds one copy for all 72 widgets in the native build; the Isoloop build holds nine. Measured directly with two throwaway placements on the plant (machines' widgets and data grouped 4 per pool, `half`, and 8 per pool, `one`): going from 9 visual pools to 3 cut anonymous PSS by 46 MB after GC and 43 MB before. That's about 7.7 MB per plant pool removed, more than the ladder's 4.4 MB, because a plant pool also loads the plant's widget and engine code.
- **The bus worker and the fleet engine, about 8 MB.** Two workers the native + workers build doesn't have: about 2.8 MB each (ladder), plus the bus's 2.6 MB heap.
- **Worker-side documents.** Roughly 3,900 nodes at the ladder's per-node cost would be about 12 MB; it's part of the 45 MB above, since a pool's document lives in its heap.

The rest, a few MB, isn't attributed: malloc thread caches alone are 4 MB higher with 2 more threads.

## The collectable gap, about 100 MB

At the moment of measuring, Isoloop holds about 145 MB that a full GC frees, against about 43 MB on both native builds. That's what makes a single PSS reading swing: it depends on when each heap last collected.

**Where it sits** (`machine`, 16 s, before and after GC):

| Thread | V8 committed, before → after GC | Oilpan, before → after GC |
| --- | --- | --- |
| 8 machine pools | 77 → 28 MB | 16.5 → 2.6 MB |
| Bus worker | 17 → 4 MB | 8.3 → 0.5 MB |
| Page | 18.5 → 5.3 MB | 7.4 → 5.3 MB |
| Fleet pool and fleet engine | 8.3 → 4.0 MB | 1.8 → 0.2 MB |
| *Native + workers, 8 data workers* | *18.5 → 10 MB* | *5.9 → 0.3 MB* |
| *Native + workers, page* | *16.3 → 6 MB* | *6.8 → 5.2 MB* |

The remaining 40 MB or so is outside both heaps' counts: PartitionAlloc's buffer partition (23 → 10 MB), which holds serialized messages still referenced by uncollected `MessageEvent`s, and pages V8 returns to the system after a full GC.

**It doesn't scale with the number of heaps.** The collectable amount (anonymous PSS before minus after GC) is 138 MB with 11 workers (`machine`), 141 MB with 5 (`half`) and 145 MB with 4 (`one`). So it isn't per-heap headroom. It follows how much is allocated.

**Isoloop allocates about twice as much JavaScript.** Allocation, including collected objects, at 16 s:

| | Isoloop `machine` | Native + workers | Native |
| --- | --- | --- | --- |
| Per machine (pool / data worker) | 1.8 MB/s | 0.8 MB/s | |
| Bus worker | 1.6 MB/s | | |
| Page | 3.3 MB/s | 3.3 MB/s | 9.3 MB/s |
| Total | 19.8 MB/s | 9.9 MB/s | 9.3 MB/s |

- The sensor generator allocates the same 0.8 MB/s per machine in every build.
- In each pool, the extra is drawing, which the native builds do on the main thread, plus the runtime's handling of each delivery.
- In the bus worker, it's deserializing each publish, validating it against its schema (`zod`, 0.25 MB/s), the broker's bookkeeping, and serializing each delivery.
- On Isoloop's page, 1.6 MB/s is the app's metrics sampler above and the rest is applying patches. On native + workers' page, the same 3.3 MB/s is React rendering.

**Each record is copied several times, and each copy is garbage.** Per record with *k* subscribing isolates:
1. A `publish` from the producer to the bus, structured-cloned.
2. A `result` back to the producer.
3. *k* `deliver`s, each a fresh structured clone, even when the subscribers share the producer's pool worker (in `machine`, a machine's FFT engine and its waveform both get their own copy of each vibration chunk).
4. *k* `commit`s back to the bus, one per record per subscriber (`autoCommit`).

Each message also leaves an Oilpan `MessageEvent` and a serialized buffer behind. Native + workers posts each record once, to the main thread, and fans it out by reference.

## Growth over time

Renderer anonymous PSS after GC, `machine` against native + workers, single runs:

| | 30 s | 5 min | 10 min |
| --- | --- | --- | --- |
| Isoloop `machine` | 181 MB | 238 MB | 271 MB |
| Native + workers | 114 MB | 147 MB | 157 MB |

Both builds grow for the first 5 minutes as their retention windows fill (5 minutes of slow signals, alarm and event history, growing event-log tables). Native + workers then nearly levels off; its growth is on the page, where its store and the tables live (the page's heap goes from 5 MB to 16 MB, with ArrayBuffers bounded at about 3 MB). Isoloop keeps growing at about 3–4 MB a minute.

**All of it is in the bus worker:** its heap after GC goes from 2.6 MB to 25 MB, and its ArrayBuffers from 1.6 MB to 42.6 MB, between 16 s and 10 min. Every other thread grows by 1–3 MB.

**Cause:** the bus's memory engine (`packages/bus/src/engine/ts-engine.ts`) stores a topic's records in chunks of 4,096 (`CHUNK`). Time-based retention (`#expire`) moves the topic's tail past expired records, but `#freeChunks` only frees whole chunks below the tail, so expired records in the current chunk stay referenced until that chunk fills.

How long a record really stays depends on the topic's rate:

| Topic | Rate per machine | One chunk spans | Retention | Held at worst |
| --- | --- | --- | --- | --- |
| `plant.<M>.spectrum` | 4 a second (2 KB each) | 17 min | 30 s | about 17 min |
| `plant.<M>.vib` | 20 a second | 3.4 min | 30 s | about 3.9 min |
| `plant.<M>.scalars` | 4–10 a second | 7–17 min | 5 min | up to about 22 min |

At 1 kHz, the spectrum topics alone level off near 8 × 4,096 × 2 KB ≈ 70 MB after about 17 minutes. Spectra are the same size at every rate, and come faster at higher rates, so at 5 kHz the same total is reached in about 3.4 minutes.

**A throwaway patch** to the built bus worker clears each expired slot in `#expire`. With it, the bus worker at 10 min holds 12 MB of heap and 3.2 MB of ArrayBuffers (against 25 MB and 42.6 MB without it), about 52 MB less. Every other thread is unchanged. What it still holds is legitimate: 5 minutes of slow signals and the alarm and event history, up to 10,000 records each.

This doesn't touch an ADR: retention already promises to drop these records ([design](../design/system-design.md) §6.1). It's a bug fix in the engine, with a test that a time topic's memory stays bounded at low rates.

## Fixes, by saving

| Fix | Saving (`machine`, 1 kHz) | Kind | ADR |
| --- | --- | --- | --- |
| **1. Free expired slots in the bus's time retention** (clear each slot in `#expire`, or keep time topics in a ring) | 0 at 16 s; measured −52 MB at 10 min (prototype); about 70–80 MB once it levels off (estimate) | Library bug fix | None |
| **2. Fewer, larger visual pools** where the blast radius allows (for example, a few machines per pool) | Measured: −46 MB after GC and −43 MB before (anonymous PSS), going from 9 visual pools to 3 | Placement, in the app; the [pools guide](../guide/pools.md) should say what each pool costs | None: placement is the manifest's choice (ADR 0001) |
| **3. Fewer messages per record:** commit the highest settled offset once per turn instead of once per record; deliver once per pool worker and let the pool's runtime fan the record out to members, instead of one structured clone per member | Not measured. It works on the collectable 100 MB, mainly in the bus and the pools. Both cut messages, and the second cuts copies | Library | Per-pool delivery changes what ADR 0005 says about one port per isolate, and pool members would share record objects (ADR 0001 and 0015 already make pool members trusted). Batching commits fits the bus protocol as it stands, since commits are cumulative offsets |
| **4. Validate less in the bus** | Up to 0.25 MB/s of allocation; small | Library | ADR 0003: the bus validates because it's the trust boundary. Not recommended |
| **5. The app's metrics sampler** | None measurable | App | None |

**Inherent:**
- About 2 MB per worker for its thread and V8 isolate, and about 0.7 MB more for the runtime.
- A framework copy per visual worker. ADR 0015 puts one document in each worker, and ADR 0012 lets members built apart bring their own copy.
- The bus worker (ADR 0005).

These scale with the number of visual workers, which only the placement controls.

**For the comparison itself:** a single PSS reading includes garbage that varies by up to 100 MB depending on when each heap last collected. `compare.ts` could also record PSS after a forced GC on every thread (`HeapProfiler.collectGarbage` over CDP, as `assets/plant-memory/probe.mjs` does). That figure is stable, and it's what a fix to causes 1 and 2 would move.
