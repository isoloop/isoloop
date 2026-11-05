# Crashing an isolate on purpose

*M1 write-up, 2026-11-05*

M1's promise was one sentence: **a blocked or crashed isolate never affects the others, proven by Playwright tests.** That sentence is now a test file, [`e2e/isolation.spec.ts`](../../e2e/isolation.spec.ts). It runs on every PR in Chromium, Firefox and WebKit, against the [four-loops demo](https://isoloop.github.io/isoloop/).

## What the suite does to isolate C

- **Blocks it for 3 s.** B's clock, in its own worker, advances by at least 2.5 s during the block. The page keeps its frame rate: 55+ fps in Chromium and Firefox. WebKit on the CI runner is the exception (see below).
- **Crashes it four times in a row.** Three restarts with backoff follow, then C goes `failed` and shows the kernel's fallback with a Retry button. Meanwhile A, B and D don't change state once, a `MutationObserver` sees no DOM writes in A's or D's surfaces, and clicks on A keep painting.
- **Spins it in an infinite loop.** The heartbeat stops, the supervisor kills the worker after `killAfterMs` with reason `unresponsive`, and C comes back. Nobody else notices.
- **Does the same to a headless isolate.** It's supervised in exactly the same way. It never gets a surface, never writes to the DOM, and has no `document`. `measure` answers `no_surface`.

## What M1 built to make that true

- **Supervisor:** a pure state machine (loading → running → blocked → crashed → restarting or failed), with one-for-one restarts, backoff, a restart limit, and hang judgement paused while the tab is hidden.
- **Render bridge:** our own, `@isoloop/dom` ([ADR 0010](../adr/0010-own-render-bridge.md), [ADR 0011](../adr/0011-dom-package.md)).
  - **Isolate side:** a DOM subset in each worker, sized to what Preact and React call, recorded as plain id-keyed records. A move is one record.
  - **Host side:** applies those records through a sanitising registry. The same conformance suite runs against every bridge.
- **Compositor:** the only code that writes to surfaces. Each frame it gives isolates turns, one batch at a time, within an 8 ms budget.
- **EventBridge and host-owned inputs:** typing never loses a character, even while the isolate is blocked, and a form submit never navigates the page.
- **Host calls** (`measure`, `focus`, `scrollIntoView`) run after pending patches. **Styles** go into constructable stylesheets on the shadow root.
- **The vanilla isolate API:** `export default defineIsolate({ start(ctx) { … } })`.

## The unflattering numbers

[`bench/click-to-paint`](../../bench/click-to-paint) times `pointerdown` until the new count is in the DOM, over 200 clicks. On CI, headless Chromium:

| | p50 | p95 |
| --- | --- | --- |
| isolate | 31.9 ms | 32.1 ms |
| same counter on the main thread | 0.4 ms | 0.5 ms |

The budget is an overhead of **≤ 8 ms at p95**, and we're at about 31 ms. Roughly 13 ms is the round trip to the worker and back, which should be closer to 1 ms. The rest is waiting for the next frame. Both are the first things to look at; the bench runs in CI on every PR so the effect of each fix shows up.

**The WebKit exception:** on the 4-core CI runner, headless WebKit drops from 56 to 40–48 fps while C spins a core. The suite records that number for WebKit instead of asserting it, until we understand why.

## Next

M2 replaces M0's main-thread bus with the log bus in its own worker (topics, schemas, offsets, replay), so isolates talk to each other without the main thread at all.
