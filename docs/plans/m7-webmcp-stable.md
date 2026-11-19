# M7: WebMCP to stable (outline, towards 1.0)

**Goal:** `@isoloop/webmcp` loses `@experimental` once WebMCP ships in a browser outside an origin trial, and follows the spec until then.

**Done when:** WebMCP has shipped in at least one engine, `@isoloop/webmcp` matches the shipped API, its tests run on the shipped browser without a flag, and its `@experimental` tag is dropped.

**Depends on:** [M4a](m4a-agents.md), which ships `@isoloop/webmcp` in 0.1. No longer after [M6](m6-adapters.md): it needs nothing from the adapters.

**Changed 2026-11-17:** this was a spike asking whether isolates should expose tools to browser agents through WebMCP. The [grilling](../investigations/ai-enablers.md) moved the tool surface and a first WebMCP transport into 0.1 as M4a, which answers the spike's questions:
- whether the contract, the opt-in and the request timeout are enough: yes, through ADR 0018;
- what the agent sees while an isolate restarts: tools stay registered, the call waits up to 10 s, and `no_responder` comes at once when nobody can answer;
- what a call costs the main thread: measured in M4a;
- whether to ship while only one engine family has it: yes, as an `@experimental` package of its own.

## Where WebMCP stands (checked 2026-11-17)

- A draft report of the W3C Web Machine Learning Community Group, dated 13 November 2026, not on the standards track ([spec](https://webmachinelearning.github.io/webmcp/)).
- Chrome: an origin trial from M149, extended to M162; Chrome Status still lists it as "Proposed". `--enable-features=WebMCP` turns it on, headless included (checked in Playwright 1.65's Chromium 158). Edge: an origin trial. Firefox has prefs (per Playwright's docs) that weren't tested. No signal from Safari.
- `document.modelContext.registerTool({ name, title?, description, inputSchema, outputSchema?, annotations, execute }, { signal })`, plus `getTools()`, `executeTool()` and the `toolchange`, `toolactivated` and `toolcancel` events. `[Exposed=Window, SecureContext]`: main thread only.

## Main work items

1. **Follow the spec until it ships:** renames, the shape of `executeTool`'s result, annotation changes. Roughly one evening per breaking change.
2. **Use `toolchange`:** keep the registered tools in step with the kernel while the page runs, for example when exposure changes at run time. 0.1 registers once.
3. **Reconsider a shim** for browsers without WebMCP, registering into an in-page registry the dev MCP and the Builder can read. 0.1 has none.
4. **Other engines** as they arrive: Firefox's prefs are followed since 2026-11-19 (`firefox-webmcp`, ADR 0018 decision 8), then Safari.
5. **How errors reach the agent:** Chromium shows only "Tool execution failed", with the `BusError` in the page's console; Firefox passes the message on. Follow it until the browsers agree.
6. **Drop `@experimental`** in the release after WebMCP ships.

## Open risks

- WebMCP may change shape again before it ships, or not ship at all. Then `@isoloop/webmcp` stays `@experimental`, and the dev MCP and the Builder still use the same tool surface.
