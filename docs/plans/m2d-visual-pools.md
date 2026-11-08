# M2d: Visual pools

**Status:** planned 2026-11-08; starts after [M2c](m2c-worker-pools.md).

**Goal:** visual isolates (isolates with a surface) can share a pooled worker, each with its own scoped `isoloop-dom` document, so an app can group about 8 widgets per worker instead of one worker per widget.

**Why:** [ADR 0001](../adr/0001-one-worker-per-isolate.md) and [ADR 0010](../adr/0010-own-render-bridge.md) allow only headless isolates in pools, because the render bridge installs one global `document` per worker. Dashboards with dozens of widgets reach the soft budget of 32 workers long before they run out of work to do; the plant dashboard ([M3d](m3d-plant-dashboard.md)) has 72.

**Done when:** the plant dashboard ([M3d](m3d-plant-dashboard.md)) ships with its pooled build: 72 widgets in 9 visual pools of about 8, each widget rendering into its own surface, and a hang in one widget restarting only its own pool.

**Depends on:** [M2c](m2c-worker-pools.md) (pool bootstrap, group supervision). Amends ADR 0001 and ADR 0010, which needs the user's approval (task 0).

## Decisions (grilling, 2026-11-08)

1. **Split from M2c.** Headless pools first (M2c); visual pools here, on top of the same pool mechanics.
2. **The ADR comes first and goes to the user.** Task 0 drafts the amendment; forks don't approve ADRs. No implementation merges before it's accepted.
3. **Grouping is the app's choice,** declared in the host manifest (ADR 0001). The plant dashboard groups by machine: about 8 widgets per pool.
4. **Same fault story, stated plainly.** A hang in one pooled widget stalls and then restarts its whole pool; other pools and own-worker isolates are unaffected. The demo shows that trade-off rather than hiding it.
5. **Hypothesis for the gate.** Pooling visual isolates saves memory and startup time per widget. Each member still carries its own framework code, so the saving may be smaller than for headless isolates; task 1 measures it, and if it's under about 30% memory with no faster startup, M2d stops and reports.

## Tasks

### 0. ADR draft: scoped documents in a pooled worker
- Draft an amendment to ADR 0001 (visual isolates may join a pool) and ADR 0010 (one `isoloop-dom` document per isolate, not per worker) for the user's approval. Options to compare, with a recommendation:
  - **Bundle-time binding:** `@isoloop/vite` rewrites an isolate's free references to `document`, `window` and the DOM globals to its own scoped instance, so each member's framework copy sees only its own document.
  - **Switching the global per task:** set `globalThis.document` before running a member's code. Simple, but unsafe across `await` and timers.
  - **Realms:** `ShadowRealm` isn't available in workers on any engine yet; noted as the long-term option.
- Covers what's shared (event loop, timers, `globalThis`), event routing per surface, and the seam ([ADR 0012](../adr/0012-isolates-built-apart.md)): separately built isolates must still work, or the limit is stated.
- **Acceptance:** the user accepts the ADR.

### 1. Benchmark gate
- Prototype: 8 React widgets in one worker with scoped documents, against 8 own workers; memory and startup on three engines (decision 5).
- **Acceptance:** numbers recorded; stop if the gate fails.

### 2. Scoped documents in `@isoloop/dom`
- One DOM subset instance per member; patches and events carry the isolate id; the host applier routes them to the right surface.
- **Tests:** unit (two documents in one worker don't see each other's nodes); browser (two React members render into two surfaces).

### 3. Binding the globals
- The mechanism the ADR chose (for example the `@isoloop/vite` transform), with React and Preact adapters running unchanged.
- **Tests:** the adapter conformance suites pass with two members per worker, on every supported major.

### 4. Lift `pools_headless_only`
- `spawn` accepts `pool` on visual isolates; group supervision (M2c) restarts every member and re-renders each surface.
- **Tests (browser):** a hanging widget restarts its pool's surfaces; other pools keep drawing.

### 5. Host calls and events per member
- `measure`, `focus`, `scrollIntoView` and the event bridge carry the member id; a member can't reach another member's surface.
- **Tests:** browser, including a member that tries to address another's node.

### 6. E2E and devtools data
- Fixture with two visual pools of three, one own-worker widget; kill, hang and throw cases on all three engines. Kernel reports each surface's pool.

### 7. Docs and prerelease
- Guide section on visual pools and their shared fate; the ADR's consequences in the design doc; changeset; prerelease for the plant dashboard ([M2c](m2c-worker-pools.md) decision 8).

## Open risks

- **Frameworks reaching for globals** the binding misses (`window.addEventListener`, `queueMicrotask` ordering, module-level caches). The conformance suites in task 3 are the check.
- **Separately built isolates** may not get the binding if it's done at bundle time; the ADR has to say whether they can join a visual pool.
- **One member's long render delays its neighbours' frames.** That's the cost of sharing an event loop; measured in the plant dashboard.
- **The gate may fail** if per-widget framework code dominates memory.
