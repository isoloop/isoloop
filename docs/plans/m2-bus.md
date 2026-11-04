# M2: Bus

**Goal:** the log-based bus in its own worker: topics with schemas, retention, offsets, replay and backpressure, behind the `LogEngine` interface with the TS engine.

**Done when** (RFC 0001): a restarted isolate rebuilds its state from the log in a test.

## Scope

**In:** [design §6](../design/system-design.md#6-isoloopbus), the bus worker, direct `MessageChannel` wiring ([ADR 0005](../adr/0005-bus-topology-message-channels.md)), the isolate `BusClient`, `kernel.publish`/`subscribe`, bus supervision ([ADR 0007](../adr/0007-bus-worker-supervision.md)), the `isoloop.route.v1` system topic ([ADR 0002](../adr/0002-host-owns-routing.md)), and removal of `legacy-bus`.

**Out:** OPFS persistence ([M2b](m2b-durable-log.md); this milestone ships the `LogStorage` interface and the reattach path it needs), the WASM engine (M5), devtools UI (M4; this milestone only emits metrics).

Tasks 1–6 are pure TypeScript in Node and can start right after M0, in parallel with M1.

## Tasks

### 1. Topic definitions and contracts
- **Files:** `packages/bus/src/topic.ts` (`topic()`, `TopicDef`, retention types), `src/standard-schema.ts` (the Standard Schema V1 interface type, vendored, about 40 lines).
- **Tests (unit):** Zod 4 and Valibot schemas both validate through the interface; type inference of `TopicDef<T>`.

### 2. `LogEngine` interface and conformance suite
- **Files:** `packages/bus/src/engine/types.ts`, `packages/bus/test/engine-conformance.ts` (a function `runEngineConformance(makeEngine)` that every engine must pass).
- Cases: monotonic offsets; `read` ranges; `last-n`, `time` (fake clock) and `compacted` retention; `tail`/`head`; commits per consumer; compaction keeps the latest record per key and order among survivors.
- Also define the `LogStorage` interface ([design §6.2](../design/system-design.md#62-logengine-interface)) and ship `MemoryStorage` (no-op), so M2b only adds `OpfsStorage`. Add `durability` to `TopicDef`; `'persistent'` is accepted but behaves as `'memory'` until M2b, with a one-time console warning.
- Property-based tests (fast-check) for I5: random append/compact sequences preserve per-key order.

### 3. TS engine
- **Files:** `packages/bus/src/engine/ts-engine.ts`. Chunked arrays (4,096 records per chunk) so dropping old records is O(1) per chunk; a key index for compacted topics.
- **Tests:** passes the conformance suite. A micro-bench in `bench/throughput` (append + read, 1M records).

### 4. Broker core
- **Files:** `packages/bus/src/broker.ts`. Publish pipeline (ACL, topic, size, schema, append, reply, fan-out), subscriptions with start positions, commits, consumer ids keyed by isolate, `detach` keeping offsets.
- Transport-agnostic: the broker talks to a `Port`-like interface (`post`, `onMessage`), so tests use in-memory ports.
- **Tests (unit):** every rejection code; start positions after restart (`committed` falls back to `earliest`); invariant I4; I6 at broker level.

### 5. Credits and backpressure
- Credit accounting, `deliver` batching (64 records, microtask coalescing), pause at 0 credit, resume from cursor, `gap` notice when retention dropped records.
- **Tests (unit):** a consumer that never commits receives exactly the inbox limit, then nothing; after committing it receives the rest in order; a `last-n: 10` topic with a paused consumer produces a `gap`.

### 6. Groups and request/response
- Consumer groups (hash of key, round-robin for keyless); `bus.request` / `reply` with correlation ids and timeouts.
- **Tests (unit):** two group members split a keyed stream with per-key order kept; a member leaving rebalances; a request times out cleanly; a reply to a dead caller is dropped.

### 7. Bus worker entry and control port
- **Files:** `packages/bus/src/worker.ts`: `boot` (imports the contracts URL, creates topics), `attach`/`detach`, `beat`, 1 s `metrics`, fatal error reporting. Built as the `bus-worker.js` bundle.
- **Tests (browser):** boot with a contracts module, attach two in-memory-wired isolates, publish and deliver.

### 8. Host bus controller
- **Files:** `packages/host/src/bus/controller.ts`. Starts the bus worker before isolates, creates a `MessageChannel` per isolate start, sends `attach` / `detach`, and implements `kernel.publish` / `kernel.subscribe` over the control port. Kernel config gains `topics` and `contracts`.
- Supervisor: watch the bus heartbeat; on a crash, start a new bus worker and send every running isolate `reattach { busPort }` instead of restarting it ([ADR 0007](../adr/0007-bus-worker-supervision.md)); restart only isolates with `bus: { onReset: 'restart' }`; restart limit; `bus:crash`, `bus:restart`, `bus:failed` events.
- **Tests (browser):** a forced bus worker crash (test hook) leaves every isolate in `running` (I11), each memory-topic subscription gets exactly one `reset`, and an `onReset: 'restart'` isolate is restarted.

### 9. Isolate `BusClient`
- **Files:** `packages/runtime/src/bus-client.ts`. `publish` returns a promise settled by `result`; `subscribe` with `autoCommit` and `onReset`; `request`; on `reattach`, swap the port, re-send every subscription, and flush publishes buffered while the bus was down (reject past the inbox limit with `bus_unavailable`).
- **Tests (browser):** a handler that throws doesn't commit, and the record is redelivered on the next restart (at-least-once); publishes made during a bus restart arrive after it, in order.

### 10. System route topic
- **Files:** `packages/host/src/router.ts` (resolver, `syncRoute`, `navigate`, link policy), `packages/protocol/src/route.ts` (`routeTopic`).
- `KernelConfig.routing` (default `true`) and `basePath` (default `/`). With routing off: no listeners, no publishes, `syncRoute` no-op, `navigate` → `routing_disabled`, no link interception.
- The kernel publishes `isoloop.route.v1` with `{ href, pathname, path, search, hash, state }` on start, on `popstate`/`hashchange`, on `kernel.syncRoute()`, after an accepted `navigate`, and again after a bus restart. It skips unchanged `href`/`state`. `path` is relative to `basePath` or `null` outside it. An oversized record is published with `state: null` plus `route:state_dropped`. Dev warning once when `syncRoute` sees a URL outside `basePath` while isolates are subscribed.
- `navigate(href, { replace, state })`: `grants.navigate` checked in the runtime and the kernel (`forbidden`); one resolver for `navigate` and links (`/x` → `basePath + x`, others against the document URL); cross-origin → `cross_origin`; `onNavigate({ href, replace, state, from })`; a throw → `navigate_failed` + `route:navigate_error`; after `true`, `syncRoute()` and reply after the bus commit if it published (at once if the bus is down).
- `isoloop.*` reserved: isolate publishes are `forbidden` in the broker whatever the grants, `kernel.publish` rejects on the main thread, subscribes need no grant.
- Links: the compositor rewrites same-origin `href`s through the resolver; only plain primary-button clicks on same-origin `<a>` (hash-only included) without `target`/`download` go to `onNavigate`, with no grant needed.
- **Tests (unit):** resolver (`/x` with `basePath: '/app/'`, `#x`, relative, full same-origin URL, cross-origin); `path` is `null` outside the base; `syncRoute` dedupes unchanged locations; an isolate with a `*` publish grant still gets `forbidden` on `isoloop.route.v1`; oversized `state` is dropped with the event; routing off adds no listeners.
- **Tests (E2E):** an isolate renders the current path; with the grant, `ctx.host.navigate('/x')` updates the URL and the route record is committed before the call resolves; without the grant it rejects with `forbidden`; `navigate('https://other.example')` rejects with `cross_origin`; a throwing `onNavigate` gives `navigate_failed`; a host `pushState` followed by `syncRoute()` reaches subscribed isolates and wakes no unsubscribed suspended isolate; a link click in an isolate without the grant still navigates; Ctrl-click isn't intercepted and opens the rewritten href; after a forced bus crash, subscribers get `reset` and then the current route.

### 11. Remove `legacy-bus`, migrate four-loops
- Define `count.v1`, `note.v1` and `primes.v1` topics with Zod schemas in `examples/four-loops/src/contracts.ts`; each isolate declares its grants.
- Delete the `x-pub`/`x-sub` envelopes and `legacy-bus.ts`.
- Add a test hook (`window.__isoloop`) that counts main-thread messages per type, for invariant I7.

### 12. Replay test (the done-criterion)
- **File:** `e2e/replay.spec.ts`.
- D (Messages) subscribes to `count.v1` and `note.v1` with `from: 'committed'` and keeps a log. Click A five times, send two notes, crash D. After restart D shows the same log without new events, and the bus metrics show D replayed from its committed offsets.
- Also: a headless store isolate that publishes snapshots to a compacted topic is crashed, and a visual isolate reading it with `from: 'earliest'` keeps showing the latest state throughout; the restarted store rebuilds its state from its command topics; I7 holds (no `deliver` seen on the main thread).

### 12b. Opt-in suspension
- Implements [ADR 0001 § Suspension](../adr/0001-one-worker-per-isolate.md#suspension-opt-in). Lifts the M1 `suspend_unsupported` guard: `manifest.suspend: 'never' | 'when-idle' | { whenIdle: { afterMs } }`, default `'never'`, `'when-idle'` = 60 s.
- **Idle** = no visible surface (off-screen, `display: none` or hidden tab; headless counts as never visible), nothing delivered for `afterMs`, no open `ctx.keepAwake()` hold, and no host call or unacknowledged publish in flight.
- **Suspend:** `shutdown { reason: 'suspend' }` with the usual grace, `detach { keepOffsets: true }` (the broker removes the isolate from its consumer groups and rebalances), terminate; new supervisor state `suspended`, which never counts towards the restart limit. The host keeps the last mirrored surface as an inert snapshot.
- **Wake:** visual isolates on surface visible again; headless isolates on a record for a subscribed topic, or a request when it was the last member of its group (the bus sends `wake` on the control port instead of buffering for the detached port); both on `kernel.resume(id)`. A wake queue starts at most 4 workers at once (`kernel.config.suspend.maxConcurrentWakes`), visible surfaces first in on-screen order. Resubscribe with `from: 'committed'`.
- **`keepAwake`:** `ctx.keepAwake()` returns a release function; the isolate runtime reports open holds in its `beat`; devtools metrics list each hold's age and creation stack; dev builds warn once a hold passes 10 minutes.
- **Spawn failures:** before retrying a `spawn-failed` isolate, suspend every idle suspendable isolate.
- **Warnings at registration:** a suspendable isolate subscribing to a `last-n` or `time` topic.
- **Files:** `packages/host/src/supervisor/` (state, transitions, wake queue), `packages/host/src/bus/controller.ts` (`wake`), `packages/bus/src/broker.ts` (wake for detached-with-offsets subscribers, group leave/rejoin), `packages/runtime/src/keep-awake.ts`.
- **Tests:** unit rows for `running → suspended → loading` and the wake queue order; browser: a `'when-idle'` headless isolate suspends after the idle time and wakes on a publish to its topic, with the missed records replayed in order (I13); a held `keepAwake` prevents suspension, releasing it allows it; a hidden visual isolate is not woken by records but replays them when shown; a `last-n: 3` topic with 5 publishes while suspended delivers a `gap`; 10 suspended visual isolates shown together start at most 4 at a time; an isolate with `suspend: 'never'` is never suspended; a suspended group member leaves and rejoins its group.

### 13. Throughput bench
- `bench/throughput`: 10 isolate workers subscribed and one publisher, 200-byte records; report records/s and p95 delivery latency. Report only, used to set the [budget](../design/system-design.md#9-performance-budgets) and as the M5 baseline.

## Risks

- **Contracts module loading in the bus worker:** a module that imports large libraries (Zod) adds startup time to the bus worker, which is on the critical path for every isolate. Measure it; if needed, the bus worker can boot without schemas and validate once contracts finish loading, buffering publishes meanwhile.
- **Structured-clone cost** of large `deliver` batches: watch it in task 13; transferables for `ArrayBuffer` values are already in the protocol.
- **Group rebalancing** adds complexity for little v1 demand. If task 6 runs long, ship groups as experimental or move them to M3.

## Demo / write-up

Four-loops with the bus log visible: crash D and watch it replay its history; publish an invalid record from the console and watch the broker reject it. Post: "A Kafka-shaped bus in a Web Worker."
