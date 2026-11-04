# M4: Devtools and 0.1 release (outline)

**Goal:** an overlay showing each isolate's loop health and a live bus log with replay; a docs site; the first npm release.

**Done when** (RFC 0001): `0.1.0` is published with a launch post.

Gets a full task list when M3 closes. Requires [M2b](m2b-durable-log.md) (durable log) to have landed.

## Main work items

1. **Devtools overlay** (`packages/devtools`): mounted on the host, reading `kernel.isolates()`, supervisor events, compositor stats and bus metrics from the control port. Panels: isolates (state, lag, heap, restarts, patch queue), bus (topics, rates, consumer lag and credit, rejected publishes), and a live record log sampled from the bus worker with the option to replay a topic into a scratch view.
2. **Docs site** (`docs/site`, e.g. VitePress or Starlight): getting started, hosting (CSP/CORS), isolate authoring per adapter, the bus guide (semantics, idempotent handlers), and **"What Isoloop can't hide"** (sync layout, `window`/`document` globals, drag and drop) up front, as the RFC asks. API reference generated from TSDoc.
3. **CLI** (unscoped `isoloop` package): `isoloop contracts export` → JSON Schema draft 2020-12 through the vendored Standard JSON Schema interface (input and output when they differ, plus `reply`; `unchecked` topics flagged; schemas without the interface reported as not exportable) ([ADR 0003](../adr/0003-schema-format-standard-schema.md)); maybe `isoloop new isolate`.
4. **Release pipeline:** Changesets, npm provenance, `@isoloop/*` scope claimed ([ADR 0004](../adr/0004-npm-name.md)), semver policy for the protocol version vs package versions.
5. **API review:** freeze public API names; mark experimental parts (groups, request/response) with `@experimental`.
6. **Launch post** with the M3 dashboard recording and bench numbers.

## Open risks

- Scope creep in devtools; ship the two panels and the log first.
- Docs time is easy to underestimate; start the "limits" page during M3.
