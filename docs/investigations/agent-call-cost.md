# Investigation: what one agent call costs the page

- **Date:** 2026-11-19
- **Question:** what does one call to an exposed tool cost the page it runs in? Every agent transport ends in the same call, `kernel.request` from the main thread ([ADR 0018](../adr/0018-tools-for-agents.md), decision 4): the dev MCP's page side and `connectWebMCP` both make it. How long is the round trip, and how much main-thread time does a call take, on an idle page and under load? This is [M4a](../plans/m4a-agents.md) task 13 (decision 20), recorded whatever it shows. Native has no bus, so there's no native baseline.
- **Answer:** on the dedicated bench machine, with one call in flight, a round trip took **0.15 ms on average on an idle page in Chromium and 0.24 ms on plant at 5 kHz**; in Firefox, **0.60 ms idle and 1.48 ms at 5 kHz**, with a p95 of 6 ms there. Each call took about **0.035 ms of main-thread time on idle Chromium and 0.059 ms at 5 kHz** (spread 0.050 to 0.084), measured on Chromium only. Issuing the call itself, until `kernel.request` returned its promise, took 0.011 to 0.035 ms per call across the four cases.
  - These are the call's own costs, with a handler that does nothing. The transport's hop (the dev MCP's WebSocket, WebMCP's browser side), the agent's own latency and the tool's handler work all come on top and weren't measured.
  - For scale, as arithmetic, not a measurement: at the 5 kHz figure, 100 calls a second would be about 6 ms of main-thread time per second. Plant's own main thread runs at about 25% at that load ([the feed-cost run](inspect-feed-cost.md)).

## Method

- **Page:** plant (`isoloop/web`, `apps/dashboards/plant`), Isoloop build. Plant has no requestable topic, so a build made with `PLANT_AGENT_COST=1` adds one, `plant.bench.ping.v1` (`{ n, sentAt }`, the same schema for the reply), and a headless isolate that answers each call with its own value. The round trip is host → bus worker → the ping isolate's worker → bus worker → host. The flag is a build-time constant: without it the topic, the isolate and the runner are compiled out, and the deployed and measured builds are byte for byte the same (every output file's SHA-256 compared before and after, in isoloop/web#187).
- **Why plant and a build flag:** decision 20 names plant at 5 kHz, and a bench page in this repo would have had to rebuild plant's load. A topic added at run time would have changed every build's contracts module; a build flag changes nothing outside the bench build.
- **Two pages,** interleaved per round, one at a time: `?agent=idle` (the kernel, the bus and the ping isolate, nothing else) and `?rate=5&seed=7&placement=matched` (plant's 10 workers at 5 kHz, as in the feed-cost run).
- **Per page and mode** (1 call in flight, then 8), after a warm-up (3 s idle, 6 s at 5 kHz): 3 pairs of a 2 s quiet window and a burst of 500 calls, then a burst of 1,000 calls issued back to back without awaiting.
  - **Round trip:** `performance.now()` before `kernel.request` to its reply, per call; the mean also from each burst's wall time over its calls (times the calls in flight).
  - **Main thread per call, Chromium only:** CDP `Performance.getMetrics` `TaskDuration` over each burst, less the page's own rate measured in the quiet windows beside it, over the calls. Firefox has no such counter.
  - **Issuing one call:** the burst of 1,000, timed from the first `kernel.request` to the last one returning its promise, over 1,000.
- **5 rounds.** Each figure below is the median of the 5 per-round figures, with the lowest and highest round in brackets.
- **Machine:** the dedicated bench machine (AMD Ryzen 7 5825U), bench mode on (cores fixed at 2.0 GHz, other containers paused), the container pinned to `--cpuset-cpus=2,4,6,8`, `mcr.microsoft.com/playwright:v1.65.0-noble` (Playwright 1.65.0: Chromium headless shell 158, Firefox 159), 2026-11-19.
- **Library:** `@isoloop/*@0.1.0-next.5` from npm (tag `v0.1.0-next.5`, `9c0f138`).
- **Raw results:** `isoloop/web` `apps/dashboards/plant/comparison/agent-cost/` (each run's JSON with every round trip, and `summary.md`), with the flag, the ping isolate and the spec, in [isoloop/web#187](https://github.com/isoloop/web/pull/187).

## Results

One call in flight:

| Figure | Chromium, idle | Chromium, 5 kHz | Firefox, idle | Firefox, 5 kHz |
| --- | --- | --- | --- | --- |
| Round trip, mean (ms) | 0.15 (0.15 to 0.15) | 0.24 (0.24 to 0.27) | 0.60 (0.60 to 0.61) | 1.48 (1.36 to 1.58) |
| Round trip, median (ms) | 0.1 (0.1 to 0.1) | 0.2 (0.2 to 0.2) | 1 (1 to 1) | 1 (1 to 1) |
| Round trip, p95 (ms) | 0.3 (0.3 to 0.3) | 0.4 (0.4 to 0.4) | 1 (1 to 1) | 6 (5 to 7) |
| Main thread per call (ms) | 0.035 (0.034 to 0.035) | 0.059 (0.050 to 0.084) | – | – |
| Issuing one call (ms) | 0.011 (0.010 to 0.012) | 0.023 (0.020 to 0.025) | 0.027 (0.027 to 0.028) | 0.035 (0.034 to 0.044) |
| Calls per second | 6,599 (6,539 to 6,614) | 4,154 (3,665 to 4,192) | 1,674 (1,636 to 1,678) | 674 (633 to 736) |

Eight calls in flight:

| Figure | Chromium, idle | Chromium, 5 kHz | Firefox, idle | Firefox, 5 kHz |
| --- | --- | --- | --- | --- |
| Round trip, mean (ms) | 0.62 (0.61 to 0.63) | 0.84 (0.75 to 0.90) | 2.81 (2.79 to 2.86) | 7.15 (6.53 to 8.32) |
| Round trip, p95 (ms) | 0.8 (0.8 to 0.8) | 2.2 (1.5 to 3.0) | 4 (4 to 4) | 14 (13 to 17) |
| Main thread per call (ms) | 0.030 (0.030 to 0.030) | 0.041 (0.035 to 0.043) | – | – |
| Calls per second | 12,853 (12,799 to 13,078) | 9,512 (8,855 to 10,737) | 2,852 (2,799 to 2,868) | 1,119 (962 to 1,224) |

- **Reading the tables:**
  - **Under load:** at 5 kHz, a round trip took about 1.6 times as long as idle on Chromium (mean 0.24 against 0.15 ms) and about 2.5 times on Firefox (1.48 against 0.60 ms). Firefox's tail grew most: p95 6 ms at 5 kHz against 1 ms idle.
  - **Main thread:** the call's main-thread time on Chromium was 0.035 ms idle and 0.059 ms at 5 kHz, with the widest spread there (0.050 to 0.084), since plant's own main-thread work is most of what the subtraction removes.
  - **Several in flight:** 8 at once roughly doubled the calls per second on Chromium and raised them by 1.7 times on Firefox, with longer round trips each; the main-thread time per call was a little lower than with one in flight.
  - **Chromium and Firefox:** with one call in flight, Firefox's round trips were 4 to 6 times Chromium's on the same page, and its issue time 1.5 to 2.5 times. These runs don't say where the difference is (worker messaging, structured clone, the bus worker's own work).
- **Timer resolution:** Chromium's `performance.now()` is 0.1 ms here (the page isn't cross-origin isolated) and Firefox's 1 ms, so the medians and p95s come in those steps. The means come from wall time over many calls, and the issue time from 1,000 calls, so they resolve below that.

## Caveats

- **The call, not the agent.** A handler that does nothing, one topic and one answering isolate. A real tool's handler work, the transport's hop and the agent's own time come on top.
- **One page, one load, one machine.** Plant at 5 kHz is heavy for the bus. Another app's load, or a busy answering isolate, changes the round trip.
- **Retention and bursts.** The first server run's topic kept 100 records (`last-n`, as markets' tools do), and its burst of 1,000 calls issued at once failed: a call of the burst (in Chromium at 5 kHz, the 756th) got no reply within 10 s. With 2,000 records the same burst completed in every run. The 100-record retention looks like the cause, since calls past it can be dropped before the answering isolate reads them, but this run doesn't prove it. Agents usually call one tool at a time; an app that expects bursts of calls should size the topic's retention for them, and this is worth a test in the bus.
- **No native baseline:** native has no bus, so there's nothing to compare the call with.
- **Five rounds** show how much the rounds varied, not the uncertainty of a gap; there's no pair here, only each case's own spread.
