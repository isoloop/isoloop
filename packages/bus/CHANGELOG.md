# @isoloop/bus

## 0.1.0-next.3

### Minor Changes

- 16b3e38: The host can request, and an app can expose tools to agents ([ADR 0018](https://github.com/isoloop/isoloop/blob/main/docs/adr/0018-tools-for-agents.md), decisions 2–6). All of it is `@experimental`.
  
  - `kernel.request(topic, value, { key?, timeoutMs?, signal?, via? })` mirrors `bus.request`: it resolves with the first valid reply, on any requestable topic, and the record carries `req: { from: 'host', id }`, plus `via` when given. It times out after 30 s by default, rejects with the new `BusError` code `aborted` when `signal` aborts, and with the new code `no_responder` at once when no isolate could answer (none with a subscribe grant for the topic, or all of them stopped or `failed`). An isolate that restarts within the timeout still gets the request and can answer it.
  - `createKernel({ agents: { expose: ['markets.quote.v1', 'markets.alerts.*'], timeoutMs? } })` lists the topics agents may call, with grant matchers. A matched topic without `reply`, without `tool`, or with a schema that doesn't make JSON Schema fails the start with `KernelError('not_exposable')`, naming the topic. A pattern that matches nothing warns on the console and emits the new `agents:unmatched` event once.
  - `kernel.tools()` lists the exposed tools: name, title, description, the flags, the input and output JSON Schemas (draft 2020-12, made once at start) and the agent timeout (10 s by default), for the dev MCP and `@isoloop/webmcp` to read.
  - Protocol: a host-to-bus `request` envelope. The run-time JSON Schema module now lives in `@isoloop/protocol`, so the host can use it; `@isoloop/bus` still re-exports it.
- fcb9fb5: A requestable topic can describe itself as a tool for agents: `topic(name, { …, reply, tool: { title?, description, readOnly, consequential?, untrustedContent? } })` ([ADR 0018](https://github.com/isoloop/isoloop/blob/main/docs/adr/0018-tools-for-agents.md), decision 1). `description` and `readOnly` are required, and `tool` without `reply` is a type error. Agents are offered only the topics the app lists in `agents.expose`. `tool` stays on the host and isn't part of the topic config the bus compares.
  
  Request records can carry `req.via` (`'mcp' | 'webmcp' | 'builder'`), the agent transport that made the call, with `isRecordReq` and `isRequestVia` guards. Persistent topics keep it. It's self-declared, so a handler may log or refuse by it but must never authorize by it. All of it is `@experimental`.
- 9137d5e: The bus side of the inspection feed ([ADR 0020](https://github.com/isoloop/isoloop/blob/main/docs/adr/0020-inspection-feed.md), decisions 2 and 3). `bus:metrics` now gives each topic its `head` (the next offset to be written) and `retained` (how many records it still holds). Everything else is groundwork for `kernel.inspect()`, which comes in a later M4b task, and is `@experimental`:
  
  - Protocol: a host-to-bus `tap` that copies records appended to matching topics onto a dedicated port, at most `maxPerSec` a second (default 50), and counts the rest as `skipped`. A tap is not a consumer: it has no cursor or credit and never shows in `bus:metrics`. A host-to-bus `read` returns a topic's last records (at most 100). Both send `RecordPreview`s: the value as JSON-like text cut to 2,048 characters, with its estimated size in bytes.
  - Bus: `LogEngine` gains `retained(topic)`, covered by the engine conformance suite.
  - Host (internal): the bus controller opens a tap again on each new bus worker after a crash, and keeps the bus restart count.

### Patch Changes

- 01a658a: Internal: the bus can make JSON Schema (draft 2020-12) from a topic's schemas through the vendored Standard JSON Schema interface (`~standard.jsonSchema`, Zod ≥ 4.2). A schema without the interface, an `unchecked()` schema, or a converter that throws comes back as a typed "not exportable" result. The kernel's agent tools and `isoloop contracts export` use it (ADR 0018, ADR 0003 decision 21).
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
  - @isoloop/codec@0.1.0-next.3

## 0.1.0-next.2

### Patch Changes

- @isoloop/codec@0.1.0-next.2
  - @isoloop/protocol@0.1.0-next.2

## 0.1.0-next.1

### Patch Changes

- @isoloop/codec@0.1.0-next.1
  - @isoloop/protocol@0.1.0-next.1

## 0.1.0-next.0

### Minor Changes

- 0e0ca1c: The log bus, run in its own worker (`@isoloop/bus/worker`). Topics are declared with `topic()` and a Standard Schema, validated in the broker, and gathered in one contracts module. Each subscriber has its own offset and a start position (`latest`, `earliest` or `committed`); commits go out together per port ([ADR 0016](https://github.com/isoloop/isoloop/blob/main/docs/adr/0016-fewer-messages-per-record.md)). Topics have retention, request and response, and an optional durable history in OPFS. A new topic version can be seeded from an older one, and isolates reattach after a bus restart ([ADR 0003](https://github.com/isoloop/isoloop/blob/main/docs/adr/0003-schema-format-standard-schema.md), [ADR 0007](https://github.com/isoloop/isoloop/blob/main/docs/adr/0007-bus-worker-supervision.md)). `@isoloop/bus/testing` has helpers for tests.
  
  This entry replaces the interim notes written during development with the package as it stands before its first versioned prerelease.
  
  The working notes written before this release are kept as history in [`docs/history/interim-changesets.md`](https://github.com/isoloop/isoloop/blob/main/docs/history/interim-changesets.md).
- f37983d: A consumer group no longer loses a record redelivered to a member (#211; ADR 0016, points 10–14). When a member left, its uncommitted records went to the others, and a member's next commit could cover one of them before its handler ran; if that member then stopped (a balancer move, say), nobody got the record again. Every `deliver` now carries a `seq`, counting deliveries to the subscription on its connection from 1, and every `commits` entry carries the highest `seq` settled whole with every delivery before it. A group commit covers only records with `offset ≤ offset` and `seq ≤ seq`, so a record redelivered after the deliveries it settled stays uncovered. Own subscriptions keep the offset rule, and host subscriptions send the same `seq`. `createCommitter`'s `settle` now takes `{ offset, seq }`, and `deliveryPoints` gives each record of a delivery its point.
  
  A consumer group that has a committed offset now resumes after it whatever `from` says: an emptied group rejoining with `from: 'earliest'` no longer replays the topic. `from` applies only before the group's first commit, or after its offsets were dropped with the topic, and a member joining a group that has members takes records from where the group is. Group members don't need `from: 'committed'` to keep their place.
  
  `ctx.bus.commit(record)` settles that record and every one delivered before it on its subscription, and a record delivered before a bus restart no longer commits on the new port.

### Patch Changes

- Updated dependencies [0e0ca1c]
- Updated dependencies [0e0ca1c]
- Updated dependencies [f37983d]
  - @isoloop/codec@0.1.0-next.0
  - @isoloop/protocol@0.1.0-next.0
