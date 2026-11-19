# @isoloop/host

## 0.1.0-next.5

### Minor Changes

- 080059d: `tap()` on the host's `Inspector` and on `ctx.inspector` takes `onSkipped?: (count: number) => void` (`@experimental`). It gets each count of records the bus left out over `maxPerSec`, at most once a second (ADR 0020, decision 6, amended 2026-11-19). The devtools Log header shows the cap and the total skipped since the log was opened.

### Patch Changes

- @isoloop/dom@0.1.0-next.5
  - @isoloop/protocol@0.1.0-next.5

## 0.1.0-next.4

### Patch Changes

- @isoloop/dom@0.1.0-next.4
  - @isoloop/protocol@0.1.0-next.4

## 0.1.0-next.3

### Minor Changes

- c2ad524: New, `@experimental`: `connectDevMCP(kernel, { token, url?, title? })` from the new entry `@isoloop/host/dev-mcp`, the page side of the dev MCP ([ADR 0018](https://github.com/isoloop/isoloop/blob/main/docs/adr/0018-tools-for-agents.md), decision 8). It dials `isoloop mcp`'s WebSocket (`ws://127.0.0.1:4317` by default) and sends the kernel's exposed tools (`kernel.tools()`). It answers each call with `kernel.request(tool.topic, input, { timeoutMs: tool.timeoutMs, via: 'mcp' })`, aborts the request when the agent cancels, and sends a failure's `BusError` code and message. It keeps retrying while the CLI isn't running, backing off to one try every 30 s, and stops on a wrong token or a bad hello. The returned function disconnects it. Import it behind `if (import.meta.env.DEV)`.
  
  `@isoloop/vite` fails a production build whose output still contains `@isoloop/host/dev-mcp`, unless you pass `isoloop({ allowDevMcp: true })`. An import that is tree-shaken away, or dropped behind `import.meta.env.DEV`, passes.
- 16b3e38: The host can request, and an app can expose tools to agents ([ADR 0018](https://github.com/isoloop/isoloop/blob/main/docs/adr/0018-tools-for-agents.md), decisions 2–6). All of it is `@experimental`.
  
  - `kernel.request(topic, value, { key?, timeoutMs?, signal?, via? })` mirrors `bus.request`: it resolves with the first valid reply, on any requestable topic, and the record carries `req: { from: 'host', id }`, plus `via` when given. It times out after 30 s by default, rejects with the new `BusError` code `aborted` when `signal` aborts, and with the new code `no_responder` at once when no isolate could answer (none with a subscribe grant for the topic, or all of them stopped or `failed`). An isolate that restarts within the timeout still gets the request and can answer it.
  - `createKernel({ agents: { expose: ['markets.quote.v1', 'markets.alerts.*'], timeoutMs? } })` lists the topics agents may call, with grant matchers. A matched topic without `reply`, without `tool`, or with a schema that doesn't make JSON Schema fails the start with `KernelError('not_exposable')`, naming the topic. A pattern that matches nothing warns on the console and emits the new `agents:unmatched` event once.
  - `kernel.tools()` lists the exposed tools: name, title, description, the flags, the input and output JSON Schemas (draft 2020-12, made once at start) and the agent timeout (10 s by default), for the dev MCP and `@isoloop/webmcp` to read.
  - Protocol: a host-to-bus `request` envelope. The run-time JSON Schema module now lives in `@isoloop/protocol`, so the host can use it; `@isoloop/bus` still re-exports it.
- 235d488: New: the dev MCP's own tools (M4a decision 12). `isoloop mcp` now offers, on any page that passes a kernel with `inspect()`:
  
  - reads, always: `isoloop_isolates` (state, pool, lag, time since the last beat, restarts, crash reason, busy time, compositor figures; and the pools), `isoloop_topics` (the bus's state and restart count, each topic's rates, head offset and retained count, each subscription's lag and credit, rejected publishes), `isoloop_records` (a topic's last records, at most 100, as 2 KB previews) and `isoloop_events` (the kernel's recent events, at most 200, each with how long ago it happened), all from `kernel.inspect()` ([ADR 0020](https://github.com/isoloop/isoloop/blob/main/docs/adr/0020-inspection-feed.md));
  - with `--allow-write` only: `isoloop_restart`, `isoloop_kill`, `isoloop_block` (at most 10 s), `isoloop_publish` and `isoloop_request` (any requestable topic, with `via: 'mcp'`). Without the flag they aren't listed.
  
  Every tool takes an optional `page`; the default is the newest page that can answer. The `isoloop_` tool names are reserved: an app tool with one of them isn't listed (topic names can't collide in practice, since they're dotted like `markets.quote.v1`). `connectDevMCP` (`@experimental`) answers these through `kernel.inspect()`, opened on the first call and closed on disconnect, and still accepts a kernel without `inspect()` (it then offers only the app's tools).
- 29f2296: New, `@experimental`: the `inspect` grant, which gives an isolate the inspection feed and its controls ([ADR 0020](https://github.com/isoloop/isoloop/blob/main/docs/adr/0020-inspection-feed.md), decision 6).
  
  - **`grants: { …, inspect: true }`** gives the isolate `ctx.inspector`; without it `ctx.inspector` is `undefined`. An isolate holding it can't be pooled: spawning one into a pool fails with `invalid_config`, because a pool merges its members' grants.
  - **`ctx.inspector`** mirrors the host's `Inspector`, asynchronously: `snapshot()`, `on(fn)`, `records(topic, { last })`, `tap({ topics, maxPerSec? }, fn)`, and the controls `restart(id)`, `kill(id)` and `block(id, ms)`. It runs on a port of its own to the host, never through the bus, so it keeps working while the bus restarts and doesn't appear in the bus figures. The feed reaches the port only while the isolate listens.
  - **The controls:** `restart` calls `kernel.restart`. `kill` ends the isolate's worker as a crash (`worker-error`), so the supervisor restarts it like any other. For a pooled isolate that's the pool's worker, so every member crashes and restarts. The call resolves once the kill is sent. `block` busy-loops the isolate's worker for up to 10 s, so you can watch the heartbeat go late and the supervisor act. After the host `Inspector`'s `close()`, or once `ctx.inspector`'s port has ended, the controls reject, while the last snapshot stays readable. Nothing gates them in production.
  - **The host's `Inspector`** gains the same `tap`, `records`, `restart`, `kill` and `block`.
  - **`heapBytes` is removed** from the beat and the feed's types. Nothing filled it: Chromium has `performance.memory` only on the main thread, not in workers. Memory per isolate comes from the host instead (ADR 0020, decision 4, amended).
  
  The new isolate message (`inspect { port }`) is an addition to the host–isolate seam ([ADR 0012](https://github.com/isoloop/isoloop/blob/main/docs/adr/0012-isolates-built-apart.md)), so under [ADR 0019](https://github.com/isoloop/isoloop/blob/main/docs/adr/0019-versioning-and-releases.md) it ships in a minor. Runtimes before it ignore the message.
- c099c70: New, `@experimental`: `kernel.inspect()` gives an `Inspector` on the inspection feed ([ADR 0020](https://github.com/isoloop/isoloop/blob/main/docs/adr/0020-inspection-feed.md)), the one feed that M4a's dev MCP reads.
  
  - `snapshot()` returns the isolates (as `kernel.isolates()` has them), the pools, the bus (its state, its restart count and the latest `bus:metrics`), and the last 200 kernel events.
  - `on(fn)` delivers events as they happen. Beats and bus metrics are coalesced to about one message a second, with the latest beat per isolate. `close()` stops this inspector's listeners.
  - The kernel always keeps a ring buffer of the last 200 events from its start, so a reader that arrives after a crash still sees it. Everything else costs nothing until a reader listens.
  - Every message is plain, structured-cloneable data in the usual envelope: the `InspectMessage` types and the `isInspectMessage` guard in `@isoloop/protocol`. Readers ignore message types they don't know, so the format can only grow.
- 12e43d0: `kernel.inspect()` now shows each isolate's memory, in Chromium on a cross-origin isolated page (ADR 0020, decision 4). The host measures with `performance.measureUserAgentSpecificMemory()` while a reader listens, at most every 5 s, and gives each isolate its worker's bytes as `memory: { bytes, at }`; a pool's members share their worker's figure (`shared: true`). The snapshot carries it and a new `memory` feed message sends it, to `ctx.inspector` too. Chromium answers at its next garbage collection, so a figure is coarse and can be many seconds old. Without cross-origin isolation, and in Firefox and Safari, there is no figure. `@isoloop/vite`'s existing `crossOriginIsolated: true` makes the dev and preview servers send the headers this needs. To tell workers apart, each one starts from `@isoloop/runtime/worker` with a fragment of its own. `virtual:isoloop/workers` now marks that entry's URL with `#isoloop-entry` for this, and the worker's `ready` reports that it started from it. Workers started from `@isoloop/runtime/bootstrap` directly keep one shared URL and get no memory figure. `@experimental`.

### Patch Changes

- 9137d5e: The bus side of the inspection feed ([ADR 0020](https://github.com/isoloop/isoloop/blob/main/docs/adr/0020-inspection-feed.md), decisions 2 and 3). `bus:metrics` now gives each topic its `head` (the next offset to be written) and `retained` (how many records it still holds). Everything else is the bus side of `kernel.inspect()`, and is `@experimental`:
  
  - Protocol: a host-to-bus `tap` that copies records appended to matching topics onto a dedicated port, at most `maxPerSec` a second (default 50), and counts the rest as `skipped`. A tap is not a consumer: it has no cursor or credit and never shows in `bus:metrics`. A host-to-bus `read` returns a topic's last records (at most 100). Both send `RecordPreview`s: the value as JSON-like text cut to 2,048 characters, with its estimated size in bytes.
  - Bus: `LogEngine` gains `retained(topic)`, covered by the engine conformance suite.
  - Host (internal): the bus controller opens a tap again on each new bus worker after a crash, and keeps the bus restart count.
- Updated dependencies [ce4dc9a]
- Updated dependencies [16b3e38]
- Updated dependencies [ffb3ef3]
- Updated dependencies [fcb9fb5]
- Updated dependencies [9137d5e]
- Updated dependencies [29f2296]
- Updated dependencies [c099c70]
- Updated dependencies [12e43d0]
- Updated dependencies [c519268]
  - @isoloop/protocol@0.1.0-next.3
  - @isoloop/dom@0.1.0-next.3

## 0.1.0-next.2

### Patch Changes

- @isoloop/dom@0.1.0-next.2
  - @isoloop/protocol@0.1.0-next.2

## 0.1.0-next.1

### Patch Changes

- @isoloop/dom@0.1.0-next.1
  - @isoloop/protocol@0.1.0-next.1

## 0.1.0-next.0

### Minor Changes

- 0e0ca1c: The main-thread kernel. `createKernel` loads each isolate into its own worker or a named pool ([ADR 0001](https://github.com/isoloop/isoloop/blob/main/docs/adr/0001-one-worker-per-isolate.md), [ADR 0015](https://github.com/isoloop/isoloop/blob/main/docs/adr/0015-visual-pools.md)) and supervises it: heartbeats, blocked and killed loops, restarts with backoff, and a crash-loop guard (by default, three restarts within a minute, then `failed` until `kernel.restart`). It composites each isolate's surface into a shadow root within a frame budget, owns the URL and routing ([ADR 0002](https://github.com/isoloop/isoloop/blob/main/docs/adr/0002-host-owns-routing.md)), answers host calls, checks each isolate's `requires` against its `[FLOOR, VERSION]` range, and starts and supervises the bus worker. It reports through `isolate:*` and `bus:*` events, `kernel.isolates()` and `kernel.pools()`.
  
  This entry replaces the interim notes written during development with the package as it stands before its first versioned prerelease.
  
  The working notes written before this release are kept as history in [`docs/history/interim-changesets.md`](https://github.com/isoloop/isoloop/blob/main/docs/history/interim-changesets.md).

### Patch Changes

- f37983d: A consumer group no longer loses a record redelivered to a member (#211; ADR 0016, points 10–14). When a member left, its uncommitted records went to the others, and a member's next commit could cover one of them before its handler ran; if that member then stopped (a balancer move, say), nobody got the record again. Every `deliver` now carries a `seq`, counting deliveries to the subscription on its connection from 1, and every `commits` entry carries the highest `seq` settled whole with every delivery before it. A group commit covers only records with `offset ≤ offset` and `seq ≤ seq`, so a record redelivered after the deliveries it settled stays uncovered. Own subscriptions keep the offset rule, and host subscriptions send the same `seq`. `createCommitter`'s `settle` now takes `{ offset, seq }`, and `deliveryPoints` gives each record of a delivery its point.
  
  A consumer group that has a committed offset now resumes after it whatever `from` says: an emptied group rejoining with `from: 'earliest'` no longer replays the topic. `from` applies only before the group's first commit, or after its offsets were dropped with the topic, and a member joining a group that has members takes records from where the group is. Group members don't need `from: 'committed'` to keep their place.
  
  `ctx.bus.commit(record)` settles that record and every one delivered before it on its subscription, and a record delivered before a bus restart no longer commits on the new port.
- Updated dependencies [0e0ca1c]
- Updated dependencies [0e0ca1c]
- Updated dependencies [f37983d]
  - @isoloop/dom@0.1.0-next.0
  - @isoloop/protocol@0.1.0-next.0
