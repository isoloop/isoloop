---
'@isoloop/bus': minor
'@isoloop/protocol': minor
---

A requestable topic can describe itself as a tool for agents: `topic(name, { …, reply, tool: { title?, description, readOnly, consequential?, untrustedContent? } })` ([ADR 0018](https://github.com/isoloop/isoloop/blob/main/docs/adr/0018-tools-for-agents.md), decision 1). `description` and `readOnly` are required, and `tool` without `reply` is a type error. Agents are offered only the topics the app lists in `agents.expose`. `tool` stays on the host and isn't part of the topic config the bus compares.

Request records can carry `req.via` (`'mcp' | 'webmcp' | 'builder'`), the agent transport that made the call, with `isRecordReq` and `isRequestVia` guards. Persistent topics keep it. It's self-declared, so a handler may log or refuse by it but must never authorize by it. All of it is `@experimental`.
