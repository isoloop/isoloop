# @isoloop/runtime

## 0.1.1

### Patch Changes

- Updated dependencies [164d266]
  - @isoloop/dom@0.1.1
  - @isoloop/protocol@0.1.1

## 0.1.0

The first release of what an isolate runs on.

- **One way to write an isolate:** `defineIsolate` with a `start(ctx)`, for a widget, a feed, an engine or a request handler.
- **Plain DOM in a worker:** create elements, listen to input and style your surface, and the host draws it.
- **The bus:** typed publish and subscribe, straight to the bus worker, with replay after a restart.
- **The page when you need it:** async calls to measure, focus, scroll, navigate and get a canvas to draw on.
- **A lifecycle:** shutdown handlers, error reporting, and a hold against suspension.
- **Unit tests without a worker:** `createTestContext` from `@isoloop/runtime/testing`.
- **Experimental:** consumer groups and request and reply.

The changes made during the previews are in the `0.1.0-next.N` sections below.

## 0.1.0-next.12

### Patch Changes

- 3afc5f8: Each package's homepage on npm is its page on isoloop.dev, and each has search keywords. The public packages' npm descriptions say that they're Isoloop's and what each one does.
- 03d13ef: Each package has a README on npm: what it gives you, how to install it, a small example, and links to its guides and API reference.
- Updated dependencies [2788228]
- Updated dependencies [3afc5f8]
  - @isoloop/protocol@0.1.0-next.12
  - @isoloop/dom@0.1.0-next.12

## 0.1.0-next.11

### Patch Changes

- @isoloop/dom@0.1.0-next.11
  - @isoloop/protocol@0.1.0-next.11

## 0.1.0-next.10

### Patch Changes

- b303cb3: TSDoc for every public export of `@isoloop/host`, `@isoloop/host/dev-mcp`, `@isoloop/runtime` and `@isoloop/runtime/testing`, and for the shared types they use (`BusError`, the inspection feed's types, `Grants`, `ErrorCode`, `TopicRef`): a lead sentence, `@param`, `@returns` and `@throws` with their error codes, every config and option field with its default, and examples on `createKernel`, `kernel.request`, `defineIsolate` and `connectDevMCP`. `Kernel`, `KernelConfig`, `IsolateHandle`, `IsolateState` and `CrashReason` are documented for the first time.
- Updated dependencies [8e03048]
- Updated dependencies [b303cb3]
- Updated dependencies [799ca7e]
  - @isoloop/dom@0.1.0-next.10
  - @isoloop/protocol@0.1.0-next.10

## 0.1.0-next.9

### Minor Changes

- e5f3377: The API freeze marks Isoloop's own internals `@internal`, so they leave the public API and its reference: the bus's engine, storage and broker types and its helpers (`Broker`, `TsEngine`, `MemoryStorage`, `LogEngine`, `estimateSize`, `isContracts`, `topicConfig` and the rest), host's `HostRenderBridge`, runtime's `REQUIRES`, vite's `ISOLATES_ID`, `MANIFEST` and `WORKERS_ID`, and the worker DOM and applier in `@isoloop/dom/worker` and `@isoloop/dom/host`. They're still exported for the other `@isoloop/*` packages; app code shouldn't import them. `@isoloop/protocol` and `@isoloop/codec` say they're internal packages in their READMEs.
- 5793b1a: Names settled for the API freeze:
  
  - `@isoloop/vite`: `IsolateManifest`, the type of `isoloop-manifest.json`, is now `BuildManifest`, so it no longer shares a name with host's spawn manifest.
  - `@isoloop/host`: `kernel.request`'s options type is now `KernelRequestOptions` (`key`, `timeoutMs`, `signal`, `via`).
  - `@isoloop/runtime`: exports `RequestOptions` (`key`, `timeoutMs`), the type of `bus.request`'s options. `@isoloop/react` and `@isoloop/preact` re-export it for `useRequest`, in place of their own copies.
  - `@isoloop/balancer`: `createBalancer` takes host's `Kernel`. `KernelLike`, `ManifestLike`, `BeatLike`, `CrashLike`, `FailedLike` and `PoolLike` are no longer exported, and every export is `@experimental`.
  - Marked `@experimental`: consumer groups (`SubscribeOptions.group`, `autoCommit`, `bus.commit`) and request/reply (`bus.request`, `bus.reply`, a topic's `reply` schema, `useRequest`, `RequestOptions`).

### Patch Changes

- Updated dependencies [e5f3377]
- Updated dependencies [18972a8]
  - @isoloop/dom@0.1.0-next.9
  - @isoloop/protocol@0.1.0-next.9

## 0.1.0-next.8

### Patch Changes

- Updated dependencies [c0884d2]
  - @isoloop/dom@0.1.0-next.8
  - @isoloop/protocol@0.1.0-next.8

## 0.1.0-next.7

### Patch Changes

- 3c354e8: A request that the topic's retention removes before the bus delivers it to any subscriber now fails at once with the new error code `dropped`, with the message "the request was dropped: the topic's retention was full; retry or raise retention" (ADR 0018, decision 5). Before, its caller waited out the whole timeout. It applies to `kernel.request` and to an isolate's own `bus.request`; a request already delivered stays its responder's to answer, and retention keeps its meaning. On a topic keeping 100 records, a burst of 1,000 calls at once now gets 100 answers and 900 `dropped`. The dev MCP reports it as a tool error, `dropped: <message>`, and `@isoloop/webmcp` rejects with the `BusError`. Size a tool's topic's retention for its largest burst of calls.
- Updated dependencies [3c354e8]
  - @isoloop/protocol@0.1.0-next.7
  - @isoloop/dom@0.1.0-next.7

## 0.1.0-next.6

### Patch Changes

- 0a22865: A pool's worker no longer closes itself when its last member says `bye`. It stays open until the host's loader terminates it after its last member. Before, the first `bye` after every member had left the routing table closed the worker. Members still shutting down lost their `bye`, so their stop waited out the full grace. A member the host had just sent `init` to never started, and from then on every start in that pool ended in a `ready-timeout`. In the File processor's fault runs on `0.1.0-next.5` (web `c4503e5`, a 4-core bench server at 2.0 GHz), it hit 3 of 15 balancer runs, as an image processor given up on in the first quarantine pool.
- Updated dependencies [8e04ddf]
  - @isoloop/protocol@0.1.0-next.6
  - @isoloop/dom@0.1.0-next.6

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

- 29f2296: New, `@experimental`: the `inspect` grant, which gives an isolate the inspection feed and its controls ([ADR 0020](https://github.com/isoloop/isoloop/blob/main/docs/adr/0020-inspection-feed.md), decision 6).
  
  - **`grants: { …, inspect: true }`** gives the isolate `ctx.inspector`; without it `ctx.inspector` is `undefined`. An isolate holding it can't be pooled: spawning one into a pool fails with `invalid_config`, because a pool merges its members' grants.
  - **`ctx.inspector`** mirrors the host's `Inspector`, asynchronously: `snapshot()`, `on(fn)`, `records(topic, { last })`, `tap({ topics, maxPerSec? }, fn)`, and the controls `restart(id)`, `kill(id)` and `block(id, ms)`. It runs on a port of its own to the host, never through the bus, so it keeps working while the bus restarts and doesn't appear in the bus figures. The feed reaches the port only while the isolate listens.
  - **The controls:** `restart` calls `kernel.restart`. `kill` ends the isolate's worker as a crash (`worker-error`), so the supervisor restarts it like any other. For a pooled isolate that's the pool's worker, so every member crashes and restarts. The call resolves once the kill is sent. `block` busy-loops the isolate's worker for up to 10 s, so you can watch the heartbeat go late and the supervisor act. After the host `Inspector`'s `close()`, or once `ctx.inspector`'s port has ended, the controls reject, while the last snapshot stays readable. Nothing gates them in production.
  - **The host's `Inspector`** gains the same `tap`, `records`, `restart`, `kill` and `block`.
  - **`heapBytes` is removed** from the beat and the feed's types. Nothing filled it: Chromium has `performance.memory` only on the main thread, not in workers. Memory per isolate comes from the host instead (ADR 0020, decision 4, amended).
  
  The new isolate message (`inspect { port }`) is an addition to the host–isolate seam ([ADR 0012](https://github.com/isoloop/isoloop/blob/main/docs/adr/0012-isolates-built-apart.md)), so under [ADR 0019](https://github.com/isoloop/isoloop/blob/main/docs/adr/0019-versioning-and-releases.md) it ships in a minor. Runtimes before it ignore the message.
- 12e43d0: `kernel.inspect()` now shows each isolate's memory, in Chromium on a cross-origin isolated page (ADR 0020, decision 4). The host measures with `performance.measureUserAgentSpecificMemory()` while a reader listens, at most every 5 s, and gives each isolate its worker's bytes as `memory: { bytes, at }`; a pool's members share their worker's figure (`shared: true`). The snapshot carries it and a new `memory` feed message sends it, to `ctx.inspector` too. Chromium answers at its next garbage collection, so a figure is coarse and can be many seconds old. Without cross-origin isolation, and in Firefox and Safari, there is no figure. `@isoloop/vite`'s existing `crossOriginIsolated: true` makes the dev and preview servers send the headers this needs. To tell workers apart, each one starts from `@isoloop/runtime/worker` with a fragment of its own. `virtual:isoloop/workers` now marks that entry's URL with `#isoloop-entry` for this, and the worker's `ready` reports that it started from it. Workers started from `@isoloop/runtime/bootstrap` directly keep one shared URL and get no memory figure. `@experimental`.
- c519268: A runtime message for the inspection feed's block control ([ADR 0020](https://github.com/isoloop/isoloop/blob/main/docs/adr/0020-inspection-feed.md), decision 4), `@experimental`. A host-to-isolate `block { ms }` busy-loops the isolate's worker for `ms`, cut to `MAX_BLOCK_MS` (10 s), so a developer can watch containment work: the beat goes late and the supervisor acts as it would for a stuck isolate. For a pool member it blocks the whole worker, and the time is billed to that member's `busyMs`. The host sends it only for inspect access; runtimes before this one ignore it.

### Patch Changes

- ce4dc9a: A consumer-group member that stops partway through a delivery now keeps the records it settled (ADR 0016, point 17). A commit entry carries `partial`, how many records of the next delivery are settled, in the order they arrived, and the broker covers those too. Before, a commit covered a delivery only once all its records were settled. So a member that crashed partway through a batch had its settled records sent again, and a record that crashed every member it reached, once settled, came back until the kernel gave up on all of them.
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

- 0e0ca1c: Runs inside each isolate's worker. `defineIsolate` for plain-DOM isolates; the bus client on `ctx.bus` (`publish`, `subscribe`, `request`); host calls for layout, focus and scrolling; heartbeats; `ctx.reportError` for an error that's the isolate's own; and opt-in suspension. `/bootstrap` and `/worker` are the entries the host loads.
  
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
