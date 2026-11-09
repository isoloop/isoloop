# Investigation: engine constraints Isoloop runs into

- **Date:** 2026-11-08 (§9 added 2026-11-09)
- **Question:** which limits of today's browsers and engines shape what Isoloop can do, how much does each cost us, and what do we do about it?
- **Answer:** the biggest one is structural: a document has exactly one thread that can touch its DOM, so everything an isolate shows passes through the page's main thread. Most of the others are consequences of that, or limits on how we can measure it. On Playwright's Linux WebKit, showing frames that workers draw on transferred canvases costs main-thread time, and at the markets dashboard's Heavy size it is most of Isoloop's typing latency there (§2). Each section gives a repro, the impact on Isoloop, what we do today, and what an engine without the limit would do.

## Why keep this list

Isoloop's premise is that code which shares data shouldn't share an event loop. Browsers give that to code, through workers, but not to rendering: a worker has no DOM, and the one thread that has it is shared by everything on the page. Isoloop's render bridge (`isoloop-dom@1`, [ADR 0010](../adr/0010-own-render-bridge.md)) works within that by sending each isolate's changes to the page, where the compositor applies them within a per-frame budget.

A longer-term question, and not a plan: what would an engine look like if each isolate could own its DOM subtree on its own thread? The isolate↔host protocol doesn't depend on how the host side is implemented, so an engine like that could implement the host side natively and run the same isolates. This list is what such an engine would have to address, gathered from measurements rather than guesses. Today the useful reading is narrower: these are the costs Isoloop's numbers carry, and where they come from.

## 1. One DOM thread per document

- **What:** only a document's main thread can read or change its DOM, layout and style. Workers have no `document` (HTML Standard, workers section). Every surface an isolate renders is applied by the page's main thread: DOM batches in the compositor, canvas frames by the engine's presentation path (§2), `measure` answers, focus and scrolling.
- **Repro:** any Isoloop page. `kernel.debug` counts the batches the compositor applies, and the metrics panel shows main-thread time per category (M3c task 10).
- **Impact:** Isoloop can move widgets' *computation* off the main thread, but not the cost of *showing* what they computed. On the markets dashboard in Chromium, the main thread does about 5 ms/s of DOM applying at Normal and about 10 ms/s at Heavy, nearly all of it for DOM widgets (M3c task 10 measurements, 4 cores). A widget whose output changes the DOM often costs main-thread time whatever thread computed it.
- **Today:** the compositor applies batches within an 8 ms frame budget and rotates which surface goes first ([system design §4](../design/system-design.md)). Widgets coalesce: a chart draws at most once per frame (examples #35). Canvas widgets draw in the worker.
- **The alternatives a page has:** none with a DOM *and* its own thread, except a cross-site iframe in a browser that gives it its own process (§7).
- **An engine without the limit:** per-subtree DOM ownership, where a worker-like context owns a shadow tree, its style and layout, and the page composes the results, the way it already composes iframes and canvases.

## 2. WebKit presents worker-drawn canvas frames through the main thread

- **What:** in Playwright's WebKit on Linux, every frame a worker draws on an `OffscreenCanvas` transferred from the page (`transferControlToOffscreen`) costs the page's main thread time, outside any JavaScript. With enough canvas updates per second the main thread stops running frames and timers. Chromium doesn't show this.
- **Environment:** Playwright 1.64.1, headless; WebKit 27.2 and Chromium 156.0.8078.4; Linux under WSL2, 32 cores, no GPU. Not checked in Safari on macOS or iOS, or on a GPU-backed WebKit.

**Standalone repro, no Isoloop code:** [`assets/webkit-offscreen-freeze.html`](assets/webkit-offscreen-freeze.html). N workers each draw a sine line on a transferred 320×180 canvas R times a second; the page only counts its own animation frames. The page also runs the same load two other ways, to compare on a real device: `bitmap` (each worker draws on its own `OffscreenCanvas` and posts the frame with `transferToImageBitmap`; the page shows the newest frame per canvas in its animation frame through `bitmaprenderer` and acks, so a worker skips draws until then) and `main` (the page draws on plain canvases itself, as a native build does). **Run all** goes through every mode at six loads and gives a table and JSON to copy. The table below is the original `transfer` case; medians of 3 one-second readings after 5 s:

| Workers × draws/s | Canvas updates/s | WebKit frames/s | WebKit longest frame gap | Chromium frames/s |
| --- | --- | --- | --- | --- |
| 4 × 10 | 40 | 62 | 29 ms | 60 |
| 24 × 2 | 48 | 44 | 97 ms | 60 |
| 8 × 10 | 80 | 52 | 43 ms | 60 |
| 12 × 10 | 120 | 34 | 73 ms | 60 |
| 24 × 5 | 120 | 20 | 154 ms | 60 |
| 16 × 10 | 160 | 10 | 104 ms | 60 |
| 24 × 10 | 240 | page stops: a 5 s timer hadn't fired after 60 s | – | 60 |
| 8 × 30 | 240 | page stops, as above | – | 60 |

The cost grows with updates per second and with the number of canvases (24 × 5 is worse than 12 × 10 at the same 120 updates/s).

**In the markets dashboard:** Isoloop React at Heavy (24 widgets, 17 of them canvases), on WebKit and Chromium, with parts switched off through URL flags on a throwaway branch (`diag/webkit-main-thread` in isoloop/examples, not merged). Typing latency is measured as `budget.spec.ts` does it. A main-thread probe posts a message to itself every 25 ms and records how long it waits; time inside `requestAnimationFrame` callbacks (where the compositor applies DOM batches) and inside `message` listeners is summed separately. 3 runs each, one page at a time, after 10 s of warm-up; medians, with the range in brackets:

| WebKit, Heavy | Typing latency | Frames/s | Probe wait, p95 | Probes answered in 8 s (of ~320) | JS in rAF, ms/s | JS in `message`, ms/s |
| --- | --- | --- | --- | --- | --- | --- |
| Isoloop, as is | 166 ms [138–169] | 28 | 125 ms | 24 | 16 | 2.2 |
| Isoloop, canvas widgets off | 32 ms [31–32] | 62 | 0 ms | 317 | 12 | 2.1 |
| Isoloop, DOM widgets off (canvases on) | 113 ms [111–163] | 35 | 15 ms | 95 | 1.9 | 0.7 |
| Isoloop, canvases drawn in the workers but not presented | 33 ms [31–34] | 62 | 1 ms | 315 | 12 | 2.4 |
| Isoloop, canvases not presented and DOM batches not applied (messages only) | 30 ms [29–30] | 62 | 1 ms | 318 | 2.1 | 1.5 |
| Isoloop at Normal, as is | 77 ms [55–120] | 51 | 8 ms | 186 | 13 | 1.7 |
| native, as is | 8 ms [7–10] | 45 | 1 ms | 292 | 44 | 0 |
| native, canvas widgets off | 10 ms [9–12] | 62 | 0 ms | 317 | 6.6 | 0 |
| native at Normal, as is | 8 ms [8–9] | 62 | 1 ms | 295 | 29 | 0 |

On Chromium the same variants give Isoloop 27–29 ms and native 5–6 ms at Heavy, at 60 frames/s, with no variant changing either by more than 2 ms.

What the numbers show, on this WebKit:

- **Presenting worker canvases is most of the main-thread cost.** Removing the canvas widgets, or keeping them drawing in their workers without presenting, brings Isoloop at Heavy from 166 ms to 32–33 ms and frames back to 62/s. Keeping only the canvases (DOM widgets off) leaves it at 113 ms.
- **It isn't JavaScript.** Isoloop's main-thread JS, the compositor and the message handlers, is 2–18 ms per second in every variant, while the probe shows the thread unavailable for most of each second (24 of ~320 probes answered). The time goes to the engine's own work for those canvases.
- **DOM applying and messages are small here.** With canvases not presented, applying every DOM batch adds about 3 ms to typing latency over messages only (33 against 30 ms).
- **About 30 ms remains in every Isoloop variant, on both engines.** The alerts panel itself runs in a worker, so each keystroke goes to the worker and back and waits for a frame (§3). Native's panel answers on the main thread in 5–10 ms.
- **Native draws the same charts on the main thread for 44 ms/s of JS and keeps typing at 8 ms**, because drawing on a main-thread canvas doesn't carry the per-update cost transferred canvases do here. It runs at 45 frames/s at Heavy.

Earlier local numbers (examples #35's investigation) were higher, 348 ms at Heavy, from runs with three browsers in parallel; these runs are one page at a time.

- **Impact:** on this WebKit, the more canvas widgets an Isoloop page has, the more the main thread is taken by presenting them, which is the opposite of what moving drawing into workers is for. Isoloop's typing latency at Heavy on WebKit was 138–169 ms in these runs, under its 200 ms budget, but over it in the CI runner's full test run and in earlier parallel local runs; it is the main WebKit difference from native.
- **Today:** each canvas draws at most once per frame (examples #35, the same code on every build), which stopped the page from freezing at Heavy. Ideas that would cut presents further are in [would-like](../would-like.md#rendering): fewer, shared canvases, or a page-wide pace for canvas updates. A WebKit bug report with the repro is drafted, not filed.
- **An engine without the limit:** presenting a worker's canvas frame on the compositor thread, without a main-thread task per frame, as Chromium appears to.

## 3. Chromium holds a worker's reply until after the next frame following input

- **What:** after a real input event, Chromium delays delivering a worker's message to the main thread until the next frame has rendered. The patch for a click then misses that frame and paints one frame later.
- **Repro and data:** [click-to-paint latency](click-to-paint-latency.md) (2026-11-05): the host → worker → host round trip takes 0.2 ms, but about 13 ms of the measured 31 ms p95 is the held reply.
- **Impact:** an isolate's response to input reaches the screen one frame later than the same response from main-thread code. That is part of the fixed per-interaction cost Isoloop's typing latency carries in every size (about 30 ms against 5–10 ms in §2's runs, on both engines; 34 ms against 11 ms calm in the M3b comparison on Chromium).
- **Today:** measured and documented; no workaround in user space. Shared memory would avoid the message hop (§5).
- **An engine without the limit:** a way to mark a worker message as part of the current interaction, so it is delivered before the frame.

## 4. No per-module realm in a worker

- **What:** a worker has one global object and one set of built-in prototypes. Browsers offer no way to run two modules in one worker with separate globals (ShadowRealm isn't shipped).
- **Repro:** two modules loaded into one worker share `globalThis`; one patching `Array.prototype` changes it for the other.
- **Impact:** [ADR 0001](../adr/0001-one-worker-per-isolate.md) makes one worker per isolate the default because pooling isolates in one worker shares their event loop, fate and globals. Pools ([M2c](../plans/m2c-worker-pools.md)) stay opt-in, for small trusted isolates, and visual isolates can't be pooled at all until a surface can be scoped per isolate: the render bridge installs one `document` per worker. Memory grows with the number of isolates: the markets dashboard at Heavy runs 30 workers.
- **Today:** own worker per isolate; a soft budget of 32 workers with a devtools warning; pools planned for headless isolates.
- **An engine without the limit:** cheap realms (ShadowRealm or similar) in a worker, so several isolates could share a thread for memory while keeping separate globals.

## 5. Shared memory and memory measurement need cross-origin isolation

- **What:** `SharedArrayBuffer` and `performance.measureUserAgentSpecificMemory()` are only available on a cross-origin isolated page, which needs the `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` response headers. Static hosts that don't let you set headers, GitHub Pages among them, can't serve such a page.
- **Repro:** the public markets demo on GitHub Pages: its metrics panel shows memory as "unavailable" ([M3b post](../posts/m3b-markets-dashboard.md)). `crossOriginIsolated` is `false` there.
- **Impact:** zero-copy reads between isolates ([M5](../plans/m5-shared-memory-engine.md)) and per-worker memory figures only work where the host controls headers. COEP also blocks cross-origin embeds that don't opt in, which limits who can turn it on.
- **Today:** `@isoloop/vite` sets COOP/COEP in dev and preview when asked (`crossOriginIsolated: true`, [hosting guide](../guide/hosting.md)); shared memory stays opt-in with a message-based fallback; memory benchmarks run locally in Chromium.
- **An engine without the limit:** a way for a page to share memory with its own workers without isolating the whole page from cross-origin content.

## 6. No OPFS in Playwright's WebKit

- **What:** Playwright's WebKit build has `createSyncAccessHandle` on the prototype, but `navigator.storage.getDirectory()` throws `UnknownError`, even in a persistent context. Real Safari works.
- **Repro and data:** [OPFS support](opfs-support.md).
- **Impact:** persistent topics can't be tested end to end on WebKit in CI. The bus falls back to memory topics and reports `bus:durability-degraded { reason: 'open-failed' }`; the OPFS-only tests skip there.
- **Today:** Chromium and Firefox cover durability in CI; WebKit runs the fallback path.
- **An engine without the limit:** this is a test-build gap, not a browser limit.

## 7. Cross-site iframes get their own thread only with site isolation

- **What:** an iframe has its own document, but it gets its own main thread only when the browser puts it in a separate process, which Chromium (site isolation) and Firefox (Fission) do for cross-site frames. Same-site frames share the page's main thread. Whether and when WebKit does this by default hasn't been checked here.
- **Repro:** not measured yet.
- **Impact:** the only way today to give a widget its own DOM *and* its own thread is a cross-site iframe per widget, at the cost of a process each, a separate site (domain, not path) each, and layout and styling across frame boundaries. It might not help with §2 either: frames from every process still end up in the same compositor.
- **Today:** the design plans an "iframe tier" for hostile code ([system design §11](../design/system-design.md)): a cross-origin sandboxed iframe that hosts an isolate's worker and relays the same protocol. Using it for performance is noted as a possible option in [would-like](../would-like.md), not planned.
- **An engine without the limit:** see §1.

## 8. CPU throttling doesn't apply to workers (measurement)

- **What:** Chromium's CPU throttling (CDP `Emulation.setCPUThrottlingRate`, the same setting as DevTools' "CPU: 4× slowdown") slows the page's main thread but not its dedicated workers, and worker targets don't accept the call.
- **Repro and data:** measured in Chromium 156 with a fixed loop: 18 ms on the main thread unthrottled and 73 ms at 4×; 18 ms in a worker in both; on the worker target, `'Emulation.setCPUThrottlingRate' wasn't found` (examples, `apps/markets/comparison/README.md`).
- **Impact:** a throttled run slows native's widgets and not Isoloop's, so it isn't a like-for-like slower device. The markets comparison has no throttled column for that reason, and throttled screenshots taken by hand in DevTools favour Isoloop the same way.
- **Today:** comparisons run unthrottled, on real core counts (`taskset`), and on real devices.
- **An engine without the limit:** throttling that applies to the whole renderer, workers included.

## 9. WebKit evaluates a module worker's entry again when it's imported by URL

- **What:** in a module worker, when one of the worker's own modules imports the worker's entry script by its URL, WebKit evaluates the entry a second time, as a separate module instance with its own top-level state and listeners. Chromium and Firefox return the entry from the worker's module map, as the HTML Standard intends. This is [WebKit bug 324459](https://bugs.webkit.org/show_bug.cgi?id=324459), fixed in WebKit's main branch as [323507@main](https://commits.webkit.org/323507@main) on 2026-10-12; no Safari release is named on the bug yet.
- **Repro:** [`webkit-worker-entry-reimport.html`](assets/webkit-worker-entry-reimport.html), one file, no library code: the entry counts its evaluations, and on a message imports a module that imports `import.meta.url`. Chromium 156 and Firefox 157: 1 evaluation, one reply per message. Playwright's WebKit 27.2: 2 evaluations, two replies per message.
- **Impact on Isoloop:** bundlers put code shared with the lazily loaded `vanilla` chunk into the bootstrap's chunk, so `vanilla` imported the worker's entry back, and every isolate worker on WebKit got a second bootstrap with its own `message` listener.
  - **Own workers:** the second copy never received an `init` (the host sends one, before the copy exists) and posted nothing: checked on WebKit with the production builds of the E2E harness and the four-loops example, counting `init`, patches, `ready` and bus publishes per bootstrap copy. Behaviour and the WebKit figures in §2 and the M3c write-up are unaffected; the cost was one extra module evaluation per worker.
  - **Pools (M2c, M2d):** the second copy booted a restarted member a second time and called `self.close()` when that copy left, so the pool's heartbeat stopped and the whole pool restarted after a member's second restart.
- **Today:** the bootstrap starts once per worker, under a `Symbol.for('isoloop.bootstrap')` marker on the worker's global, and a second copy stays inert (with a warning in Vite dev). `@isoloop/vite` loads `@isoloop/runtime/worker`, a tiny entry that holds the host's messages, imports the bootstrap and replays them, so no chunk imports the entry; a build test checks that. Isolates built apart that start the bootstrap directly rely on the guard. The M2d E2E restarts a pooled widget repeatedly on all three engines.
- **An engine without the limit:** the worker's top-level module script is registered in the module map under its URL, which is what 323507@main does.
