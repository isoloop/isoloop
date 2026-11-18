---
'@isoloop/host': minor
'@isoloop/bus': minor
'@isoloop/protocol': minor
---

The host can request, and an app can expose tools to agents ([ADR 0018](https://github.com/isoloop/isoloop/blob/main/docs/adr/0018-tools-for-agents.md), decisions 2–6). All of it is `@experimental`.

- `kernel.request(topic, value, { key?, timeoutMs?, signal?, via? })` mirrors `bus.request`: it resolves with the first valid reply, on any requestable topic, and the record carries `req: { from: 'host', id }`, plus `via` when given. It times out after 30 s by default, rejects with the new `BusError` code `aborted` when `signal` aborts, and with the new code `no_responder` at once when no isolate could answer (none with a subscribe grant for the topic, or all of them stopped or `failed`). An isolate that restarts within the timeout still gets the request and can answer it.
- `createKernel({ agents: { expose: ['markets.quote.v1', 'markets.alerts.*'], timeoutMs? } })` lists the topics agents may call, with grant matchers. A matched topic without `reply`, without `tool`, or with a schema that doesn't make JSON Schema fails the start with `KernelError('not_exposable')`, naming the topic. A pattern that matches nothing warns on the console and emits the new `agents:unmatched` event once.
- `kernel.tools()` lists the exposed tools: name, title, description, the flags, the input and output JSON Schemas (draft 2020-12, made once at start) and the agent timeout (10 s by default), for the dev MCP and `@isoloop/webmcp` to read.
- Protocol: a host-to-bus `request` envelope. The run-time JSON Schema module now lives in `@isoloop/protocol`, so the host can use it; `@isoloop/bus` still re-exports it.
