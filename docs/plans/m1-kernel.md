# M1: Kernel

**Goal:** the real host kernel: loader, supervisor with one-for-one restarts, heartbeats, and a frame-budgeted compositor on Remote DOM.

**Done when** (RFC 0001): a blocked or crashed isolate never affects the others, proven by Playwright tests.

## Scope

**In:** design sections [§4](../design/system-design.md#4-isoloophost) and [§5](../design/system-design.md#5-isoloopruntime) except the bus client: Loader, Supervisor state machine, Compositor with budget, `RenderBridge` on Remote DOM ([ADR 0006](../adr/0006-render-bridge-over-remote-dom.md)), component registry, EventBridge, host-owned inputs, host calls (`measure`, `focus`, `scrollIntoView`), Shadow DOM styles, and a vanilla isolate API. `four-loops` moves onto all of it.

**Out:** the log bus (M2; `legacy-bus` stays until then), adapters (M3), `requestCanvas` and `navigate` (M3), devtools (M4).

## Tasks

### 1. Supervisor state machine
- **Files:** `packages/host/src/supervisor/{machine.ts,timers.ts,index.ts}`.
- A pure `step(state, input) → { state, effects }` following the [transition table](../design/system-design.md#43-supervisor), plus a sliding restart window and exponential backoff.
- **Tests (unit, fake clock):** one test per row of the table; restart limit (3 in 60 s → `failed`); window slides; `never` strategy; `respawn` resets.

### 2. Supervisor runtime wiring
- Connect the machine to real workers: worker `error`/`messageerror` events, heartbeat ingestion, a 50 ms tick, effects carried out by the kernel. Kernel events `isolate:state`, `isolate:crash`, `isolate:failed`, `isolate:error`.
- Busy overlay and failed fallback UI in the isolate shell. The host can override the fallback via `manifest.fallback` (a render function on the host).
- Hidden and frozen tabs ([ADR 0001](../adr/0001-one-worker-per-isolate.md#what-the-browser-still-controls)): pause hang judgement while `document.hidden`; reset every heartbeat clock on `visibilitychange` to visible and on the Page Lifecycle `resume` event.
- **Tests (browser):** a fixture isolate that loops forever → `blocked` then `crashed` after `killAfterMs` (set short in tests); an isolate that throws in `start` → `failed` after the limit; hiding the page (Playwright page visibility emulation) for longer than `killAfterMs` and showing it again restarts nothing (I14).

### 3. Loader hardening
- Bootstrap module worker ([design §4.2](../design/system-design.md#42-loader)). Cross-origin `src` via `import()`; ready timeout; `shutdown` with grace on stop.
- Docs page `docs/guide/hosting.md` with the required CSP and CORS headers.
- Placement rules from [ADR 0001](../adr/0001-one-worker-per-isolate.md): `manifest.pool` is typed and validated but rejected with `pools_unsupported`; the soft worker budget (`workers.budget`, default 32) emits a warning when passed and never blocks a spawn; a failed `new Worker` becomes `isolate:crash` with reason `spawn-failed`, using the normal backoff and restart limit (freeing memory by suspending idle isolates arrives with suspension in M2). `manifest.suspend` is typed now; any value other than `'never'` is rejected with `suspend_unsupported` until M2.
- **Tests (E2E):** an isolate served from a second origin (a second Vite server on another port) with CORS loads; without CORS it fails with a clear `isolate:crash` reason. A manifest with `pool` is rejected with `pools_unsupported`; spawning past the budget warns once and still starts the isolate.

### 3b. Browser feature check
- `createKernel` checks the features Isoloop relies on (module workers, `MessageChannel` transfer, Shadow DOM with `adoptedStyleSheets`, OPFS sync access handles in workers) and throws one error, code `unsupported_browser`, listing what's missing. Add the code to [design §3](../design/system-design.md#3-isoloopprotocol).
- Record the exact minimum Chrome, Firefox and Safari versions in [ADR 0009 rule 7](../adr/0009-toolchain.md#rules) (Baseline widely available, `target: es2022`).
- **Tests (browser):** each feature stubbed out in turn makes `createKernel` throw `unsupported_browser` naming it; the real browsers pass.

### 4. Remote DOM spike (timebox: one evening)
- Pin the current `@remote-dom/core` version. In a scratch branch, render a vanilla tree in a worker and mirror it on the host through its connection API.
- Answer three questions in the PR description ([ADR 0006](../adr/0006-render-bridge-over-remote-dom.md) point 6): (a) are mutation records plain, structured-cloneable data? (b) can remote nodes map to our own ids? (c) can we intercept listener registration?
- Also **estimate an in-house bridge**: which DOM APIs Preact and React actually call during render (log them through a Proxy on the shim), and a rough line count for our own worker-side DOM subset plus mutation recording. Record it in the PR, so replacing Remote DOM later is a costed option.
- **Exit:** if (a), (b) or (c) is "no", stop and write a follow-up ADR choosing between patching Remote DOM and building our own bridge (starting from `legacy-vdom` and the estimate).

### 4b. Bridge conformance suite
- **Files:** `packages/host/test/render-bridge-conformance.ts`: `runBridgeConformance(makeBridgePair)`, run in Vitest browser mode.
- Cases: create / update / move / remove nodes, attributes and text; keyed list reorders keep node identity and focus; sanitising (I9); node-id mapping both ways; listener registration and event round-trip; host-owned input rules; styles.
- Run it against `legacy-vdom` first (some cases, such as keyed reorders, are expected to fail there and are marked as known gaps), then against every new bridge.

### 5. RenderBridge (isolate and host)
- **Files:** `packages/runtime/src/render/remote-dom.ts`, `packages/host/src/render/remote-dom.ts`, the shared fmt constant `remote-dom@1`.
- The isolate side installs the polyfill, exposes `ctx.root`, and batches mutations per microtask into one `patch`. The host side implements `HostRenderBridge`.
- **Tests (browser):** passes the conformance suite (task 4b) with no known gaps; a 1,000-node list; a batch round-trip leaves identical `innerHTML` on both sides.

### 6. Component registry and sanitising
- **Files:** `packages/host/src/render/registry.ts`.
- Safe-tag allow-list, attribute and URL rules, unknown tags → `div`, host components via `KernelConfig.components`.
- **Tests (unit):** sanitiser tables (invariant I9) including `javascript:` URLs, `srcdoc`, `on*`, SVG `<script>`, and `<use href>`.

### 7. Compositor with frame budget
- Per-isolate FIFO, rotating start index, budget check, at-least-one rule ([design §4.4](../design/system-design.md#44-compositor)); `stats()`.
- **Tests (unit, fake rAF/clock):** invariant I8; fairness (a chatty isolate with 100 queued batches doesn't starve an isolate with 1); stopping an isolate drops its queue.

### 8. EventBridge, default actions, inputs
- Per-root delegated listeners; listener registrations from the isolate; event serialization; `submit`/link prevention; host-owned input rules ([design §4.6](../design/system-design.md#46-eventbridge-and-inputs)).
- **Tests (E2E):** typing fast into an isolate input never loses characters or jumps the caret while the isolate is blocked for 1 s; a form submit never navigates the page.

### 9. Host calls
- `call`/`result` plumbing with timeouts; `measure`, `focus`, `scrollIntoView` applied after pending patches.
- **Tests (browser):** `measure` returns the rect after a pending resize patch, not before.

### 10. Styles
- `ctx.styles(css)` → constructable stylesheets on the shadow root; design tokens via custom properties.
- **Tests (browser):** isolate CSS doesn't leak out; host token variables reach in.

### 11. Vanilla isolate API and four-loops migration
- `packages/runtime/src/vanilla.ts`: `export default { start(ctx) }` with plain DOM calls on `ctx.root`.
- Rewrite the four isolates on it and delete the `legacy-vdom` paths from the example (they stay in packages only for benchmarks).
- Change the PoC's crash behaviour to the real supervisor (backoff, limit, Failed state) and update the e2e expectations to match.

### 12. Isolation test suite (the done-criterion)
- **File:** `e2e/isolation.spec.ts`.
- Invariant I2: block C for 3 s → B's displayed clock advances by at least 2.5 s within that window, and main-thread fps stays ≥ 55 (sampled by a rAF counter in the page).
- Invariant I3: crash C 4 times in 60 s → C reaches `failed` and shows the fallback; A, B and D never leave `running`, and their click-to-paint stays within budget.
- Invariant I1: a `MutationObserver` shows no DOM writes to other isolates' surfaces while C restarts.
- Kill path: C in an infinite loop → `crashed` after `killAfterMs`, restarted, others unaffected.
- Headless: a headless fixture isolate (no `surface`) reaches `running`, is supervised the same way (block → kill → restart), never produces DOM writes, and gets `no_surface` from `measure` ([ADR 0008](../adr/0008-isolates-and-surfaces.md)).

### 13. Click-to-paint bench (first cut)
- **Files:** `bench/click-to-paint/`. A Playwright script with 200 clicks on a counter, timing `pointerdown` → applied frame, compared with the same counter rendered directly in the main thread.
- Run it in CI as a report only (no threshold yet). This calibrates the [budget](../design/system-design.md#9-performance-budgets).

## Risks

- **Remote DOM fit** (task 4 is the gate). Fallback: keep `legacy-vdom` and extend it with keyed diffing, as ADR 0006 allows.
- **Input latency** is the RFC's biggest risk. Task 8's tests and task 13's numbers are the evidence; publish them even if they're unflattering.
- **Firefox/WebKit heartbeat timing:** background tabs throttle timers; task 2 pauses hang judgement while hidden and resets clocks on return (I14).

## Demo / write-up

A recording of four-loops: block C, crash C repeatedly until Failed, while B keeps ticking and typing in D stays smooth, with the click-to-paint numbers. Post: "Crashing an isolate on purpose."
