# M4a: Agents (epic of [M4](m4-devtools-release.md))

**Goal:** 0.1 ships with agent support. Agents can learn Isoloop (`llms.txt`, `AGENTS.md`, a skill), see a running app (the dev MCP), and call tools an app exposes, at dev time through the dev MCP and in the browser through WebMCP.

**Status:** grilled 2026-11-17 (Q1–Q34, yes to all); background in the [investigation](../investigations/ai-enablers.md). In progress: tasks 1–4 (ADR 0018 and the tool surface), 5 (the `isoloop` CLI with `contracts export`), 6 (`isoloop mcp`: the stdio server, the WebSocket and pairing, with the pages' tools forwarded and `isoloop_pages`) and 7 (`connectDevMCP` from `@isoloop/host/dev-mcp`, and the `@isoloop/vite` production guard) done 2026-11-18, and 8 (the `isoloop_*` reads from `kernel.inspect()` and the `--allow-write` writes, with an E2E of the SDK client, the CLI and a page) done 2026-11-18, and 9 (`@isoloop/webmcp` and the `chromium-webmcp` project) done 2026-11-18. Firefox's WebMCP is supported since 2026-11-19 (ADR 0018's amendment, isoloop#266; the code and the `firefox-webmcp` project, isoloop#267). Task 10 (markets' tools, isoloop/web#168) done 2026-11-18, and 11 (`AGENTS.md` in both repos) done 2026-11-19. Task 13 (the cost per call on the bench server, [the investigation](../investigations/agent-call-cost.md), isoloop#287, with the harness in isoloop/web#187) done 2026-11-19; it found that a burst of 1,000 calls didn't complete on a topic keeping 100 records (isoloop#288, explained and fixed 2026-11-20: calls that retention removes fail at once with `dropped`, isoloop#303). The dev MCP's `isoloop_tap` was added 2026-11-19 (isoloop#282, after `0.1.0-next.5`). Task 14 (the real-agent run and the [write-up](../posts/m4a-agents.md)) done 2026-11-22; a real WebMCP agent wasn't available, so that stays untested. Task 12 (the skill and `isoloop skill add`, tried on the three prompts) done 2026-11-22 (isoloop#374), and published in `0.1.0-next.12` the same day, so `npx isoloop skill add` installs it from npm. **M4a is done.** An `unchecked()` topic exports as `{}` with a warning and exit 0, as ADR 0003 decision 21 says (the user confirmed it 2026-11-18); a tool still refuses it (`not_exposable`).

**Done when:**

- `llms.txt`, `llms-full.txt` and a Markdown copy of each docs page are served on isoloop.dev (built in [M4c](m4c-docs.md)).
- `AGENTS.md` is in `isoloop/isoloop` and `isoloop/web`, and getting started has an `AGENTS.md` snippet for users' apps.
- ADR 0018 is accepted.
- Markets exposes `markets.quote.v1` and `markets.alerts.create.v1`.
- An MCP SDK client lists and calls them through `isoloop mcp` (E2E).
- Playwright Chromium calls them through WebMCP (E2E), with block, crash and `failed` behaving as decisions 6 and 7 say.
- `npx isoloop skill add` installs the skill, and three hand-run prompts are recorded.
- The cost per call is measured on the bench server.
- A write-up, which includes one recorded run of Claude Code with the dev MCP on markets.

**Depends on:** M3h and [M3i](m3i-balancer-scaling.md) ([ADR 0017](../adr/0017-opt-in-balancer.md) and its amendment are the last public API changes before it). The dev MCP's inspection reads need [M4b](m4b-devtools.md)'s `kernel.inspect()`. The skill is finished after [M4d](m4d-release.md)'s API freeze.

## Decisions (2026-11-17)

### Tool surface (ADR 0018, "Tools for agents")

1. **A tool is a requestable topic.** A contract with a `reply` schema may add `tool: { title?, description, readOnly, consequential?, untrustedContent? }`. `description` and `readOnly` are required, so every author decides whether the tool changes anything; `tool` without `reply` is a type error. Transports map the flags to WebMCP's `readOnlyHint`, `consequentialHint` and `untrustedContentHint`, and to MCP's `readOnlyHint` and `destructiveHint`.
2. **The tool's name is the topic's name** (`markets.quote.v1`), which is valid in both WebMCP and MCP. A new topic version is a new tool.
3. **The app opts in, not the isolate.** A request reaches every subscriber of its topic and the first valid reply wins, so exposure belongs to the topic. The app's kernel config lists what agents may see: `agents: { expose: ['markets.quote.v1', 'markets.alerts.*'], timeoutMs? }`, with the grant matchers. Isolates built apart ([ADR 0012](../adr/0012-isolates-built-apart.md)) can't expose anything on their own.
4. **The kernel checks at start.** A pattern that matches a topic with no `reply`, no `tool`, or a schema without [Standard JSON Schema](https://standardschema.dev/json-schema) fails the start with `not_exposable`, naming the topic. A pattern that matches no topic is a warning. The JSON Schema is made at run time through the same vendored interface as `isoloop contracts export` ([ADR 0003](../adr/0003-schema-format-standard-schema.md), decision 21).
5. **`kernel.request(topic, value, { timeoutMs, signal })`,** public and `@experimental`, mirrors `kernel.publish`. The record carries `req: { from: 'host', id, via }` (`'host'` is the bus's existing host producer id; ADR 0018 decision 4), and transports set `via` (`'mcp'`, `'webmcp'`, later `'builder'`), so a handler can refuse agent calls or log them. The protocol addition is part of ADR 0018.
6. **Agent calls time out after 10 s by default** (`agents.timeoutMs`); `kernel.request` keeps the bus's 30 s. The record stays in the log, so an isolate that restarts within the timeout still gets the call and replies.
7. **`no_responder` at once.** If every isolate allowed to subscribe to the topic has given up (`failed`) or was never spawned, the kernel fails the call straight away instead of waiting out the timeout. It checks grants and isolate states on the host; the bus doesn't change. Tools stay registered either way.
8. **Handlers must be idempotent by `req.id`.** A crash after the side effect but before the reply delivers the record again, as for any handler (the bus guide's rule). The markets example shows how. De-duplication in the bus is in [would-like](../would-like.md).

### Dev MCP

9. **`isoloop mcp`** is our own stdio MCP server in the CLI (`initialize`, `tools/list`, `tools/call`, `notifications/tools/list_changed`, about 300 lines). The official `@modelcontextprotocol/sdk` client is a dev dependency, used only in conformance tests.
10. **Pairing.** The server also listens on `ws://127.0.0.1:4317` (`--port`). It prints a token on stderr each run, or takes a fixed one from `ISOLOOP_MCP_TOKEN`, and accepts only that token from an `Origin` matching `--origin` (default `http://localhost:*`). The docs show `claude mcp add isoloop -- npx isoloop mcp` and a `.mcp.json` example.
11. **The page side is a separate entry,** `connectDevMCP(kernel, { url, token })` from `@isoloop/host/dev-mcp`, imported behind `if (import.meta.env.DEV)`. `@isoloop/vite` fails a production build that still contains it, unless `allowDevMcp: true`. No kernel option, so nothing ships to production by accident.
12. **Tools.**
    - Our own are prefixed `isoloop_`. Reads: `isoloop_pages`, `isoloop_isolates`, `isoloop_topics`, `isoloop_records` (the last N of a topic), `isoloop_tap` (a live sample for up to 10 s, with what the 50/s cap skipped; added 2026-11-19), `isoloop_events` (recent supervisor events). With `--allow-write`: `isoloop_restart`, `isoloop_kill`, `isoloop_block`, `isoloop_publish`, `isoloop_request` (any topic).
    - The app's exposed tools are forwarded under their own names. Those with `readOnly: true` are always available; the others need `--allow-write`.
    - `list_changed` is sent when a page connects or reloads.
    - The reads come from [ADR 0020](../adr/0020-inspection-feed.md)'s feed: `isoloop_records` uses `inspector.records()`, `isoloop_tap` `inspector.tap()` with `onSkipped`, `isoloop_events` the ring buffer of recent events, and `isoloop_block` the runtime's `block { ms }`.
13. **Several tabs.** `isoloop_pages` lists the connected pages (URL, kernel id). Every tool takes an optional `page`; the default is the page that connected last.

### WebMCP

14. **`@isoloop/webmcp`,** `@experimental`, its own package in the Changesets fixed group (a placeholder publish first). `connectWebMCP(kernel): () => void` checks for `document.modelContext` and does nothing if it's missing. It registers each exposed tool with an `AbortSignal` (the returned function aborts them all), and maps `toolcancel` to the request's `signal`. No shim in 0.1; the dev MCP covers browsers without WebMCP during development. *2026-11-22:* the Agents guide notes that `@w3c/webmcp-polyfill` works with `connectWebMCP` unchanged on Chromium (on Firefox it registers on the polyfill, not Firefox's own context); checking our types against `webmcp-types` and a polyfill conformance test are M7 items 4 and 5.
15. **Tested on every PR** in a Playwright project `chromium-webmcp`, launched with `--enable-features=WebMCP`. That works headless in Playwright 1.65's Chromium 158 with no origin-trial token (checked 2026-11-17). Tests call tools through `page.webmcp`, wrapped in our own helper so a Playwright change touches one file. Cases:
    - the registered tools match `agents.expose`, with their schemas and annotations;
    - a call returns the reply;
    - an isolate blocked mid-call → the call times out (shortened in the test) and the page keeps running;
    - a crash → restart, and the reply still arrives in time;
    - every responder `failed` → `no_responder` at once;
    - the returned function → all tools gone;
    - no flag → `connectWebMCP` does nothing.

    Firefox's prefs (`dom.modelcontext.enabled`, per Playwright's docs) are tried in the first WebMCP task. If they work, a Firefox project is added; if not, the write-up says so. *Outcome 2026-11-19:* they work with `dom.modelcontext.testing.enabled` too, and `firefox-webmcp` runs on every PR (ADR 0018 decision 8, amended; isoloop#267).

### Learning Isoloop

16. **`AGENTS.md`** in `isoloop/isoloop` and `isoloop/web` (the examples moved into `isoloop/web`), for agents contributing to those repos. It holds the rules (one PR per task, neutral language, never claim Isoloop is faster than native) and what an agent can't find in one look; *changed 2026-11-19 (isoloop#286, isoloop/web#186):* no index of where things are, since listing the folders costs less than carrying it in every session. Each repo gets a `CLAUDE.md` that imports it. Getting started ([M4c](m4c-docs.md)) gets a snippet for users' own apps.
17. **The "build with Isoloop" skill** uses the open Agent Skills format (`skills/build-with-isoloop/SKILL.md` in this repo). It covers isolates, contracts, grants, kernel config, exposing tools, pointers to pools and the balancer, and "What Isoloop can't hide". `npx isoloop skill add` copies it into `.claude/skills/` (or `--dir`), so the skill matches the CLI's version, and `llms.txt` links to it.
18. **The skill is tested by hand before 0.1** with three prompts (vanilla, React, Preact: "a widget isolate that subscribes to X and draws Y"). An answer passes if the result type-checks and its own small E2E passes. Results go in the write-up. CI evals come with the 1.0 porting skill.

### Proof and release

19. **Markets exposes two tools** in `markets-v0.6.0` (on `next` prereleases until 0.1):
    - `markets.quote.v1`, read-only: the latest price and stats for a symbol, answered by the aggregator;
    - `markets.alerts.create.v1`, consequential and idempotent by `req.id`: adds an alert rule, answered by the alerts isolate.
20. **The cost per call is measured** on the bench server: main-thread time and round-trip time per `kernel.request`, on an idle page and on plant at `?rate=5`. It's recorded in the write-up whatever it shows. There's no native baseline, since native has no bus.
21. **A run with a real agent.** One recorded run of Claude Code with the dev MCP on markets (for example "which isolate is lagging?", then "create an alert for BTC above X" with `--allow-write`), written up as it went. A real WebMCP agent (Gemini in Chrome) is tried if one is available to us; otherwise the write-up says it's untested.
22. **The launch post** ([M4d](m4d-release.md)) gets an "Isoloop for agents" section in neutral language: what agents can do, what it costs, and that WebMCP is behind a flag in Chromium and in Firefox (*2026-11-19:* was "Chrome-only" before Firefox's support).

## Tasks

About one evening each ([conventions](README.md#conventions)). Forks follow the usual rules: one PR per task, squash-merged on green CI. ADR 0018 goes to the user, and so do any findings that contradict it.

| # | Task | Files | Tests |
| --- | --- | --- | --- |
| 1 | ADR 0018 "Tools for agents" (decisions 1–8, 10, 11, 14) | `docs/adr/0018-tools-for-agents.md` | — (user review) |
| 2 | `tool` on topic definitions; the `via` field on request records | `packages/bus/src/topic.ts`, `packages/protocol/src/{bus,topics}.ts` | type tests (`tool` needs `reply`), envelope guards |
| 3 | Run-time JSON Schema through Standard JSON Schema | `packages/bus/src/standard-schema.ts` (or a shared module the CLI reuses) | unit: Zod ≥ 4.2 input/output/reply; not exportable |
| 4 | `kernel.request` with `signal`, `agents.expose`, the start check, `no_responder` | `packages/host/src/kernel.ts`, `packages/host/src/agents.ts` | unit + browser: reply, timeout, abort, `not_exposable`, `no_responder` |
| 5 | The `isoloop` CLI package and `contracts export` | `packages/cli` | unit: export of a fixture contracts module |
| 6 | `isoloop mcp`: stdio server, WebSocket, pairing | `packages/cli/src/mcp/` | conformance with the SDK client; bad token and bad Origin rejected |
| 7 | `connectDevMCP` + the `@isoloop/vite` production guard | `packages/host/src/dev-mcp.ts`, `packages/vite` | unit; build test failing with it in a production bundle |
| 8 | Dev MCP tools: reads, writes, forwarded app tools, pages | `packages/cli/src/mcp/tools.ts` | E2E: SDK client ↔ CLI ↔ a test page (needs M4b's feed for the reads) |
| 9 | `@isoloop/webmcp` + the `chromium-webmcp` project (+ the Firefox try) | `packages/webmcp` | E2E: decision 15's cases |
| 10 | Markets tools (examples repo) | `apps/dashboards/markets/src/contracts.ts`, the aggregator and alerts isolates | unit (idempotent create); E2E through both transports |
| 11 | `AGENTS.md` × 2 + `CLAUDE.md` imports (done 2026-11-19) | `isoloop/isoloop`, `isoloop/web` | — |
| 12 | The skill + `isoloop skill add` (done 2026-11-22, #374, in `0.1.0-next.12`) | `skills/build-with-isoloop/`, `packages/cli/src/skill.ts` | unit: copy; the three hand-run prompts |
| 13 | Cost per call on the bench server (done 2026-11-19, #287) | `docs/investigations/agent-call-cost.md` | — (measurement) |
| 14 | Real-agent run + the M4a write-up (done 2026-11-22, #378) | `docs/posts/m4a-agents.md` | — |

## Open risks

- WebMCP's API is still moving: `navigator` → `document`, `provideContext` dropped, and the shape of `executeTool`'s result. `@isoloop/webmcp` is `@experimental`, and [M7](m7-webmcp-stable.md) follows the spec to its ship.
- No mainstream agent may call WebMCP tools by 0.1, so the in-browser demo may only run under Playwright. The write-up says so plainly.
- A consequential tool runs on agent input. The annotations tell the agent; confirming with the user is the agent's job, and the docs say both.
