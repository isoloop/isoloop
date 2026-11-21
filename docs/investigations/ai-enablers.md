# Investigation: what making Isoloop "AI-enabled" costs

**Status:** decided 2026-11-17, in a grilling (Q1–Q34, yes to all). 0.1 gets agent support as [M4a](../plans/m4a-agents.md); M4 became an initiative ([M4](../plans/m4-devtools-release.md)); [M7](../plans/m7-webmcp-stable.md) became "WebMCP to stable"; the rest is in [Towards 1.0](../plans/README.md#towards-10). This page stays as the background. Where the grilling changed a recommendation below, the plan wins: exposure is the app's kernel config (`agents.expose`), not an `expose` grant on the isolate (a request reaches every subscriber of its topic), and `@isoloop/webmcp` ships in 0.1 as `@experimental`.
**Question:** what would it cost to start the AI work now, with WebMCP or with other AI enablers, and which ones are worth it?

Costs are in evenings (one task, 2–3 h, as in the [plan conventions](../plans/README.md#conventions)). They're estimates from reading the code and the specs, not measured.

## Four things "AI-enabled" can mean

| Layer | Who the agent is | What it does | Enablers |
| --- | --- | --- | --- |
| **A. Agents use an Isoloop app** | an agent in the browser (Gemini in Chrome, an extension) | calls tools the app exposes | WebMCP, a WebMCP polyfill, MCP Apps |
| **B. Agents inspect a running app** | a coding agent (Claude Code, Cursor) | reads isolates, topics, health; restarts | the M4 dev MCP, Chrome DevTools MCP, Playwright MCP |
| **C. Agents write Isoloop code** | a coding agent | builds or ports an app to Isoloop | `llms.txt`, `AGENTS.md`, an agent skill, a Claude Code plugin |
| **D. AI runs inside an Isoloop app** | a model in the page | inference, an agent loop | a remote API from a headless isolate, Transformers.js / WebLLM on WebGPU, Chrome's Prompt API |

## Where the enablers stand (checked 2026-11-17)

- **WebMCP.** The spec is a W3C Community Group draft, dated 13 November 2026, and not on the standards track ([spec](https://webmachinelearning.github.io/webmcp/)). Chrome runs an origin trial; outside it, `document.modelContext` needs a token or `chrome://flags/#enable-webmcp-testing`. Chrome Status still says "Proposed". Since M7 was written, the draft has added `getTools()`, `executeTool()`, an output schema, annotations (`readOnlyHint`, `consequentialHint`, `untrustedContentHint`), unregistering through an `AbortSignal`, and `toolchange` / `toolactivated` / `toolcancel` events. It's still `Window`-only. One audit in May found no mainstream agent calling these tools yet; Google says Gemini in Chrome will be the first. ([state of WebMCP, July 2026](https://www.spronta.com/blog/state-of-webmcp-july-2026/), [rename to `document.modelContext`](https://byteiota.com/webmcp-chrome-150-navigator-modelcontext-deprecation/))
- **WebMCP polyfills** (updated 2026-11-22). The Community Group publishes the official one, `@w3c/webmcp-polyfill` (0.1.1 on 2026-11-16, Apache-2.0, typed from `webmcp-types`, no runtime dependencies). `@mcp-b/webmcp-polyfill` has been deprecated since 2026-11-10 and is now a thin wrapper over it ([WebMCP-org/npm-packages#393](https://github.com/WebMCP-org/npm-packages/pull/393)). `@mcp-b/global` still adds an MCP bridge on top. A polyfill only helps if some agent reads it. `connectWebMCP` works with the W3C one unchanged (checked by hand on 2026-11-22 in Chrome 153: registration, `executeTool`, the duplicate check and disconnect). It can't be fully uninstalled once installed, so it doesn't suit per-test resets ([angular/angular#71959](https://github.com/angular/angular/pull/71959)).
- **MCP Apps** (`io.modelcontextprotocol/ui`): an MCP server returns `ui://` HTML that Claude, ChatGPT and VS Code render in a sandboxed iframe ([SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)). It needs an MCP server, which is outside the tab.
- **Chrome Prompt API** (`LanguageModel`): stable on the web since Chrome 148, desktop only, and **not available in workers** ([Chrome docs](https://developer.chrome.com/docs/ai/prompt-api)).
- **Transformers.js v4 / WebLLM:** both run in a dedicated worker on WebGPU, falling back to WASM. A worker that owns the model is their standard pattern ([Transformers.js v4](https://huggingface.co/blog/transformersjs-v4), [WebLLM](https://arxiv.org/abs/2412.15803v1)).
- **`llms.txt` / `AGENTS.md` / skills:** most dev-tool companies publish `llms.txt`. `AGENTS.md` and MCP are now under the Agentic AI Foundation. Secondhand reports of a Vercel benchmark say an inline `AGENTS.md` beat a skill on success rate ([1](https://www.mintlify.com/library/agents-md-vs-claude-md), [2](https://the-decoder.com/a-simple-text-file-beats-complex-skill-systems-for-ai-coding-agents/)). That evidence is vendor-heavy.

## What Isoloop already has

The groundwork for A and B is mostly there. WebMCP wouldn't start from scratch.

- **A tool is already a request.** A contract with a `reply` schema is requestable (`packages/protocol/src/topics.ts`). `bus.request()` validates the input, routes it to the handling isolate and rejects with `timeout` after `timeoutMs`, 30 s by default (`packages/runtime/src/bus-client.ts`). That matches a tool's `inputSchema`, `outputSchema` and `execute`.
- **Grants already gate the bus** (`packages/protocol/src/grants.ts`: `publish`, `subscribe`, `navigate`). Exposing tools would be one more grant.
- **JSON Schema export is planned, not built.** ADR 0003 §21 says the M4 CLI writes it through the vendored Standard JSON Schema interface, which includes `reply`. WebMCP needs the same conversion in the host at run time, or a manifest generated at build time.
- **Missing:** `kernel.inspect()` and the dev MCP (both M4), and the Builder's `fetch` grant, which `builder.md` says needs its own ADR because a worker-side wrapper can be bypassed.

## Options and costs

### A. Agents use an Isoloop app

**A1. WebMCP, native (pull M7 forward).** The host registers each tool on `document.modelContext`, since only the main thread can. A call becomes a bus request to the isolate, and its reply settles `execute`.

| Piece | Evenings |
| --- | --- |
| `tools` field on the contract (name, description, annotations) + `expose` grant + guard tests | 1–2 |
| Run-time JSON Schema from Standard JSON Schema (shared with the M4 CLI) | 1 |
| Host registrar: register and unregister through `AbortSignal`, restart handling (unregister or fail fast), `toolcancel` → abort the request | 2–3 |
| E2E: Playwright Chromium with the testing flag, `executeTool()` from the page, block or crash the isolate mid-call | 1–2 |
| Spike write-up + ADR draft | 1–2 |
| **Total** | **6–10** |

- **Reach:** Chrome and Edge, behind a token or a flag. Few agents call it today.
- **Risk:** the API has already moved once (`navigator` → `document`, and `provideContext` dropped). This is M7's own open risk.
- **Upkeep:** follow the draft until it ships, about one evening per breaking change.
- **Fit:** strong. A blocked or restarting isolate fails the call, not the page. That's the whole-package story (containment, restart, timeouts) applied to agents.

**A2. Our own small shim when `document.modelContext` is missing** (+1–2 evenings on top of A1). It registers into an in-page registry the dev MCP and the Builder can read. Writing ~100 lines ourselves fits "own the stack" better than taking a dependency on `@mcp-b/*`. It's only worth it as the registry that A3 needs anyway.

**A3. One tool surface, several transports.** Decide once that an isolate's tools are its requestable contracts plus a grant, and expose them through:
- WebMCP, in the page;
- the dev MCP, at dev time (M4 item 8);
- the Builder's agent, inside the app.

The surface costs the same as A1's first three rows. Each transport after that is 1–3 evenings. **This is the cheapest way to have all three later.** It touches public API, so it needs an ADR; ideally it lands with M4's API freeze (item 6), so it isn't renamed after 0.1.

**A4. MCP Apps.** Not now. It needs an MCP server, which breaks the tab boundary. The iframe is sandboxed, so OPFS, and with it persistent topics, may be missing; that would need its own spike. Unknown cost, probably 10+ evenings.

### B. Agents inspect a running app

- **B1. Chrome DevTools MCP / Playwright MCP: 0 evenings.** They work today, but they only see the main thread and the DOM. Surfaces are visible; isolate state, topics and health aren't. A short "debugging with agents" docs note: 1 evening.
- **B2. M4's dev MCP: 4–6 evenings** (CLI server, localhost WebSocket, read tools, `--allow-write`). It already depends on `kernel.inspect()`. If A3 comes first, calling an isolate's tools is one more read/write tool on it.

### C. Agents write Isoloop code

| Piece | Evenings | Note |
| --- | --- | --- |
| `llms.txt` + `llms-full.txt` generated from the docs at isoloop.dev build time (`isoloop/web`) | 1 | No API risk, because it's regenerated |
| `AGENTS.md` in `isoloop/isoloop`, `isoloop/examples` and the future `npm create isoloop` template | 1 | Index style (what's where, the rules), per the benchmark above |
| Agent skill "adapt an existing app to Isoloop" (already in [would-like](../would-like.md)) + a small eval set (3–5 apps) | 4–6 | After the M4 API freeze, or it's rewritten |
| Claude Code plugin bundling the skill + the dev MCP | 1 | After B2 |

C has the widest reach for the least work, works in every browser, and fits the 0.1 launch (a new library that agents already know how to use).

### D. AI runs inside an Isoloop app

- **D1. A model isolate (example, `isoloop/examples`): 4–6 evenings.** Transformers.js or WebLLM in an own-worker headless isolate (never pooled, `suspend: 'never'`) serves a requestable contract such as `ai.classify.v1`, and widgets call it. What to show: a model load or a hang that blocks the worker leaves the dashboard running, the supervisor restarts it, and requests time out cleanly. Same "report whatever it shows" method as the other examples. Probably no library change. It's a dependency in an example only, not in `@isoloop/*`.
- **D2. Remote LLM from a headless isolate** (the Builder's route C): already planned. Its cost is the `fetch` grant ADR plus the Builder itself. Doing that ADR earlier helps D1's model downloads too.
- **D3. Chrome Prompt API: not now.** It's `Window`-only like WebMCP, so it would need a host-side proxy, and it's on Chrome desktop only.

## Recommendation

1. **Now, outside the roadmap (2 evenings):** C's `llms.txt` and `AGENTS.md`. They're cheap, carry no API risk and cover every agent.
2. **In M4 (+3–5 evenings over the current plan):** A3's tool surface (the contract `tools` field, the grant, run-time JSON Schema) as part of the API freeze, with one ADR. The dev MCP then becomes its first transport.
3. **Right after 0.1, before M6 (4–6 evenings):** the M7 WebMCP spike on top of A3. M7 sits after M6 only by ordering; it needs nothing from the adapters. Pulling it forward costs M6 a few weeks, not work.
4. **After 0.1, parallel with M6 (4–6 evenings, examples repo):** D1, the model-isolate example. It needs no browser to ship anything, and it's the strongest "AI + Isoloop" story we can actually show.
5. **After the M4 API freeze:** C's agent skill + eval set, then the Claude Code plugin.
6. **Not now:** MCP Apps (A4), the Prompt API (D3), a docs MCP server (`llms.txt` covers it), and A2A/NLWeb (server-side, outside the tab).

Total for 1–5: about **19–28 evenings**. A WebMCP-only start (A1) is 6–10 of those, and it reaches the fewest agents today.

## Questions for the user

1. Is "AI-enabled" mainly A (agents drive apps) or C (agents build apps)? That decides whether WebMCP or the docs/skill work goes first.
2. Should A3 (one tool surface) go into M4's API freeze? It touches public API, so it needs an ADR.
3. Should M7 move ahead of M6?
4. Should D1 be an examples epic (e.g. M3j or M8)?
