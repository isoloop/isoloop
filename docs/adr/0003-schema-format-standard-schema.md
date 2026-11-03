# ADR 0003: Standard Schema at runtime, JSON Schema exported for tools

- **Status:** Proposed
- **Date:** 2026-11-03
- **Answers:** RFC 0001 open question "Zod only, or JSON Schema?"

## Context

The broker validates every record against its topic schema, and the broker runs in the bus worker. A Zod schema is code: it can't be structured-cloned to the bus worker. So the bus worker must load the schemas itself.

Non-JS tools (docs generators, backend producers, contract tests in other languages) want a data format, which means JSON Schema.

Runtime JSON Schema validators either compile with `new Function` (blocked by strict CSPs) or are slow interpreters.

## Decision

1. **Runtime:** topic definitions accept any schema that implements [Standard Schema](https://standardschema.dev) (`~standard.validate`). Zod 4, Valibot and ArkType all do. Isoloop depends only on the interface type, not on a library.
2. **Loading in the bus worker:** the kernel config takes a `contracts` module URL. The bus worker `import()`s it and reads its exported topic definitions. The same module is imported by host and isolates, so all three see one source of truth.
3. **Tooling:** `isoloop contracts export` (M4) writes JSON Schema per topic version, using the schema library's own converter (`z.toJSONSchema` for Zod 4). Examples use Zod 4.
4. **Topic names carry the major version** (`cart.items.v1`); a breaking schema change is a new topic.

## Consequences

- No Zod lock-in, and no `eval` in the bus worker.
- The contracts module must be loadable as an ES module from the bus worker's origin (same-origin or CORS).
- JSON Schema is a derived artifact, so it can drift if not regenerated; CI in contract repos should check it.

## Alternatives considered

- **Zod only:** simplest, but locks users in and offers non-JS tools nothing.
- **JSON Schema as the source:** good for tools, but weaker TypeScript inference and a runtime validator problem in the worker.
