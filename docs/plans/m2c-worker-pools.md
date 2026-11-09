# M2c: Worker pools (headless)

**Status:** done 2026-11-09 (gate passed, [ADR 0001](../adr/0001-one-worker-per-isolate.md) records it). Planned 2026-11-08. Moved ahead of [M4](m4-devtools-release.md) (0.1): the order is now M2c → [M2d](m2d-visual-pools.md) → [M3d](m3d-plant-dashboard.md) → M4, so the plant dashboard can use pools and 0.1 ships with them.

**Goal:** a headless isolate can opt into a named pool (`manifest.pool: 'feeds-t1'`) and share one worker with the other members of that pool, while own-worker isolates keep the full isolation guarantee ([ADR 0001](../adr/0001-one-worker-per-isolate.md)). Visual isolates with `pool` stay rejected (`pools_headless_only`) until [M2d](m2d-visual-pools.md).

**Why:** one worker per isolate costs a heap, a runtime copy and a thread each. Apps with many small headless isolates (feeds, engines, aggregators; [ADR 0008](../adr/0008-isolates-and-surfaces.md)) pay that cost many times over, and the soft budget of 32 workers is reached quickly. Pools trade isolation inside a group for fewer workers. Whether that saves enough to be worth it is measured first (task 0).

**Done when:** in an E2E test, pooled and own-worker isolates run side by side; a member that loops forever gets its pool restarted (every member replays from its committed offsets) while own-worker isolates and other pools are unaffected; and `@isoloop/*` with pools is published as a `next` prerelease the examples can use.

**Depends on:** M2 (per-isolate bus ports, replay from committed offsets). [M2d](m2d-visual-pools.md) builds on it.

## Decisions (grilling, 2026-11-08)

1. **Before 0.1.** M2c, then M2d, then the plant dashboard ([M3d](m3d-plant-dashboard.md)), then M4.
2. **Headless only.** ADR 0001's rule stands: `spawn` rejects `pool` on an isolate with a surface, with `pools_headless_only`. Visual pools are [M2d](m2d-visual-pools.md).
3. **Benchmark gate first.** Before any pool code, a prototype hosting 20 small headless isolates in one worker is measured against 20 own workers on Chromium, Firefox and WebKit. If pooling saves less than about 30% memory and doesn't start them faster, M2c stops: the result goes into ADR 0001 (for the user's approval) and pools are dropped. The result is recorded whichever way it goes.
4. **Placement belongs to the host manifest** (ADR 0001): the app names pools; the runtime never pools on its own, and an isolate module can't ask for or refuse a pool.
5. **Pool members share fate, and that's stated.** A hang or crash restarts the whole pool; members share the event loop, `globalThis` and, in effect, the union of their grants. Docs and devtools say so.
6. **Freezing built-ins is tried, not assumed.** The pool bootstrap freezes built-in prototypes (`Object.prototype`, `Array.prototype`, `Function.prototype` and the rest) only if React, Preact and the runtime still pass their suites with them frozen. If anything breaks, the freeze is dropped and the shared-globals risk is documented instead.
7. **No changes to the markets example.** Pools are verified by the benchmark and the E2E suite here; the first app that uses them is the plant dashboard.
8. **Prereleases need no extra approval.** The user gave a standing OK (2026-11-08) for publishing `@isoloop/*` as `0.0.0-next.<sha>` through `prerelease.yml` during M2c and M2d. `v*` tags stay the user's.

## Tasks

All in `isoloop/isoloop` unless a task says otherwise. Each task is one PR.

### 0. Benchmark gate
- A throwaway prototype (`bench/pools/`): one worker that imports 20 small headless isolate modules and runs their `start`, against 20 own workers. Measure memory (`performance.measureUserAgentSpecificMemory` under COOP/COEP where available; renderer PSS otherwise, as in M3c's comparison) and time from first spawn to the last `ready`, on Chromium, Firefox and WebKit, several runs each.
- The result, with the decision-3 condition checked against it, goes in `bench/pools/README.md`. If the gate fails, stop and report; the ADR 0001 note is drafted for the user.
- **Acceptance:** the numbers are recorded for all three engines.

### 1. Pool bootstrap
- `packages/runtime`: a pool bootstrap that hosts several isolate modules. Every envelope on the isolate port carries `isolate`; each member keeps its own bus port ([ADR 0005](../adr/0005-bus-topology-message-channels.md)), so bus traffic is unchanged. A protocol change, so `packages/protocol` gets the field and its codec tests.
- **Tests:** unit (envelope routing by `isolate`); browser (two members in one worker each get their own `ctx` and bus port).

### 2. Lift the guard
- `packages/host`: `spawn` accepts `manifest.pool` for headless isolates; the loader starts the pool worker on first use, adds members to it, and stops it when its last member stops. Visual isolates with `pool` fail with `pools_headless_only`.
- **Tests:** unit (manifest validation); browser (spawn, add, stop the last member → worker gone).

### 3. Supervision as a group
- Heartbeats per worker. A blocked or crashed pool worker restarts every member, with the usual backoff and restart limits applied per pool; each member replays from its committed offsets. Kernel events name the pool and every affected isolate.
- **Tests (browser):** a member that loops forever → the pool restarts, members replay, other pools and own-worker isolates keep their heartbeat.

### 4. Per-member errors
- An exception in one member's `start` or handlers fails that member only, while the worker is still responsive; the others keep running.
- **Tests (browser):** a throwing member is `failed`, its neighbours stay `running`.

### 5. Budget, grants and devtools data
- A pool counts as one worker in the soft budget. `kernel.isolates()` reports each isolate's pool; the kernel exposes each pool's members and its effective grants (the union), for M4's devtools.
- **Tests (unit):** budget count; union of grants.

### 6. Suspension
- A pool suspends only as a whole, when every member has `suspend` set and is idle; otherwise registration warns that `suspend` has no effect. Any member's wake condition wakes the pool.
- **Tests (browser):** all-idle pool suspends and wakes on a record for one member; a pool with one non-suspendable member never suspends and warns once.

### 7. Frozen built-ins (decision 6)
- Freeze built-in prototypes in the pool bootstrap behind a flag; run the runtime, React and Preact adapter suites in a pool with it on.
- **Acceptance:** kept on if every suite passes; otherwise removed, and the result written in the docs task.

### 8. E2E: the done-when
- `e2e/pools.spec.ts` with a fixture: a pool of three headless members, a second pool, and own-worker isolates. Kill, hang and throw cases.
- **Tests:** this is the check, on all three engines.

### 9. Bench in CI
- The task-0 measurement as a regular bench (`bench/`), pooled against own workers, reported, not asserted.

### 10. Docs and prerelease
- Guide: when to pool (small, trusted headless isolates), shared fate and globals, grants union. ADR 0001's "after M2c" line updated with the gate result (for the user's approval). Changeset.
- Prerelease published through `prerelease.yml` (decision 8), so M2d and the examples can use it.

## Open risks

- **Savings may be small.** Each member still loads its own module code; the gate (task 0) decides.
- **Shared globals.** One member patching built-ins affects the others. Task 7 tries freezing; otherwise documented.
- **Two framework copies in one worker** don't arise here (headless), but they do in M2d.
- **Restart cost.** A pool restart replays every member; for chatty members that may take longer than one member's restart. Measured in task 8.
