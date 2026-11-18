---
'@isoloop/host': minor
'@isoloop/vite': minor
---

New, `@experimental`: `connectDevMCP(kernel, { token, url?, title? })` from the new entry `@isoloop/host/dev-mcp`, the page side of the dev MCP ([ADR 0018](https://github.com/isoloop/isoloop/blob/main/docs/adr/0018-tools-for-agents.md), decision 8). It dials `isoloop mcp`'s WebSocket (`ws://127.0.0.1:4317` by default) and sends the kernel's exposed tools (`kernel.tools()`). It answers each call with `kernel.request(tool.topic, input, { timeoutMs: tool.timeoutMs, via: 'mcp' })`, aborts the request when the agent cancels, and sends a failure's `BusError` code and message. It keeps retrying while the CLI isn't running, backing off to one try every 30 s, and stops on a wrong token. The returned function disconnects it. Import it behind `if (import.meta.env.DEV)`.

`@isoloop/vite` fails a production build whose output still contains `@isoloop/host/dev-mcp`, unless you pass `isoloop({ allowDevMcp: true })`. An import that is tree-shaken away, or dropped behind `import.meta.env.DEV`, passes.
