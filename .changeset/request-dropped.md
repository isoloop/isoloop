---
'@isoloop/bus': minor
'@isoloop/protocol': minor
'@isoloop/host': patch
'@isoloop/runtime': patch
'@isoloop/webmcp': patch
---

A request that the topic's retention removes before the bus delivers it to any subscriber now fails at once with the new error code `dropped`, with the message "the request was dropped: the topic's retention was full; retry or raise retention" (ADR 0018, decision 5). Before, its caller waited out the whole timeout. It applies to `kernel.request` and to an isolate's own `bus.request`; a request already delivered stays its responder's to answer, and retention keeps its meaning. On a topic keeping 100 records, a burst of 1,000 calls at once now gets 100 answers and 900 `dropped`. The dev MCP reports it as a tool error, `dropped: <message>`, and `@isoloop/webmcp` rejects with the `BusError`. Size a tool's topic's retention for its largest burst of calls.
