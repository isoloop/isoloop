# M2: Bus

**Goal:** the log-based bus in its own worker: topics with schemas, retention, offsets, replay and backpressure, behind the `LogEngine` interface with the TS engine.

**Done when** (RFC 0001): a restarted isolate rebuilds its state from the log in a test.

## Scope

**In:** [design §6](../design/system-design.md#6-isoloopbus), the bus worker, direct `MessageChannel` wiring ([ADR 0005](../adr/0005-bus-topology-message-channels.md)), the isolate `BusClient`, `kernel.publish`/`subscribe`, bus supervision ([ADR 0007](../adr/0007-bus-worker-supervision.md)), the `isoloop.route.v1` system topic ([ADR 0002](../adr/0002-host-owns-routing.md)), and removal of `legacy-bus`.

**Out:** IndexedDB persistence, the WASM engine (M5), devtools UI (M4; this milestone only emits metrics).

Tasks 1–6 are pure TypeScript in Node and can start right after M0, in parallel with M1.

## Tasks

### 1. Topic definitions and contracts
- **Files:** `packages/bus/src/topic.ts` (`topic()`, `TopicDef`, retention types), `src/standard-schema.ts` (the Standard Schema V1 interface type, vendored, about 40 lines).
- **Tests (unit):** Zod 4 and Valibot schemas both validate through the interface; type inference of `TopicDef<T>`.

### 2. `LogEngine` interface and conformance suite
- **Files:** `packages/bus/src/engine/types.ts`, `packages/bus/test/engine-conformance.ts` (a function `runEngineConformance(makeEngine)` that every engine must pass).
- Cases: monotonic offsets; `read` ranges; `last-n`, `time` (fake clock) and `compacted` retention; `tail`/`head`; commits per consumer; compaction keeps the latest record per key and order among survivors.
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
- Supervisor: watch the bus heartbeat; all-for-one restart; `bus:crash`, `bus:restart`, `bus:failed` events.
- **Tests (browser):** a forced bus worker crash (test hook) restarts every isolate, and they resubscribe from `earliest`.

### 9. Isolate `BusClient`
- **Files:** `packages/runtime/src/bus-client.ts`. `publish` returns a promise settled by `result`; `subscribe` with `autoCommit`; `request`; resubscribing after the bus port is replaced.
- **Tests (browser):** a handler that throws doesn't commit, and the record is redelivered on the next restart (at-least-once).

### 10. System route topic
- The kernel publishes `isoloop.route.v1` on start and on `popstate`/`navigate`. The `navigate` host call goes through `onNavigate`.
- **Tests (E2E):** an isolate renders the current pathname; `ctx.host.navigate('/x')` updates the URL and every subscribed isolate.

### 11. Remove `legacy-bus`, migrate four-loops
- Define `count.v1`, `note.v1` and `primes.v1` topics with Zod schemas in `examples/four-loops/src/contracts.ts`; each isolate declares its grants.
- Delete the `x-pub`/`x-sub` envelopes and `legacy-bus.ts`.
- Add a test hook (`window.__isoloop`) that counts main-thread messages per type, for invariant I7.

### 12. Replay test (the done-criterion)
- **File:** `e2e/replay.spec.ts`.
- D (Messages) subscribes to `count.v1` and `note.v1` with `from: 'committed'` and keeps a log. Click A five times, send two notes, crash D. After restart D shows the same log without new events, and the bus metrics show D replayed from its committed offsets.
- Also: a headless store isolate that publishes snapshots to a compacted topic is crashed, and a visual isolate reading it with `from: 'earliest'` keeps showing the latest state throughout; the restarted store rebuilds its state from its command topics; I7 holds (no `deliver` seen on the main thread).

### 13. Throughput bench
- `bench/throughput`: 10 isolate workers subscribed and one publisher, 200-byte records; report records/s and p95 delivery latency. Report only, used to set the [budget](../design/system-design.md#9-performance-budgets) and as the M5 baseline.

## Risks

- **Contracts module loading in the bus worker:** a module that imports large libraries (Zod) adds startup time to the bus worker, which is on the critical path for every isolate. Measure it; if needed, the bus worker can boot without schemas and validate once contracts finish loading, buffering publishes meanwhile.
- **Structured-clone cost** of large `deliver` batches: watch it in task 13; transferables for `ArrayBuffer` values are already in the protocol.
- **Group rebalancing** adds complexity for little v1 demand. If task 6 runs long, ship groups as experimental or move them to M3.

## Demo / write-up

Four-loops with the bus log visible: crash D and watch it replay its history; publish an invalid record from the console and watch the broker reject it. Post: "A Kafka-shaped bus in a Web Worker."
