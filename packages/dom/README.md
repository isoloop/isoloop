# @isoloop/dom

**Internal.** This is Isoloop's render bridge, format `isoloop-dom@1` ([ADR 0010](../../docs/adr/0010-own-render-bridge.md), [ADR 0011](../../docs/adr/0011-dom-package.md)). `@isoloop/runtime` and `@isoloop/host` depend on it. App and adapter code never imports it, and its API carries no semver promise beyond the format version: a breaking record change bumps it to `isoloop-dom@2`.

| Entry | Runs in | What it is |
| --- | --- | --- |
| `@isoloop/dom/worker` | isolate worker | The DOM subset Preact and React use, recorded as batches of plain records; `deliver()` dispatches host events with capture and bubble. |
| `@isoloop/dom/host` | main thread | The applier: applies batches through a required sanitising policy, maps node ids both ways, and turns DOM events into event records. |
| `@isoloop/dom/testing` | tests | The bridge conformance suite, `runBridgeConformance()`. It needs Vitest, an optional peer. |
| `@isoloop/dom/testing/usage` | tests | `trackUsage()`, the DOM usage logger (M3a task 2). Patches the subset for the whole realm, so it runs in a worker of its own. |

There's no root entry. The package has no runtime dependencies.
