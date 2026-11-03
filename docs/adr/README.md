# Architecture decision records

Short records of decisions that shape Isoloop's design. Each has a status:

- **Proposed:** a recommended default, open to review.
- **Accepted:** binding; change it only with a new ADR that supersedes it.
- **Rejected / Superseded:** kept for history.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-one-worker-per-isolate.md) | Own worker per isolate by default; opt-in named pools (field reserved in v1, built in M2c); opt-in suspension (`suspend`); soft worker budget | Accepted |
| [0002](0002-host-owns-routing.md) | The host owns the URL; isolates see routes through a system topic | Proposed |
| [0003](0003-schema-format-standard-schema.md) | Standard Schema at runtime, JSON Schema exported for tools | Proposed |
| [0004](0004-npm-name.md) | Project renamed Federa → Isoloop; `@isoloop/*` packages | Accepted (names to claim) |
| [0005](0005-bus-topology-message-channels.md) | Isolates talk to the bus worker over direct `MessageChannel`s | Accepted |
| [0006](0006-render-bridge-over-remote-dom.md) | Remote DOM sits behind an internal `RenderBridge`; events use Isoloop's own protocol | Accepted (spike-gated) |
| [0007](0007-bus-worker-supervision.md) | Bus worker is supervised; isolates reattach after a bus crash; per-topic durability in OPFS (no replicas) | Accepted |
| [0008](0008-isolates-and-surfaces.md) | The unit is an *isolate*; a *surface* (DOM) is optional, so headless isolates are first-class | Accepted |

Template: **Context** (the forces at play), **Decision**, **Consequences** (good and bad), **Alternatives considered**.
