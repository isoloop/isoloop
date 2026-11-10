# Architecture decision records

Short records of decisions that shape Isoloop's design. Each has a status:

- **Proposed:** a recommended default, open to review.
- **Accepted:** binding; change it only with a new ADR that supersedes it.
- **Rejected / Superseded:** kept for history.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-one-worker-per-isolate.md) | Own worker per isolate by default; opt-in named pools (field reserved in v1, built in M2c); opt-in suspension (`suspend`); soft worker budget | Accepted |
| [0002](0002-host-owns-routing.md) | The host owns the URL; isolates opt in to `isoloop.route.v1` and need a grant to `navigate`; `kernel.syncRoute()`, `basePath`, routing can be turned off | Accepted |
| [0003](0003-schema-format-standard-schema.md) | Standard Schema at runtime (required, validated in the broker, output stored), contracts URL as the single source, topics seeded from older versions, JSON Schema exported for tools | Accepted |
| [0004](0004-npm-name.md) | Project renamed Federa → Isoloop; `@isoloop/*` packages | Accepted |
| [0005](0005-bus-topology-message-channels.md) | Isolates talk to the bus worker over direct `MessageChannel`s | Accepted |
| [0006](0006-render-bridge-over-remote-dom.md) | Remote DOM sits behind an internal `RenderBridge`; events use Isoloop's own protocol | Superseded by 0010 |
| [0007](0007-bus-worker-supervision.md) | Bus worker is supervised; isolates reattach after a bus crash; per-topic durability in OPFS (no replicas) | Accepted |
| [0008](0008-isolates-and-surfaces.md) | The unit is an *isolate*; a *surface* (DOM) is optional, so headless isolates are first-class | Accepted |
| [0009](0009-toolchain.md) | Toolchain: pnpm 12 workspaces, Node 26, TypeScript 7 (`tsc` checks), oxlint + oxfmt, tsdown with `isolatedDeclarations`, Vite 8, Vitest 5, Playwright; Baseline widely available; exact pins, no hooks | Accepted |
| [0010](0010-own-render-bridge.md) | Our own render bridge, `isoloop-dom@1`: a worker-side DOM subset sized to what Preact and React use, plain id-based records with one-record moves, no dependency; supersedes 0006 | Accepted |
| [0011](0011-dom-package.md) | `@isoloop/dom` holds the bridge: `/worker`, `/host` and `/testing` entries, each half type-checked with its own `lib`; no runtime dependencies; owns the `isoloop-dom@1` format; sanitising policy passed in; exact fmt match; published as internal; every `@isoloop/*` package in one `fixed` release group | Accepted |
| [0012](0012-isolates-built-apart.md) | Isolates built apart from the host are supported: the seam (`ctx`, the DOM subset, adapter hooks) only grows, isolates are stamped with `requires`, and the host runs `[FLOOR, VERSION]` (`runtime-too-old`, `isolate-too-old`) | Accepted |
| 0013 | *Withdrawn 2026-11-07, never accepted:* `@isoloop/local`, a single-thread kernel for the M3b comparison. The comparison is native against Isoloop instead ([M3b plan](../plans/m3b-dashboard.md), task 15), so no such kernel is needed | Withdrawn |
| [0014](0014-own-codec.md) | Our own binary codec for persistent topics, `isoloop-codec@1`: no library was more than 2× faster (at most 1.42×), ours is smaller on the wire and in the bundle | Accepted |
| [0015](0015-visual-pools.md) | Visual isolates may join pools: one `isoloop-dom` document per worker, one render root per member; records, events and host calls carry the member; no moves between members; mixed pools and mixed frameworks allowed; members can read each other's DOM and input (secrets stay on their own worker); a portal root per member; gate on memory, start-up and update latency first (M2d task 1) | Accepted |
| [0016](0016-fewer-messages-per-record.md) | Fewer bus messages per record: combined `commits` every ~100 ms (or at half the credit, and on shutdown); memory-topic publishes answer only on failure (`rejected`), with cumulative `acked` keeping re-send and back-pressure, `{ ack: true }` and persistent topics as today; envelopes sent in one task travel as one `batch`; one delivery per pool worker deferred | Proposed |

Ideas an ADR deferred are collected in [would-like](../would-like.md).

Template: **Context** (the forces at play), **Decision**, **Consequences** (good and bad), **Alternatives considered**.
