# M1: Kernel

**Status:** done. Write-up: [Crashing an isolate on purpose](../posts/m1-crashing-an-isolate.md).

**Goal:** the real host kernel: loader, supervisor with one-for-one restarts, heartbeats, and a frame-budgeted compositor on our own render bridge, `isoloop-dom@1` ([ADR 0010](../adr/0010-own-render-bridge.md)).

**Done when** (RFC 0001): a blocked or crashed isolate never affects the others, proven by Playwright tests.

## Scope

**In:** design sections [§4](../design/system-design.md#4-isoloophost) and [§5](../design/system-design.md#5-isoloopruntime) except the bus client: Loader, Supervisor state machine, Compositor with budget, `RenderBridge` on our own DOM subset ([ADR 0010](../adr/0010-own-render-bridge.md)), component registry, EventBridge, host-owned inputs, host calls (`measure`, `focus`, `scrollIntoView`), Shadow DOM styles, and a vanilla isolate API. `four-loops` moves onto all of it.

**Out:** the log bus (M2; `legacy-bus` stays until then), adapters (M3), `requestCanvas` (M3), `navigate` (landed in M2 task 10, [#46](https://github.com/isoloop/isoloop/pull/46)), devtools (M4).

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

### 4. Remote DOM spike (done)
- Done in draft PR #23 (branch `spike/m1-remote-dom`, never merged). It answered [ADR 0006](../adr/0006-render-bridge-over-remote-dom.md) point 6: (a) records are cloneable, (b) nodes can carry our ids, (c) listener registration can be intercepted. All three were "yes".
- It also found five gaps (no `style`, unsynced properties, missing `HTML*Element` classes, moves sent as remove plus re-insert, hooks to fill in), a deprecated host receiver, and an in-house estimate of about 1,450 lines against about 7,000 adopted.
- **Outcome:** [ADR 0010](../adr/0010-own-render-bridge.md) supersedes ADR 0006. We build our own bridge, and Remote DOM isn't used.

### 4b. Bridge conformance suite
- **Files:** `packages/host/test/render-bridge-conformance.ts`: `runBridgeConformance(makeBridgePair)`, run in Vitest browser mode.
- Cases: create / update / move / remove nodes, attributes and text; keyed list reorders keep node identity and focus; sanitising (I9); node-id mapping both ways; listener registration and event round-trip; host-owned input rules; styles.
- Run it against `legacy-vdom` first (some cases, such as keyed reorders, are expected to fail there and are marked as known gaps), then against every new bridge. (`legacy-vdom` was deleted after M1.)
- Moves to `packages/dom/src/testing` (`@isoloop/dom/testing`) with task 5 ([ADR 0011](../adr/0011-dom-package.md)).

### 5. RenderBridge: `isoloop-dom@1` (isolate and host)
- **Files:** a new package `packages/dom` (`@isoloop/dom`, [ADR 0011](../adr/0011-dom-package.md)), with no runtime dependencies (`/testing` has an optional peer on Vitest):
  - `src/shared/` (record types, `ISOLOOP_DOM_FMT = 'isoloop-dom@1'`), `src/worker/` (the DOM subset from [ADR 0010](../adr/0010-own-render-bridge.md) point 2, the recorder with an `onBatch` hook, `deliver(nodeId, event)`), `src/host/` (the applier with `idFor` / `nodeFor`, event conversion, a required sanitising policy), `src/testing/` (the conformance suite, moved from `packages/host/test`).
  - `tsconfig.{shared,worker,host,testing}.json`, one `lib` each; `typecheck` runs all four. tsdown entries `worker`, `host`, `testing`; no root entry.
  - `package.json` exports `./worker`, `./host`, `./testing`; README marks the package internal.
  - Wiring: `packages/runtime/src/render/` (microtask schedule, `patch` posting, `ctx.root`) over `@isoloop/dom/worker`; `packages/host/src/render/` (`HostRenderBridge` over `@isoloop/dom/host`, the registry from task 6 as its policy). `legacy-vdom` ran the moved suite until it was deleted after M1.
  - `.oxlintrc.json`: `runtime` may import `@isoloop/dom/worker` only, `host` `@isoloop/dom/host` (tests also `/testing`), `dom` no `@isoloop/*`, and `protocol`, `bus` never `dom`.
- **Isolate side:** installs the subset as `document` and the DOM globals only when the isolate has a surface, and exposes `ctx.root`.
- **Fmt check:** a `ready.renderFmt` other than `isoloop-dom@1` (or `'none'` when headless) crashes the isolate with reason `render-fmt-mismatch` and fails it without a restart.
- **Moves** are one `move` record. The host applies records through the registry (task 6) and keeps node identity across moves.
- No dependency. If the task grows past two evenings, split it: the worker-side subset first, then the host applier.
- **Tests (browser):**
  - the conformance suite (task 4b) passes with **no known gaps**;
  - an isolate reporting another `renderFmt` fails with `render-fmt-mismatch` and isn't restarted;
  - a 1,000-node list renders;
  - a batch round-trip leaves identical `innerHTML` on both sides;
  - ~~Preact and React render a small app into the subset~~: moved to the M3 adapters, which bring the frameworks in as devDependencies ([M3a](m3a-adapters.md) task 3).

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
- Rewrite the four isolates on it and delete the `legacy-vdom` paths from the example. The packages' `legacy-vdom` code and the M0 `h`/`view`/`setState` isolate API were removed after M1.
- Change the PoC's crash behaviour to the real supervisor (backoff, limit, Failed state) and update the e2e expectations to match.

### 12. Isolation test suite (the done-criterion)
- **File:** `e2e/isolation.spec.ts`.
- Invariant I2: block C for 3 s → B's displayed clock advances by at least 2.5 s within that window, and main-thread fps stays ≥ 55 (sampled by a rAF counter in the page).
- Invariant I3: crash C 4 times in 60 s → C reaches `failed` and shows the fallback; A, B and D never leave `running`, and their click-to-paint stays within budget.
- Invariant I1: a `MutationObserver` shows no DOM writes to other isolates' surfaces while C restarts.
- Kill path: C in an infinite loop → `crashed` after `killAfterMs`, restarted, others unaffected.
- Headless: a headless fixture isolate (no `surface`) reaches `running`, is supervised the same way (block → kill → restart), never produces DOM writes, and gets `no_surface` from `measure` ([ADR 0008](../adr/0008-isolates-and-surfaces.md)).

### 13. Click-to-paint bench (first cut)
- **Files:** `bench/click-to-paint/`. A Playwright script with 100 clicks on a counter, timing `pointerdown` → the frame that paints the change, compared with the same counter rendered directly in the main thread. Runs in Chromium, Firefox and WebKit, in an `aligned` and a `random` click variant, report-only against the design §9 budget (1 frame in every engine; see the [click-to-paint investigation](../investigations/click-to-paint-latency.md)).
- Run it in CI as a report only (no threshold yet). This calibrates the [budget](../design/system-design.md#9-performance-budgets).

## Risks

- **Own bridge scope** (task 5). The subset is sized to what Preact 11 and React 19 call today. A framework release that calls something new fails the smoke test, and we add the member with a test ([ADR 0010](../adr/0010-own-render-bridge.md) point 7).
- **Input latency** is the RFC's biggest risk. Task 8's tests and task 13's numbers are the evidence; publish them even if they're unflattering.
- **Firefox/WebKit heartbeat timing:** background tabs throttle timers; task 2 pauses hang judgement while hidden and resets clocks on return (I14).

## Demo / write-up

A recording of four-loops: block C, crash C repeatedly until Failed, while B keeps ticking and typing in D stays smooth, with the click-to-paint numbers. Post: "Crashing an isolate on purpose."
