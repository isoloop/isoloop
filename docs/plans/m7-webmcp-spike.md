# M7: WebMCP spike (outline)

**Goal:** find out whether isolates should expose tools to browser agents through WebMCP, with each tool declared by a contract and allowed by a grant.

**Done when:** the findings are written up in `docs/investigations/webmcp.md` with a yes or a no, and, if yes, an ADR for the API is accepted by the user.

**Depends on:** [M6](m6-adapters.md). Comes before [M5](m5-shared-memory-engine.md). This is a spike: prototypes live on a `spike/m7-*` branch and aren't merged, as in [M5b](m5b-delivery-batching.md).

## Why

WebMCP lets a page register tools that an agent in the browser can call. Isoloop's contracts already export JSON Schema (M4's `isoloop contracts export`), and a bus request already has an input, a reply and a timeout, so a tool maps naturally onto a request handled by an isolate. Backend-less apps and the [Isoloop Builder](builder.md) could then be driven by browser agents directly.

## Where WebMCP stands (checked 2026-11-16)

- A draft report of the W3C Web Machine Learning Community Group, not on the standards track ([spec](https://webmachinelearning.github.io/webmcp/)).
- An origin trial in Chrome (from M149, extended to M162; M157 is listed as the planned ship) and Edge (from 150). No signal from Firefox or Safari.
- `document.modelContext.registerTool({ name, description, inputSchema, execute })`, with an async `execute`. It's `[Exposed=Window, SecureContext]`: the main thread only.
- Same-origin by default, behind a `tools` Permissions Policy. Asking the user before a tool runs is left to the agent.

## Shape to prototype

1. **Isolates declare tools in their contracts,** and a new grant allows an isolate to expose them.
2. **The host registers them** with `document.modelContext` behind a feature check, since only the main thread can.
3. **A call goes to the isolate over the bus** as a request, and the reply settles `execute`. A blocked or restarting isolate fails the call with the request's timeout, not the page.

## Questions to answer

- Whether the grant, the contract and the request timeout are enough, or tools need their own API.
- What the agent sees while an isolate restarts, and whether a tool should be unregistered then.
- What it costs the main thread per call.
- Whether to ship it at all while only one engine family has it.

## Open risks

- The API is still moving (it was renamed from `navigator.modelContext`); a spike now may need redoing when it ships.
