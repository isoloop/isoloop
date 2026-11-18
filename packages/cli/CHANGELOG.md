# isoloop

## 0.1.0-next.3

### Minor Changes

- 8adb14b: New: the `isoloop` command line, with `isoloop contracts export <module> [--out file]` ([ADR 0003](https://github.com/isoloop/isoloop/blob/main/docs/adr/0003-schema-format-standard-schema.md), decision 21). It loads a contracts module (its default export made by `contracts()`; a `.ts` module works on Node ≥ 26) and prints one JSON document with JSON Schema (draft 2020-12) for every topic, made through Standard JSON Schema (Zod ≥ 4.2): `schema`, or `input` and `output` when they differ, the same for `reply`, and the topic's `tool` annotations ([ADR 0018](https://github.com/isoloop/isoloop/blob/main/docs/adr/0018-tools-for-agents.md)). An `unchecked()` schema exports as `{}`, is listed under `unchecked` and warns. A schema without Standard JSON Schema, or one its converter can't express, is reported per topic, nothing is written and the exit code is 1. `isoloop mcp` and `isoloop skill add` follow in later M4a tasks.
- 235d488: New: the dev MCP's own tools (M4a decision 12). `isoloop mcp` now offers, on any page that passes a kernel with `inspect()`:
  
  - reads, always: `isoloop_isolates` (state, pool, lag, time since the last beat, restarts, crash reason, busy time, compositor figures; and the pools), `isoloop_topics` (the bus's state and restart count, each topic's rates, head offset and retained count, each subscription's lag and credit, rejected publishes), `isoloop_records` (a topic's last records, at most 100, as 2 KB previews) and `isoloop_events` (the kernel's recent events, at most 200, each with how long ago it happened), all from `kernel.inspect()` ([ADR 0020](https://github.com/isoloop/isoloop/blob/main/docs/adr/0020-inspection-feed.md));
  - with `--allow-write` only: `isoloop_restart`, `isoloop_kill`, `isoloop_block` (at most 10 s), `isoloop_publish` and `isoloop_request` (any requestable topic, with `via: 'mcp'`). Without the flag they aren't listed.
  
  Every tool takes an optional `page`; the default is the newest page that can answer. The `isoloop_` tool names are reserved: an app tool with one of them isn't listed (topic names can't collide in practice, since they're dotted like `markets.quote.v1`). `connectDevMCP` (`@experimental`) answers these through `kernel.inspect()`, opened on the first call and closed on disconnect, and still accepts a kernel without `inspect()` (it then offers only the app's tools).
- ffb3ef3: New: `isoloop mcp`, the dev MCP server ([ADR 0018](https://github.com/isoloop/isoloop/blob/main/docs/adr/0018-tools-for-agents.md), decision 8). An agent runs it over stdio (`claude mcp add isoloop -- npx isoloop mcp`), and pages in development connect to its WebSocket on `ws://127.0.0.1:4317` (`--port`). Each connected page's exposed tools (`kernel.tools()`) become MCP tools under their topic names, with their JSON Schemas and annotations (`readOnlyHint`, `destructiveHint` for `consequential`, and a description sentence for `untrustedContent`). Tools that change something (`readOnly: false`) are offered only with `--allow-write`. `isoloop_pages` lists the connected pages, and every tool takes an optional `page`; the default is the newest page that exposes it. A page is accepted only from an `Origin` matching `--origin` (default `http://localhost:*`) and with the run's token, printed on stderr or fixed through `ISOLOOP_MCP_TOKEN`. The page side is `connectDevMCP` from `@isoloop/host/dev-mcp`.
  
  `@isoloop/protocol` gets the page wire's types, internal.

### Patch Changes

- Updated dependencies [01a658a]
- Updated dependencies [ce4dc9a]
- Updated dependencies [16b3e38]
- Updated dependencies [ffb3ef3]
- Updated dependencies [fcb9fb5]
- Updated dependencies [9137d5e]
- Updated dependencies [29f2296]
- Updated dependencies [c099c70]
- Updated dependencies [12e43d0]
- Updated dependencies [c519268]
  - @isoloop/bus@0.1.0-next.3
  - @isoloop/protocol@0.1.0-next.3
