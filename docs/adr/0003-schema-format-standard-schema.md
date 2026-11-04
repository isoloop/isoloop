# ADR 0003: Standard Schema at runtime, JSON Schema exported for tools

- **Status:** Accepted
- **Date:** 2026-11-03 (accepted 2026-11-04, after grilling)
- **Answers:** RFC 0001 open question "Zod only, or JSON Schema?"

## Context

The broker validates every record against its topic schema, and the broker runs in the bus worker. A Zod schema is code: it can't be structured-cloned to the bus worker. So the bus worker must load the schemas itself.

Non-JS tools (docs generators, backend producers, contract tests in other languages) want a data format, which means JSON Schema.

Runtime JSON Schema validators either compile with `new Function` (blocked by strict CSPs) or are slow interpreters.

Schemas can transform values (defaults, coercion, `.transform()`), and Standard Schema's `validate` may return a promise. Topics persist across sessions (ADR 0007), so a breaking change has to deal with data written under the old schema.

## Decision

### Schemas

1. **Runtime interface.** Topic definitions take any schema that implements [Standard Schema](https://standardschema.dev) V1 (`~standard.validate`). Zod 4, Valibot and ArkType all do. Isoloop vendors the interface type (about 40 lines) and depends on no schema library.
2. **Every topic has a schema.** `TopicDef.schema` is required. Isoloop ships `unchecked<T>()`, a tiny Standard Schema that accepts any value and only carries the type (input and output both `T`), as the explicit opt-out. Tools list unchecked topics, so no topic goes unvalidated by accident.
3. **Replies have schemas too.** A topic used with `bus.request` declares a `reply` schema. `request()` is typed only for such topics; on any other it rejects with `not_requestable`.

### The contracts module

4. **One source of truth.** `KernelConfig.contracts: { url: string; list: Contracts }`. The module at `url` has a default export `contracts(topicA, topicB, …)`, which rejects duplicate names; the bus worker `import()`s it and builds its topics only from that list. `list` is the same default export, imported statically by the host. Isolates bundle the same contracts package for types and topic handles. What host, isolates and bus share is the source, not one module instance.
5. **Boot check.** The host sends the cloneable part of each `TopicDef` in `list` (name, retention, durability, size limit, whether it has `reply`, `seed.from` and `seed.follow`). If it differs from the module's, the bus fails with `contracts_mismatch`, naming the topics. A host bundled against one contracts version and a URL serving another fails loudly at start, not quietly at the first publish.
6. **System topics** (`isoloop.*`, e.g. `isoloop.route.v1` from [ADR 0002](0002-host-owns-routing.md)) are built into the bus and defined in `@isoloop/protocol` with small hand-written Standard Schema validators. A contracts module that exports one fails with `reserved_topic`.
7. **Load failures are fatal.** `contracts_failed` (fetch or import threw), `contracts_invalid` (no `contracts()` default export), `contracts_mismatch` and `reserved_topic` are deterministic, so the bus supervisor doesn't retry them. Kernel start fails, the kernel emits `bus:failed { code }`, and no isolate is spawned.
8. **Isolates don't wait for contracts.** The bus accepts `attach` and `subscribe` while the module loads. It buffers publishes, using the same buffer as a bus restart, and validates them in order once contracts are in. Past the inbox limit it rejects with `bus_unavailable`.
9. **No hot swap.** The contracts loaded at boot stay until the page reloads. A bus restart re-imports the same URL. New contracts take effect on the next reload.

### Validation

10. **In the broker only.** It's authoritative and the only place a record is checked. Isolates and host code carry only the types, so isolate bundles don't include a schema library. A failed publish rejects with `invalid` and the issues as a cloneable `{ message, path: (string | number)[] }[]`.
11. **The log stores the validated output.** The broker appends `result.value`, not the published value, so subscribers get normalised data (defaults applied, coercions done). Publishers are typed with the schema's input type, subscribers with its output type: `TopicDef<In, Out>`. The output must be plain, structured-cloneable data. Persistent topics already check that: the codec rejects other values with `not_encodable` ([ADR 0007](0007-bus-worker-supervision.md)). For memory topics the broker checks with `structuredClone` in dev builds only, and production trusts the contracts. A non-cloneable output is a deterministic bug in host code that an isolate can't trigger with crafted data. `testContracts()` in `@isoloop/bus/testing` runs sample values through each schema and checks the output.
12. **Async schemas.** If `validate` returns a promise, the broker awaits it, but appends in publish order per topic, so a slow validation never reorders records.
13. **On publish only.** Replayed records, records read by late subscribers and records restored from OPFS aren't validated again.
14. **Unknown fields** follow the schema library's own rule (Zod strips them by default). The docs recommend the default, not strict mode, so newer producers stay compatible with older contracts. Deployment rule: contracts deploy before or together with their producers.

### Request/reply

15. The broker validates every `reply()` against the topic's `reply` schema and stores nothing (replies don't go through a log). An invalid reply rejects the responder's `reply()` with `invalid`, and the caller immediately gets `reply_invalid` instead of waiting for its timeout.
16. Only an isolate the broker delivered that request record to may reply. That means it holds the subscribe grant, or it's the group member that got the record. The first valid reply wins; later ones reject with `already_replied`.

### Versioning and seeding

17. **Topic names carry the major version** (`cart.items.v1`). Within a version a schema may only change compatibly: by adding optional fields. Anything else (removing or renaming a field, making one required, narrowing a type) is a new topic (`cart.items.v2`). Readers must tolerate missing optional fields, because old records are never validated again. Breaking changes are caught by reviewing the exported JSON Schema diff in CI.
18. **A topic can start from a migration** (M2b): `topic('cart.items.v2', { schema, seed: { from: cartItemsV1, map, follow? } })`.
    - On the first boot on a device where v2 declares the seed and v1 has data, v2 starts in a **seeding** state. Only v2 waits: its publishes are buffered and its subscribers get nothing until the seed completes, so history always comes before new records. The bus and other topics boot as usual.
    - The bus maps each v1 record (its stored output) with `map(value, record)` and validates the result against v2's schema. It appends the record, keeping the original `ts` and `producer`, and stores "seeded up to v1 offset N" in v2's metadata atomically with the appends. A crash resumes from N, so every record is copied **exactly once**. Seeding runs in the tab that holds the OPFS lock.
    - `map` must be pure and synchronous. A returned promise counts as a rejected record (`seed_async`). v2's schema may still be async.
    - A record that `map` throws on, or that v2's schema rejects, is **skipped and reported** with `bus:seed_rejected { topic, from, offset, issues }` (rate-limited). The record stays in v1. When v1's head is reached, v2 opens and the bus emits `bus:seeded { topic, copied, rejected }`, with the rejected v1 offsets also kept in v2's seed metadata. They aren't retried automatically; recovery is a migrator isolate that reads those offsets.
    - `follow: true` keeps mapping new v1 records into v2 as they arrive, for as long as the contracts list both topics. It's for gradual rollouts where some producers still publish v1; the default is `false`. The reverse direction (v2 records back to v1 readers) isn't covered. On memory topics v1 is empty at boot, so there only `follow` does anything.
    - With no v1 data (a fresh install) the seed does nothing. Seeds chain: v3 can seed from v2, which seeded from v1.
19. **Orphaned topics.** At boot, persistent topics in OPFS that the contracts no longer list are kept, not opened, and reported as `bus:orphaned_topics { names, bytes }`. Nothing is deleted automatically. `kernel.dropTopic(name)` deletes one. It rejects with `seed_pending` while a declared seed that reads from that topic hasn't completed on this device. It needs `{ force: true }` if rejected seed records from that topic are recorded, so losing them is always deliberate.
20. **Migrations a pure `map` can't express** (joining topics, calling a server) use a documented pattern: a headless migrator isolate ([ADR 0008](0008-isolates-and-surfaces.md)) that subscribes to v1 from `committed` and publishes to v2. It's at-least-once, so it can produce duplicates on non-compacted topics.

### Tooling

21. `isoloop contracts export` (M4) writes JSON Schema (draft 2020-12) for every topic version through [Standard JSON Schema](https://standardschema.dev/json-schema) (`~standard.jsonSchema.input/output`), another vendored interface, so no converter per library. It exports input and output schemas when they differ, and the `reply` schema. `unchecked` topics export as `{}` and are flagged. A schema without the interface is reported as not exportable; nothing else depends on it. Examples use Zod ≥ 4.2.

## Consequences

- No Zod lock-in, and no `eval` in the bus worker.
- The contracts module must be loadable as an ES module from the bus worker's origin (same-origin or CORS). It runs as code in the bus worker (schemas, transforms, seed maps), so it must be trusted host code. It holds data definitions and pure functions over them, never I/O.
- The schema library is loaded once, in the bus worker. Isolates start in parallel with it, but their first publishes wait for it (an M2 risk to measure).
- An invalid publish costs a round trip before the isolate learns about it.
- Subscribers can rely on every record matching the schema's output, including defaults, but the two sides have different types when the schema transforms.
- Every request/reply pair is validated in both directions, and responders can't be impersonated.
- Breaking changes cost a new topic name, but the bus moves the data: exactly once, resumable, and blocking only the new topic. Old data stays on disk until the host drops it on purpose, and the bus refuses drops that would lose data a pending seed still needs.
- More bus code in M2b: seed state per topic, the seed loop, orphan detection and `dropTopic`.
- JSON Schema is a derived artifact, so it can drift if not regenerated; CI in contract repos should check it.

## Alternatives considered

- **Zod only:** simplest, but locks users in and offers non-JS tools nothing.
- **JSON Schema as the source:** good for tools, but weaker TypeScript inference, and we'd own a JSON Schema validator in the worker.
- **Optional schemas:** less ceremony, but a forgotten schema looks the same as a deliberate one.
- **Isolate-side validation as well:** an immediate error, but every isolate bundles the schema library.
- **Store the published input:** one type for both sides, but defaults and coercion never apply and subscribers see raw data.
- **Host sends topic config, bus only looks up schemas:** two places define a topic, and they can disagree silently.
- **The bus scans every export of the contracts module:** picks up re-exported helpers by accident.
- **Retry contract load failures like bus crashes:** the error is deterministic, so a restart loop only hides it.
- **Unvalidated replies:** half of every request/response pair would have no contract.
- **Always check output cloneability:** one extra copy per record, to catch a bug only host code can introduce.
- **Migration only through a migrator isolate:** no new bus code, but at-least-once (duplicates), new timestamps, and the host writes and grants the isolate itself. Kept as the pattern for migrations a pure `map` can't express.
- **Seed halts on a rejected record:** keeps v2 complete, but one bad old record would leave v2 dead on that device.
- **Automatic deletion of orphaned topics:** destroys data whenever the contracts URL serves the wrong version.
- **A converter per library for export (`z.toJSONSchema` etc.):** works, but a dependency on each library's API instead of one interface.
- Deferred ideas (async seed `map`, `kernel.reseed()`, a `migrator()` helper, `isoloop contracts check`, hot contract reload) are listed in [would-like](../would-like.md).
