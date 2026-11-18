# Investigation: what the inspection feed costs a running page

- **Date:** 2026-11-18
- **Question:** what does an open inspection feed ([ADR 0020](../adr/0020-inspection-feed.md)) cost the page it inspects: a devtools panel or the dev MCP reading `kernel.inspect()` the whole time, with and without memory per isolate? And how large is the ring buffer the kernel keeps from start, read or not? This is [M4b](../plans/m4b-devtools.md) task 6. ADR 0020 asserts no budget until these numbers exist.
- **Answer:** on the dedicated bench machine, on the plant dashboard at 5 kHz in its default placement (`matched`), the open feed's cost was small next to the round-to-round spread on most figures. The clearest gap is about **+1 pp of total CPU** on cross-origin-isolated Chromium, where the feed also measures memory. Most spreads straddle zero; one figure went the other way (Firefox recovered faster with the feed open in all 5 rounds, not explained). The ring buffer holds its 200 events from the first seconds of the page, about **18 KB as JSON** on Chromium and 15 KB on Firefox.
  - That's this load on this machine, not a proof that the feed is free. A median gap always lies within its own lowest-to-highest spread, so the spread only shows how much the rounds varied: about 3 pp for main-thread CPU and up to 20 pp for total CPU here. Five rounds can't separate a gap of +1 pp from that.
  - No budget is proposed from one run. A budget can follow once CI's report-only `inspect` job has a few weeks of runs.

## Method

- **Page:** plant (`isoloop/web`, `apps/dashboards/plant`), Isoloop build, `?rate=5&seed=7&placement=matched`, 10 workers. `?inspect=1` ([`src/isoloop/inspect.ts`](https://github.com/isoloop/web/blob/main/apps/dashboards/plant/src/isoloop/inspect.ts)) calls `kernel.inspect()` at start and keeps one `on()` reader for the whole run, counting the messages, as an open panel would. Every Isoloop run, open or not, reads `snapshot().events` at the end of the window for the ring buffer's size.
- **Pairs:** `isoloop:matched` (A) against `isoloop:matched+inspect` (B), interleaved A, B, A, B, 5 rounds, one page at a time, `--hold 0`, through plant's comparison runner (`comparison/run.ts`, the same spec as the plant write-up: 6 s warm-up, a 10 s window, 5 keystrokes, a 3 s block of T3's gauges).
- **Two runs:**
  1. **Chromium, cross-origin isolated:** `PLANT_COI=1` makes the preview server send COOP/COEP and runs full Chromium, because the headless shell has no `measureUserAgentSpecificMemory()`. B's feed measured memory per isolate: 1, 1, 2, 2 and 2 measurements in rounds 1 to 5, with 105, 105, 210, 137 and 210 isolate figures, at Chromium's pace (it answers at its next garbage collection). Both sides ran isolated, so the pair measures the feed, not the headers.
  2. **Chromium (headless shell) and Firefox, not isolated:** no memory measurement.
- **Machine:** the dedicated bench machine (AMD Ryzen 7 5825U), bench mode on (cores fixed at 2.0 GHz, other containers paused), the container pinned to `--cpuset-cpus=2,4,6,8` (4 physical cores), `mcr.microsoft.com/playwright:v1.65.0-noble` (Chromium 158, Firefox from Playwright 1.65), 2026-11-18.
- **Library:** this repo's main at `ce4dc9a`, packed locally (`pnpm pack`), because `kernel.inspect()` wasn't on npm yet. It includes the feed (#247, #248, #255), memory per isolate (#259) and the bus fix of #256.
- **Raw results:** `isoloop/web` `apps/dashboards/plant/comparison/inspect/` (`coi-results/`, `results/`), with each run's JSON and `summary.md`, added with the `?inspect=1` switch, the `+inspect` configuration and the CI job in [isoloop/web#170](https://github.com/isoloop/web/pull/170).

## Results

Median gap B − A over the 5 rounds, with its spread (lowest to highest round). A's median is given for scale. Firefox gives no CPU or memory figures.

| Figure | Chromium, isolated | Chromium | Firefox |
| --- | --- | --- | --- |
| Main-thread CPU (A) | 24% | 25% | – |
| Main-thread CPU, gap | −0 pp (−2 to +1) | +0 pp (0 to +0) | – |
| CPU, all threads (A) | 111% | 112% | – |
| CPU, all threads, gap | +1 pp (−7 to +1) | −3 pp (−13 to +7) | – |
| Memory, first reading, after GC (A) | 327 MB | 274 MB | – |
| Memory, first reading, after GC, gap | +1 MB (−9 to +4) | −1 MB (−3 to +10) | – |
| Typing, median of 5, gap | +8 ms (−9 to +25) | +1 ms (−10 to +24) | +16 ms (−33 to +33) |
| Late frames, gap | 0 (0 to 0) | 0 (0 to 0) | +1 (−1 to +2) |
| Recovery after a 3 s block, gap | +75 ms (−63 to +130) | +55 ms (−84 to +88) | −110 ms (−297 to −4) |
| First data, gap | −46 ms (−126 to +21) | −22 ms (−75 to +27) | −58 ms (−192 to +31) |
| Data gaps on T3 and the other machines | 0.0 s | 0.0 s | 0.0 s |

- **Reading the table:**
  - **Spreads that straddle zero:** main-thread CPU on isolated Chromium (−2 to +1 pp), memory after GC, late frames on Firefox, Chromium's recovery, all-thread CPU on headless Chromium, and typing on every engine. Main-thread CPU on headless Chromium (0 to +0 pp) and late frames on Chromium (0 to 0) show no gap at all.
  - **Memory before GC:** the first reading is +3 MB (−3 to +7) on isolated Chromium and +4 MB (+2 to +7) on headless Chromium, where every round had the feed side higher; after a forced GC both straddle zero.
  - **Leaning one way:** on isolated Chromium, all-thread CPU's median gap is +1 pp, the top of its spread (−7 to +1): most rounds had the feed side at about +1 pp. Typing there is +8 ms (+31%) at the median, with a spread of −9 to +25 ms.
  - **The other way:** on Firefox, recovery after the 3 s block was faster with the feed open in every round (−297 to −4 ms, median −110 ms). There is no explanation for it yet: with the feed open, the only extra work is on the main thread, where the reader gets events, beats and metrics.
- **What the reader got** by the end of the measuring window, about 20 s after navigation: 316 events (start-up, then the block's crash and restart), 17 to 19 coalesced beat messages and as many bus-metrics messages, and on the isolated run 1 or 2 memory messages.
- **The ring buffer:** 200 events in every Isoloop run, open or not: 18.0 KB as JSON on isolated Chromium, 17.7 KB on Chromium, 15.4 KB on Firefox. Plant's start-up alone sends more than 200 events, so the buffer is full within the page's first seconds and stays at about that size; it's bounded by its count, not by time.
- **Memory per isolate** measured on B in the isolated run is part of the isolated run's gaps above; its +1 pp of total CPU is the only gap there that leans one way. The isolated run's memory is about 50 MB higher than the other run's on both sides (327 MB against 274 MB after GC); that's full Chromium against the headless shell, plus the headers, and it's the same for A and B.

## Caveats

- **One page, one load, one machine.** Plant at 5 kHz in `matched` is heavy for the bus but sends few kernel events once it's running. An app that crashes and restarts isolates often sends more events, and every one reaches an open reader at once (ADR 0020, decision 2).
- **The reader does nothing.** A real panel draws what it receives, in its own worker (devtools decision 4); that drawing is the panel's cost, not the feed's, and these runs don't include it.
- **The tap and `records()` weren't open.** A live record log adds a copy of up to 50 records a second (decision 3). M4b's panel tasks measure that with the panel.
- **Typing and recovery vary widely** between rounds on every engine (spreads of 34 to 66 ms for typing, 170 to 300 ms for recovery).
- **Firefox gives no CPU or memory figures** in this comparison (they come from Chromium's CDP and `/proc`).

## Rerunning it

```bash
# isoloop/web, once @isoloop/* on npm has kernel.inspect()
PLANT_COI=1 pnpm --filter ./apps/dashboards/plant compare:pairs \
  --pair isoloop:matched=isoloop:matched+inspect --rates 5 --rounds 5 --hold 0 \
  --engines chromium --out comparison/inspect/coi-results
pnpm --filter ./apps/dashboards/plant compare:pairs \
  --pair isoloop:matched=isoloop:matched+inspect --rates 5 --rounds 5 --hold 0 \
  --engines chromium,firefox --out comparison/inspect/results
```

On the bench machine, inside the `plant-compare` image, as plant's comparison README describes. CI runs a 3-round version weekly and after each `plant-v*` deploy, in the *Comparison (plant)* workflow's `inspect` job, report-only.
