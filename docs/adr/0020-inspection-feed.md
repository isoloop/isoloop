# ADR 0020: Inspection feed

- **Status:** Proposed (2026-11-18), after grilling (Q1–Q11, yes to all).
- **Date:** 2026-11-18
- **Plan:** [M4b](../plans/m4b-devtools.md) (its devtools decisions 2, 5 and 7 are what this ADR makes precise). The [M4a](../plans/m4a-agents.md) dev MCP reads the same feed (decisions 12 and 13 there).

## Context

M4b's devtools panel and M4a's dev MCP both need to see a running app: its isolates, its pools, its bus, and what has happened recently. A browser extension may follow later. Much of this is already public:

- **Isolates:** `kernel.isolates()` gives each isolate's state, pool, last beat, `lagMs`, restarts, crash reason, compositor stats (`surface`: queued, applied, rejected, dropped, last frame), keep-awake holds and `busyMs`.
- **Pools:** `kernel.pools()` gives members, running count, merged grants and the shared-document warning.
- **Events:** `kernel.on` emits `isolate:state`, `isolate:crash`, `isolate:failed`, `isolate:beat` (only while something listens), `workers:budget`, `agents:unmatched` and the `bus:*` events.
- **Bus figures:** `bus:metrics` arrives every second, with per-topic record and byte rates, per-subscription lag and credit, rejected publishes by code, and storage use.

What's missing:

- **A worker can't read any of it.** The panel is a visual isolate in its own worker (devtools decision 4), and the dev MCP's page side has to send what it reads over a WebSocket. Both need the data as plain messages.
- **Some data isn't kept or sent.** Nothing fills the beat's `heapBytes` slot. The bus's restart count exists only as the `bus:restart` event. Per-topic head offsets and retained record counts stay inside the bus worker. Nothing keeps recent events for a reader that arrives late.
- **Records can't be watched without becoming a consumer.** A host subscription (`isoloop:host:N`) shows up in the bus figures as a consumer and takes part in credit, so the panel would distort what it shows.
- **There's no way to block an isolate on purpose.** The panel's controls are kill, block and restart (devtools decision 7), and the dev MCP has `isoloop_block`. Today a block is only an app's own busy loop, as in the test fixtures.

The forces:

- **The panel must keep working while the bus restarts** (devtools decision 5), so its feed can't go through the bus.
- **It costs nothing until someone looks,** apart from what this ADR keeps on purpose.
- **Pools merge grants,** so a capability granted to one member reaches every member.
- **Readers are built apart from the kernel.** An extension, or a dev MCP on another version, must keep working against a newer kernel.
- **A breaking change after 0.1 costs more than an addition now.**

## Decision

### 1. `kernel.inspect()` returns an `Inspector`

```ts
const inspector = kernel.inspect();        // @experimental
const snap = inspector.snapshot();         // InspectSnapshot
const off = inspector.on((m: InspectMessage) => { … });
const stop = inspector.tap({ topics: ['markets.*'], maxPerSec: 50 }, (r) => { … });
const last = await inspector.records('markets.quote.v1', { last: 20 });
inspector.close();
```

- **Public and `@experimental`.** The feed reads the existing events and getters underneath; it adds no second source of truth.
- **Every message is plain, structured-cloneable data.** The same `InspectMessage`s go to an isolate over the `inspect` port (decision 6) and over the dev MCP's WebSocket, so there is one format for every reader.
- **One feed underneath,** however many inspectors are open. Each inspector filters nothing; a reader shows what it wants.

### 2. What the feed carries

`snapshot()` gives:

- the isolates, as `kernel.isolates()` has them, plus `heapBytes` where known (decision 4);
- the pools, as `kernel.pools()` has them;
- the bus: its state, its restart count (newly kept as state), and the last `bus:metrics`;
- the recent events (decision 5).

After it, `on` delivers events:

- at once: isolate state, crash and failed; supervisor events; the `bus:*` lifecycle events; `workers:budget`; `agents:unmatched`;
- coalesced to about one per second: beats per isolate, and `bus:metrics`.

`BusMetrics` gains, per topic, the head offset and the retained record count. Both are additions to the control port.

### 3. Records: a tap and a read, outside the consumer figures

- **`tap({ topics, maxPerSec })`** sends a new `HostToBus` `tap` with a dedicated port. The bus copies matching records onto it as they're appended, capped at `maxPerSec` (default 50); the rest are counted as skipped, not queued. A tap isn't a consumer: it has no cursor, no credit and no commits, and it doesn't appear in the subscriptions of `bus:metrics`. It runs only while open. After a bus restart the kernel opens it again.
- **`records(topic, { last })`** sends a new `HostToBus` `read` and returns the last `last` records still retained, capped at 100. It serves the dev MCP's `isoloop_records` and a log that opens on a quiet topic.
- **Values are previews.** Each record's value is cut to a 2 KB preview, with its full size given, in both the tap and the read. A devtools view never holds a large record twice.
- **Both are gated by inspect access:** an `Inspector` on the host, or the `inspect` port.

### 4. Heap and block in the runtime

- **Heap:** the runtime fills the beat's `heapBytes` from `performance.memory` where the engine has it (Chromium), and leaves it out elsewhere. Readers show it as Chromium-only. It's a per-worker figure, so pool members share one value.
- **Block:** a new runtime message, `block { ms }`, makes the isolate's worker busy-loop for `ms`, capped at 10 s, so a developer can watch containment work: the heartbeat goes late, the supervisor acts, the page keeps running. Only the `inspect` port (decision 6) and an `Inspector` on the host can send it. For a pooled isolate it blocks the whole worker, as a real busy loop would.

### 5. Recent events, kept from the start

The kernel keeps a ring buffer of the last 200 supervisor and bus events from the moment it starts, inspected or not, and `snapshot()` includes it. A reader that connects after a crash still sees the crash; that's the first thing an agent asks about. It's the one cost this ADR adds before anything inspects: a few KB of events.

### 6. The `inspect` grant and its port

```ts
kernel.spawn({ id: 'devtools', url, grants: { publish: [], subscribe: [], inspect: true } });
```

- **`inspect: true` is a boolean capability,** like `navigate`, `@experimental`.
- **It can't be pooled.** Spawning an isolate that holds it into a pool fails with `invalid_config`, because a pool merges its members' grants and the capability would reach every member.
- **The port goes host to isolate,** on the isolate's own channel, through a new isolate message (`inspect { port }`, beside `reattach { busPort }`). The bus never carries it, so it keeps working while the bus restarts, and its traffic never counts in the bus figures.
- **The same port carries the controls:**
  - restart, as `kernel.restart(id)`;
  - kill, which ends the isolate's worker as a crash, so the supervisor restarts it like any other;
  - block, as decision 4.

  There's no separate control grant: the app chose to mount the devtools.
- **The dev MCP's page side** runs on the host and uses `kernel.inspect()` directly; it needs no grant.

### 7. A versioned, additive message format

`InspectMessage`, `InspectSnapshot` and the port's control messages are types in `@isoloop/protocol`, in the usual envelope with `v`. They only grow: new fields and new messages are additions, and readers ignore what they don't know. An older panel, dev MCP or extension keeps working against a newer kernel.

## Consequences

- **One feed for the panel, the dev MCP and a later extension.** None of them reads kernel internals.
- **The panel survives a bus restart** and doesn't appear as a consumer in the figures it shows.
- **The feed's cost is measured, not assumed.** M4b task 6 runs plant at `?rate=5` with the feed open and closed and reports the difference as measured, in CI. A budget is asserted only once the numbers are known.
- **The ring buffer always runs.** It's small, but it isn't zero.
- **Heap is Chromium-only** and per worker, so pooled members can't be told apart by heap.
- **`block` is a real busy loop.** On a pooled isolate it blocks every member of the pool, which is what a real block would do.
- **New API, all `@experimental` and all additions:** `kernel.inspect()` and `Inspector`; the `inspect` grant; the `HostToBus` `tap` and `read` envelopes; the head offset and retained count in `BusMetrics`; the isolate messages `inspect { port }` and `block { ms }`. Under [ADR 0019](0019-versioning-and-releases.md) the isolate messages are seam additions ([ADR 0012](0012-isolates-built-apart.md)), so they need a minor.
- **The balancer's own states** (quarantine, bisect) don't appear. The panel shows pools and members from `kernel.pools()`.

## Alternatives considered

- **No new host API** (the panel and the dev MCP use `kernel.on` and the getters directly, and only the port is new). Rejected: each reader would build its own snapshot and message format, and the port would need one anyway.
- **Records through a host subscription** (`isoloop:host:N`). Rejected: it counts as a consumer in the bus figures and takes part in credit, so the devtools would change what they measure.
- **The feed through bus topics** (`isoloop.inspect.*`). Rejected: it stops when the bus restarts, which is when it's most needed, and it adds to the bus figures.
- **`inspector.annotate(source, data)`** so the balancer can add its quarantine and bisect states. Deferred to [would-like](../would-like.md): it adds public API to two packages before the 0.1 freeze, and pools and members cover placement for now.
- **Keeping recent events only while inspected.** Rejected: the question a late reader asks is what crashed before it connected.
- **A separate control grant** for kill, block and restart. Rejected: the app chose to mount the devtools, and two grants for one panel add nothing.
- **Block as suspend** (pausing delivery). Rejected: that shows something else. The point is to watch containment handle a real busy loop.
- **Heap from `performance.measureUserAgentSpecificMemory()`.** Not taken: it needs cross-origin isolation and reports asynchronously and coarsely. Revisit if browsers make it practical.
