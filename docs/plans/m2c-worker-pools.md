# M2c: Worker pools (outline)

**Goal:** a headless isolate can opt into a named pool (`manifest.pool: 'light'`) and share one worker with the other members of that pool, while own-worker isolates keep the full isolation guarantee ([ADR 0001](../adr/0001-one-worker-per-isolate.md)). Visual isolates with `pool` stay rejected (`pools_headless_only`) until an `isoloop-dom` surface can be scoped per isolate inside one worker.

**Done when:** in an E2E test, pooled and own-worker isolates run side by side; a member that loops forever gets its pool restarted (every member replays from its committed offsets) while own-worker isolates and other pools are unaffected.

**Depends on:** M2 (per-isolate bus ports, replay from committed offsets). Not required for 0.1 (M4); it can land before or after.

Gets a full task list when M2 closes.

## Main work items

0. **Benchmark gate (first, before any pool code):** a cheap prototype hosting 20 small headless isolates in one worker versus 20 own workers, measuring memory and startup time on Chromium, Firefox and WebKit. If pooling saves less than 30 % memory and doesn't start them faster, stop: record the result in ADR 0001 and drop pools.
1. **Pool bootstrap:** a worker that hosts several isolate modules. The isolate port between host and worker carries `isolate` on every envelope; each member keeps its own bus port (ADR 0005), so bus traffic needs no change.
2. **Lift the M1 guard:** `spawn` accepts `manifest.pool`; the loader starts the pool worker on first use and adds members to it; the worker stops when its last member stops.
3. **Supervision as a group:** heartbeats per worker; a blocked or crashed pool worker restarts every member with the usual backoff and restart limits, applied per pool. Kernel events report the pool and each affected isolate.
4. **Per-member errors:** an exception in one member's `start` or handlers fails that member only, without killing the worker, when the worker is still responsive.
5. **Budget and grants:** a pool counts as one worker in the soft budget; devtools shows members per pool and the pool's effective grants (the union of its members').
5b. **Suspension:** a pool suspends only as a whole, when every member has `suspend` set and is idle; otherwise registration warns that `suspend` has no effect. Any member's wake condition wakes the pool.
6. **Docs:** when to pool (small, trusted, low-frequency headless isolates), the shared-globals warning, and that members effectively share grants.
7. **Tests:** a fixture pool with three members; kill, hang and throw cases; mixed pooled and own-worker isolates; a bench of memory and startup time, pooled versus own worker.

## Open risks

- Shared globals: one member patching built-ins affects the others. Document it; consider freezing built-in prototypes in the pool bootstrap if it doesn't break frameworks.
- Two framework copies in one worker (for example React and Svelte members) may conflict over globals; test it, and recommend one framework per pool if needed.
