# M2d: Visual pools

**Status:** built 2026-11-09 (tasks 0–7; [ADR 0015](../adr/0015-visual-pools.md) accepted, gate passed). Its done-when is met when the plant dashboard ([M3d](m3d-plant-dashboard.md)) ships.

**Goal:** visual isolates (isolates with a surface) can share a pooled worker, alone or together with headless members, each rendering into its own root in the worker's one `isoloop-dom` document ([ADR 0015](../adr/0015-visual-pools.md)), so an app can group about 8 widgets per worker instead of one worker per widget.

**Why:** [ADR 0001](../adr/0001-one-worker-per-isolate.md) and [ADR 0010](../adr/0010-own-render-bridge.md) allow only headless isolates in pools, because the render bridge installs one global `document` per worker. Dashboards with dozens of widgets reach the soft budget of 32 workers long before they run out of work to do; the plant dashboard ([M3d](m3d-plant-dashboard.md)) has 72.

**Done when:** the plant dashboard ([M3d](m3d-plant-dashboard.md)) ships with its Isoloop build in the default `split` placement: 72 widgets in 9 visual pools of about 8, each widget rendering into its own surface, and a hang in one widget restarting only its own pool.

**Depends on:** [M2c](m2c-worker-pools.md) (pool bootstrap, group supervision). Amends ADR 0001 and ADR 0010, which needs the user's approval (task 0).

## Decisions (grilling, 2026-11-08)

1. **Split from M2c.** Headless pools first (M2c); visual pools here, on top of the same pool mechanics.
2. **The ADR comes first and goes to the user.** Task 0 drafts the amendment; forks don't approve ADRs. No implementation merges before it's accepted.
3. **Grouping is the app's choice,** declared in the host manifest (ADR 0001). The plant dashboard groups by machine: about 8 widgets per pool.
4. **Mixed pools are allowed.** A pool can hold headless and visual members together, for example a machine's feed and engines with its widgets (the plant dashboard's `machine` placement). Supervision, budget and grants treat them the same way.
5. **Same fault story, stated plainly.** A hang in one pooled widget stalls and then restarts its whole pool; other pools and own-worker isolates are unaffected. The demo shows that trade-off rather than hiding it.
6. **Hypothesis for the gate.** Pooling visual isolates saves memory and startup time per widget without making updates noticeably slower. Members built together share one framework instance ([ADR 0015](../adr/0015-visual-pools.md)); members built apart carry their own, so they save less. Task 1 measures it; M2d stops and reports if the saving is under about 30% memory with no faster startup, or if the pooled p95 update latency is more than twice the own-worker p95 and over 50 ms.
7. **Option D from ADR 0015** (agreed in grilling, Q31–Q36; the ADR is accepted when the user merges it): one `isoloop-dom` document per worker and one render root per member, rather than binding the globals at bundle time. Members can read each other's DOM and input, so pooling is the host's explicit opt-in and secrets stay on their own worker; moving a node between members' roots is an error; each member gets a portal root; React and Preact members may share a pool.

## Tasks

### 0. ADR: visual isolates in pools
- [ADR 0015](../adr/0015-visual-pools.md): one `isoloop-dom` document per worker, one render root per member (option D), compared with bundle-time binding, switching the global per task, one document per member, and `ShadowRealm`, with spike evidence. Covers what members share, records and events per member, errors, isolates built apart (ADR 0012) and the portal root.
- **Acceptance:** the user accepts the ADR.

### 1. Benchmark gate
- Prototype: 8 React widgets in one worker with one document and a root per member, against 8 own workers, on three engines. Measures memory, startup, and the p95 time from a record being published to its patch being applied, with the 8 widgets updating at the plant dashboard's data rate (decision 6).
- **Acceptance:** numbers recorded; stop if the gate fails on either condition.

### 2. A root per member in `@isoloop/dom`
- One document per worker with one render root per member; records attributed to the member whose root holds the node and posted per member with `isolate`; the host applier takes the member's root id. Moving a node from one member's root into another's throws, attributed to the mover.
- **Tests:** unit (two roots in one document send separate batches; a cross-member move throws and names the mover); browser (two React members render into two surfaces).

### 3. Adapters: per-member error boundary and portal root
- `@isoloop/react` and `@isoloop/preact` wrap each member root in a boundary that reports render errors to that member, and give each member a portal container inside its root (for example `ctx.portalRoot`).
- **Tests:** the adapter conformance suites pass with two members per worker, on every supported major; a render error in one member leaves the other rendering; a modal portalled into the portal root shows in that member's surface; a pool mixing a React and a Preact member renders both.

### 4. Lift `pools_headless_only`, mixed pools
- `spawn` accepts `pool` on visual isolates, and a pool may mix headless and visual members (decision 4); group supervision (M2c) restarts every member and re-renders each surface.
- **Tests (browser):** a hanging widget restarts its pool's surfaces; other pools keep drawing; in a mixed pool (one headless feed, two widgets) a hang in either kind restarts all three, the feed catches up from its committed offsets and the widgets redraw.

### 5. Host calls and events per member
- `measure`, `focus`, `scrollIntoView` and the event bridge carry the member id; a member can't reach another member's surface.
- **Tests:** browser, including a member that tries to address another's node.

### 6. E2E and devtools data
- Fixture with two visual pools of three, one mixed pool (a headless member and two widgets), one pool mixing a React and a Preact widget, one own-worker widget; kill, hang and throw cases on all three engines. Kernel reports each surface's pool.

### 7. Docs and prerelease
- Guide section on visual pools: shared fate, and in plain words that members of a pool can read each other's DOM and input, so widgets handling secrets stay on their own worker; one framework per pool recommended; pointing modal, tooltip and toast libraries at the portal root. Devtools data carries the same warning per pool. The ADR's consequences in the design doc; changeset; prerelease for the plant dashboard ([M2c](m2c-worker-pools.md) decision 8).

## Open risks

- **No DOM isolation inside a pool.** Members can read each other's DOM and input (ADR 0015 decision 6); the guide and devtools say so, and secrets stay on their own worker.
- **Errors from a shared framework scheduler** can't be traced to a member, so the pool restarts as a group; `AsyncContext` would fix it once browsers ship it ([would-like](../would-like.md)).
- **One member's long render delays its neighbours' frames.** That's the cost of sharing an event loop; measured in the plant dashboard.
- **The gate may fail** on memory (members built apart carry their own framework) or on update latency (one event loop renders 8 widgets).
