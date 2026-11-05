# Investigation: click-to-paint latency

- **Date:** 2026-11-05
- **Question:** M1's click-to-paint bench (`bench/click-to-paint`, #35) reported about 31 ms at p95, against an 8 ms overhead budget (design §9). About 13 ms of that looked like the host → worker → host round trip, which should take about 1 ms. Where does the time go?
- **Answer:** the round trip takes 0.2 ms. The 13 ms is Chromium holding the worker's reply until the next frame has rendered, because a real input event just happened. The patch then misses that frame and paints one frame later. The rest of the 31 ms is the wait for the next frame, which the main thread pays as well. The bench hid that by stopping the main-thread timer before the frame.

## Method

Temporary probes recorded `performance.timeOrigin + performance.now()` at each step of a click, so the clocks of the page and the worker line up:

1. `pointerdown` and `click` on the surface (from the event's `timeStamp`);
2. the EventBridge sending the `event` message (`host/src/events.ts`);
3. the worker receiving it, the handler returning, and the recorder posting the `patch` (`runtime/src/vanilla.ts`, `runtime/src/render/index.ts`);
4. the host receiving the `patch` (`host/src/kernel.ts`), the compositor requesting a frame and its rAF callback (`host/src/compositor.ts`);
5. the `MutationObserver` that sees the new count.

The worker's stamps travelled to the host inside the `patch` message. A separate rAF loop logged every frame. Each run was 60 Playwright clicks on the bench's counter isolate, headless, on this machine (WSL2). The probes were removed afterwards. The results are reproducible with the bench and the variants below.

## Results

Per segment, ms, p50 / p95. Firefox and WebKit report time in whole milliseconds.

| Segment | Chromium | Chromium, deferral off | Firefox | WebKit |
| --- | --- | --- | --- | --- |
| `click` → event sent | 0.4 / 0.6 | 0.4 / 0.6 | 0 / 1 | 1 / 1 |
| event sent → worker receives | 0.2 / 0.3 | 0.0 / 0.1 | 1 / 2 | 1 / 1 |
| handler + recorder flush | 0.1 / 0.2 | 0.1 / 0.2 | 0 / 1 | 0 / 1 |
| `patch` posted → host receives | **13.7 / 14.3** | 0.1 / 0.3 | 0 / 1 | 0 / 0 |
| frame requested → rAF | **16.4 / 16.6** | 13.7 / 14.2 | 14 / 15 | 12 / 13 |
| rAF → change applied | 0.1 / 0.2 | 0.1 / 0.2 | 0 / 1 | 0 / 1 |
| **Total, `pointerdown` → applied** | **30.9 / 31.4** | **14.4 / 14.8** | **16 / 17** | **13 / 14** |
| Round trip, event sent → `patch` received | 14.0 / 14.5 | 0.2 / 0.3 | 0 / 1 | 0 / 1 |

In one Chromium sample, frames fell at −4.4, 12.3 and 29.0 ms relative to `pointerdown`. The worker posted the patch at 1.7 ms. The host received it at 12.7 ms, just after the 12.3 ms frame, and applied it in the 29.0 ms frame.

## Hypotheses tested

1. **Chromium defers tasks after real input until the next frame: confirmed.** Several tests point the same way:
   - **Synthetic input:** `pointerdown`/`click` dispatched from page script reduce the round trip to 0.2 / 0.4 ms. The same holds when they're dispatched from a timer at a random point in the frame.
   - **Control tasks:** a main-thread `setTimeout(0)` and a `MessageChannel` message, queued from the click handler with no worker involved, also wait 14.4 / 14.9 ms.
   - **Feature off:** launching Chromium with `--disable-features=DeferRendererTasksAfterInput` brings the round trip to 0.2 / 0.3 ms and the controls to 0.5 / 0.7 ms.

   That's Chromium's `DeferRendererTasksAfterInput`. After a discrete input event, it holds ordinary tasks, posted messages included, until the next frame has rendered, to improve responsiveness (INP). It's on in the Chromium build Playwright ships (`chromium-1248`). Whether it's on by default in stable Chrome wasn't checked.
2. **Worker messages always line up with frames: rejected.** Without real input the patch arrives in 0.1 ms, and Firefox and WebKit never show the delay.
3. **The main thread was busy (Playwright, hit-testing): rejected.** The delay always ends just after a frame, and the control tasks show the thread was free but held back.
4. **The compositor misses a frame: a consequence, not a cause.** It requests a frame as soon as a patch arrives (0.0 ms). The patch arrives just after a frame, so the next one is a full frame away.
5. **Microtask batching, structured clone, heartbeat traffic, isolate startup: ruled out.**
   - The recorder flush takes 0.0–0.1 ms.
   - Posting and receiving take 0.1 ms with the deferral off.
   - Heartbeats run every 100 ms and never landed in a sample window.
   - The bench waits for the counter's first render before it measures. The tight spread, with p50 and max within 1 ms, rules out startup outliers.
6. **Timer clamping in headless browsers: not a factor.** Firefox and WebKit report time in whole milliseconds, which limits precision but doesn't add delay.

## The bench was biased

The bench (#35) stopped the main-thread counter at its synchronous DOM change (0.4 ms). It stopped the isolate at the compositor's frame. But the main-thread change only reaches the screen at the next frame too. Measured to that frame, the main thread takes 14.7 / 14.9 ms in Chromium, because Playwright clicks a few ms after a frame (its click waits on rAF to check that the element is stable). So the true overhead in Chromium is **one frame (16.3 / 16.5 ms)**, not 31 ms. In Firefox and WebKit it's about **zero frames**, as long as the patch arrives before the next frame.

Playwright's frame-aligned clicks also make the wait for the next frame look worse than it is for real users. With clicks at random points in the frame (the timer variant), Chromium's frame wait was 9.0 / 16.3 ms.

## Root cause

A message from the worker can't be painted until a frame after it arrives. In Chromium, a real click holds that message until the next frame has rendered. So every isolate click in Chromium paints exactly one frame later than the same change made on the main thread. The cost is about 16.7 ms at 60 Hz. It isn't caused by Isoloop's code, the `isoloop-dom` format or the bus: any design that renders from a worker through `postMessage` pays it. Firefox and WebKit don't defer these tasks, and pay no extra frame.

## Recommendations

1. **Fix the bench (done, #39).** Both sides now end at the frame that paints the change. Chromium overhead p50 / p95 went from 30.7 / 30.9 to 16.3 / 16.5 ms.
2. **Recalibrate the budget (design §9): done.** An 8 ms overhead can't be met in Chromium with message passing. The budget is now at most one frame on Chromium and at most 8 ms on Firefox and WebKit, report-only for now ([design §9](../design/system-design.md#9-performance-budgets)).
3. **Run the bench in Firefox and WebKit too, report-only: done.** The bench runs in all three engines, in an `aligned` and a `random` variant; see *Follow-up* below for the numbers and what the random variant showed.
4. **Getting the frame back means not waiting for the message.**
   - **Idea:** the worker writes its batch into a `SharedArrayBuffer`, and the compositor reads it in the very next rAF, with no task to defer. That would win back about 16.7 ms per click in Chromium.
   - **Cost:** it needs cross-origin isolation (COOP/COEP), a shared-memory render channel next to `isoloop-dom@1`, and an ADR.
   - **Where it fits:** M5, the shared-memory engine, already makes the same trade for the bus. It should benchmark a render channel alongside it rather than build one now.
   - **Tracked:** [M5 plan](../plans/m5-shared-memory-engine.md), item 7.
5. **Check it with real input.** These numbers come from Playwright's synthetic input in headless browsers. One run in headed Chrome with real mouse clicks would confirm that the deferral, and the extra frame, affect real users the same way. A recording with DevTools' Performance panel is enough. **Open:** this needs a person at a browser.
6. **Not worth chasing:** the round trip itself (0.2 ms), structured clone, and microtask batching. None costs more than 0.3 ms.

## Reproducing

- **The bench:** `pnpm bench:click-to-paint` (Chromium, Firefox and WebKit; `aligned` and `random` variants; 100 clicks per side; report-only). Results land in `bench-results/click-to-paint-<browser>-<variant>.json`.
- **The deferral:** add `launchOptions: { args: ['--disable-features=DeferRendererTasksAfterInput'] }` to the bench's Chromium project. The isolate's p50 drops from about 31 ms to about 14 ms.
- **The segment breakdown:** put back probes at the points listed under Method. They weren't kept, because they touch four files in two packages for a one-off measurement.

## Follow-up: all three engines

Headless, local, 100 clicks per side, p50 / p95 in ms. Firefox and WebKit coarsen timers to whole milliseconds.

| Engine | Variant | Isolate | Main thread | Overhead |
| --- | --- | --- | --- | --- |
| Chromium | aligned | 31.0 / 31.4 | 14.5 / 14.8 | 16.5 / 16.6 |
| Chromium | random | 31.2 / 31.4 | 14.5 / 14.8 | 16.7 / 16.6 |
| Firefox | aligned | 16 / 18 | 1 / 2 | 15 / 16 |
| Firefox | random | 16 / 17 | 1 / 2 | 15 / 15 |
| WebKit | aligned | 14 / 14 | 14 / 14 | 0 / 0 |
| WebKit | random | 14 / 14 | 14 / 14 | 0 / 0 |

What this adds:

- **The random variant doesn't randomise where clicks land.** Each click waits for a frame plus a random 0–16 ms, yet `pointerdown` still arrives 2–3 ms after a frame (phase p95 3 ms on Chromium, 1.6 ms on Firefox). The engines deliver Playwright's input aligned to their frames, whatever the delay before it. So the frame wait seen here is how these browsers schedule synthetic input, not a quirk of when Playwright sends it. Only real input (recommendation 5) can show the phase real users see. The bench keeps the variant and reports the phase, so a change in input scheduling shows up.
- **Firefox is over its 8 ms budget by about one frame.** It doesn't defer the patch, but it runs a frame right after input (the main-thread counter paints in 1–2 ms), so a change that arrives from a worker a moment later waits for the next one. The overhead is a frame there too, for a different reason.
- **WebKit pays no overhead:** it doesn't render a frame straight after input, so the main thread waits a full frame as well, and the worker's patch arrives in time for it.

