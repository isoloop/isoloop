# M3a: Adapters

**Status:** done, 2026-11-07 (write-up: [Preact and React in a Web Worker](../posts/m3a-preact-react-in-a-worker.md)). First epic of the [M3 initiative](m3-adapters-dashboard.md).

**Goal:** Preact and React adapters with bus and host hooks, on every major we support, plus what both need from the kernel: DOM group 1, the version check for isolates built apart from the host, canvas isolates and a Vite plugin.

**Done when:** the Preact adapter (Preact 10 and 11) and the React adapter (React 18 and 19) pass the adapter conformance suite on every supported major, in CI.

## Scope

**In:** `packages/preact` and `packages/react` ([ADR 0010, frameworks and versions](../adr/0010-own-render-bridge.md#frameworks-and-versions)), per-major CI, DOM usage logs, DOM group 1 ([ADR 0010, beyond the frameworks](../adr/0010-own-render-bridge.md#beyond-the-frameworks)), `force` for host-owned inputs ([should-do](../should-do.md)), the `requires` stamp and `[FLOOR, VERSION]` check ([ADR 0012](../adr/0012-isolates-built-apart.md)), adapter conformance, `requestCanvas`, `@isoloop/vite`, the memory-per-isolate bench.

**Out:** DOM group 2 (queries, HTML parsing, `MutationObserver`, `cloneNode`), which [M3b](m3b-dashboard.md) builds when the dashboard's libraries need it; the dashboard itself; Solid, Svelte and Vue ([would-like](../would-like.md)).

**Order:** task 1 first. Then three tracks can run in parallel: adapters (2, 3, 7–10, 13), the DOM subset (4–6) and the kernel (11, 12, 14–16). Task 17 needs 7 and 9; task 18 closes the epic.

## Tasks

### 1. Adapter packages and the per-major matrix
- **Files:** `packages/preact` and `packages/react` (`package.json`, `tsconfig*.json`, `src/index.ts`), `pnpm-workspace.yaml` (catalog aliases, one exact version per major: `preact10`, `preact11`, `react18`, `react19`, `react-dom18`, `react-dom19`, as `npm:` aliases), `vitest.config.ts` (projects `preact-10`, `preact-11`, `react-18`, `react-19`, each resolving the framework to its alias), `.oxlintrc.json` (adapters may import `@isoloop/runtime` and `@isoloop/protocol` only, never `@isoloop/dom` or `host`).
- `peerDependencies`: `preact: "^10 || ^11"`, `react` and `react-dom: "^18 || ^19"`. Dependabot groups each alias with its major.
- **Tests (browser):** a placeholder test per project asserts the resolved framework's major, so a wrong alias fails CI.

### 2. DOM usage logs per major
- **Files:** `packages/dom/scripts/usage.ts` (renders a fixture app into the subset wrapped in a logging `Proxy`, the way the M1 spike did), `packages/dom/usage/{preact-10,preact-11,react-18,react-19}.json`, a `pnpm dom:usage` script.
- The fixture covers what the adapters will meet: a keyed list that reorders, a controlled input, a `select`, SVG, conditional children, a fragment, and in React 19 a `<title>`.
- **Tests (browser):** a check that every member in every log is implemented by the subset, listing the missing ones. It runs in CI, so a framework update that calls something new fails its Dependabot PR (ADR 0010).

### 3. Framework smoke tests
- Moved from M1 task 5 ([should-do](../should-do.md)). Each framework renders a small app into the subset in a real worker; the host applier output is compared with the same app rendered by the framework into a real DOM.
- React 19 hoists `<title>`, `<meta>` and `<link>` into `document.head`. The subset gets a `head` that the bridge doesn't render, and the kernel warns once in `dev` when something lands there. Rendering them for real waits for a need.
- **Files:** `packages/preact/src/smoke.browser.test.tsx`, `packages/react/src/smoke.browser.test.tsx`, `packages/dom/src/worker/dom.ts` (`document.head`).
- **Tests (browser):** both smoke tests, in every major project.

### 4. DOM group 1: `classList`, `dataset`, `getElementById`, `contains`
- **Files:** `packages/dom/src/worker/dom.ts`, `packages/dom/src/testing/conformance.ts`.
- Worker-only: `classList` and `dataset` read and write the `class` and `data-*` attributes, so they travel as `attr` records; `getElementById` and `contains` walk the worker tree.
- **Tests (browser):** a conformance case per member; `classList.toggle` and `dataset` writes show up as attributes on the host.

### 5. DOM group 1: `DocumentFragment` and comment nodes
- **Files:** `packages/dom/src/shared/records.ts`, `src/worker/dom.ts`, `src/host/applier.ts`, `src/testing/conformance.ts`.
- Inserting a fragment inserts its children (as `insert` and `move` records) and empties it; comments are a new node kind in the `insert` subtree. Nothing is published yet, so `isoloop-dom@1` is amended in place with a short ADR 0010 amendment rather than bumped.
- **Tests (browser):** conformance cases for fragment insertion order, an emptied fragment and a comment round trip.

### 6. `force` for host-owned inputs
- From [should-do](../should-do.md). A `force` flag on the `prop` record; `ctx.setValue(node, value, { force: true })` in the vanilla API; the host applies a forced `value` even to a focused input, and keeps the caret at the end. The ADR 0010 amendment from task 5 covers it.
- **Files:** `packages/dom/src/shared/records.ts`, `src/host/applier.ts`, `packages/host/src/render/registry.ts` (the input rule), `packages/runtime/src/vanilla.ts`.
- **Tests:** browser: a forced value replaces a focused input's value, an unforced one doesn't; E2E (`e2e/inputs.spec.ts`): four-loops' D clears its chat box after sending without blurring it first.

### 7. Preact adapter: rendering and topics
- **Files:** `packages/preact/src/define.ts` (`defineIsolate(Component)` → an `IsolateDefinition` that renders into `ctx.root` and unmounts on shutdown), `src/context.ts` (the `ctx` provider), `src/hooks/topic.ts` (`useTopic(topic, { from })`, `usePublish`).
- `useTopic` keeps the latest value and clears it on `onReset`; `usePublish` returns the `BusClient.publish` promise.
- **Tests (browser, both majors):** a published record re-renders the component; a reset clears it; shutdown unmounts and unsubscribes.

### 8. Preact adapter: requests, host calls, route
- **Files:** `packages/preact/src/hooks/request.ts` (`useRequest`), `src/hooks/host.ts` (`useHost`: `measure`, `focus`, `scrollIntoView`, `navigate`, `requestCanvas` once task 14 lands), `src/hooks/route.ts` (`useRoute()`, which subscribes to `routeTopic` only when a component uses it, [ADR 0002](../adr/0002-host-owns-routing.md)).
- **Tests (browser, both majors):** a request resolves and times out; `measure` returns the host rect; an isolate that never calls `useRoute()` has no route subscription.

### 9. React adapter: rendering and topics
- **Files:** `packages/react/src/define.ts` (`createRoot(ctx.root)`), `src/context.ts`, `src/hooks/topic.ts` (`useTopic` on `useSyncExternalStore`, `usePublish`).
- **Tests (browser, React 18 and 19):** the same cases as task 7, plus: `startTransition` updates render; `StrictMode`'s double effects don't double-subscribe.

### 10. React adapter: requests, host calls, route
- **Files:** `packages/react/src/hooks/{request,host,route}.ts`.
- **Tests (browser, React 18 and 19):** the same cases as task 8.

### 11. Isolates built apart: the `requires` stamp
- [ADR 0012](../adr/0012-isolates-built-apart.md) decision 3. `defineIsolate` in `runtime` and both adapters adds `requires`, from a version constant tsdown writes in at build time. The bootstrap reports it in `ready`.
- **Files:** `packages/runtime/src/vanilla.ts`, `src/bootstrap.ts`, `packages/protocol/src/isolate.ts` (`ready.requires?`), `packages/preact/src/define.ts`, `packages/react/src/define.ts`, the tsdown configs.
- **Tests:** unit: `ready` with and without `requires` passes the guards; browser: a built bootstrap reports the stamp of a fixture isolate.

### 12. Isolates built apart: the `[FLOOR, VERSION]` check
- [ADR 0012](../adr/0012-isolates-built-apart.md) decisions 4 and 5. The host compares `requires` with its `VERSION` and `FLOOR`; outside the range the isolate goes to `failed` with `runtime-too-old` or `isolate-too-old`, final, the message naming both versions. A `deprecated(member)` helper warns once per member when `KernelConfig.dev` is set.
- **Files:** `packages/host/src/supervisor/machine.ts` (the two reasons, final like `render-fmt-mismatch`), `packages/host/src/kernel.ts`, `packages/host/src/version.ts` (`VERSION`, `FLOOR`).
- **Tests:** unit: supervisor rows for both reasons, no restart; browser: fixture isolates stamped above, inside and below the range; an unstamped `{ start }` runs.

### 13. Adapter conformance suite
- One fixture app per adapter and major, run through the same E2E suite: render, events, host-owned inputs, a crash and replay, a route change.
- **Files:** `e2e/isolates/adapters/{preact,react}/` (the fixture, built once per major through the catalog aliases), `e2e/adapters.spec.ts`.
- **Tests (E2E, Chromium, Firefox, WebKit):** the suite, for all four framework majors. This is the epic's done-criterion.

### 14. `requestCanvas`
- Design [§4.7](../design/system-design.md#47-host-calls). The host takes the `<canvas>` it rendered for the node, calls `transferControlToOffscreen()`, and returns the `OffscreenCanvas` as a transferable; a `ResizeObserver` sends `event { type: 'resize' }`. Headless isolates get `no_surface`. Replaces `unsupported`, and updates [ADR 0008](../adr/0008-isolates-and-surfaces.md) and the design.
- **Files:** `packages/host/src/kernel.ts` (host calls), `packages/host/src/compositor.ts` (only to look up the node), `packages/runtime/src/host-calls.ts`, `packages/protocol/src/isolate.ts`.
- **Tests:** browser: the returned canvas is an `OffscreenCanvas`, a second request for the same node rejects, a resize arrives; E2E: a canvas isolate draws a red square, checked with a screenshot.

### 15. Vite plugin: dev server
- **Files:** `packages/vite/src/index.ts` (`@isoloop/vite`), `src/dev.ts`.
- Serves `bus-worker.js` and `bootstrap.js`, exposes their URLs as `virtual:isoloop/workers` for `KernelConfig.workers`, and sets the dev headers the hosting guide lists (CSP, and COOP/COEP when asked for).
- **Tests (unit, Node):** a Vite dev server with the plugin serves both bundles and the headers; `examples/four-loops` switches from `?worker&url` to the plugin and the E2E suite stays green.

### 16. Vite plugin: builds
- **Files:** `packages/vite/src/build.ts`.
- Builds the isolate entries listed in the plugin options as separate worker-importable ES modules, and writes a manifest of their URLs for the host. Isolates built from another repository use the same plugin in library mode.
- **Tests (unit, Node):** a build emits one module per isolate and the manifest; four-loops' production build passes the E2E suite.

### 17. Memory per isolate
- `bench/memory-per-isolate`: 10 idle isolates each of vanilla, Preact and React; reports heap per isolate against the [§9](../design/system-design.md#9-performance-budgets) targets (3 / 5 / 12 MB). Report only, in CI's `bench` job. Answers M3's risk about React's bundle size per isolate.
- **Tests:** the bench runs in CI and writes to `bench-results`.

### 18. Demo and write-up
- A Preact and a React isolate side by side in four-loops, sharing a topic, both crashable.
- Post: "Preact and React in a Web Worker": the DOM subset, what each major needed, and the memory numbers from task 17.

## Risks

- **React 19's resource hoisting** (task 3) may need more than an unrendered `head`, for example for stylesheets with `precedence`. If it does, rendering hoisted elements into the shadow root gets its own task.
- **Per-major E2E** (task 13) quadruples the adapter E2E runs. If CI time grows past the job timeout, run E2E on the newest major per framework and keep browser tests on all four.
- **`useSyncExternalStore` and suspension:** a suspended isolate's store goes away and comes back; check that tearing can't show a stale value after a wake.
