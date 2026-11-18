---
'isoloop': minor
'@isoloop/protocol': patch
---

New: `isoloop mcp`, the dev MCP server ([ADR 0018](https://github.com/isoloop/isoloop/blob/main/docs/adr/0018-tools-for-agents.md), decision 8). An agent runs it over stdio (`claude mcp add isoloop -- npx isoloop mcp`), and pages in development connect to its WebSocket on `ws://127.0.0.1:4317` (`--port`). Each connected page's exposed tools (`kernel.tools()`) become MCP tools under their topic names, with their JSON Schemas and annotations (`readOnlyHint`, `destructiveHint` for `consequential`, and a description sentence for `untrustedContent`). Tools that change something (`readOnly: false`) are offered only with `--allow-write`. `isoloop_pages` lists the connected pages, and every tool takes an optional `page`; the default is the newest page that exposes it. A page is accepted only from an `Origin` matching `--origin` (default `http://localhost:*`) and with the run's token, printed on stderr or fixed through `ISOLOOP_MCP_TOKEN`. The page side is `connectDevMCP` from `@isoloop/host/dev-mcp`.

`@isoloop/protocol` gets the page wire's types, internal.
