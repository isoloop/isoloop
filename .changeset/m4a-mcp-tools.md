---
'isoloop': minor
'@isoloop/host': minor
---

New: the dev MCP's own tools (M4a decision 12). `isoloop mcp` now offers, on any page that passes a kernel with `inspect()`:

- reads, always: `isoloop_isolates` (state, pool, lag, time since the last beat, restarts, crash reason, busy time, compositor figures; and the pools), `isoloop_topics` (the bus's state and restart count, each topic's rates, head offset and retained count, each subscription's lag and credit, rejected publishes), `isoloop_records` (a topic's last records, at most 100, as 2 KB previews) and `isoloop_events` (the kernel's recent events, at most 200, each with how long ago it happened), all from `kernel.inspect()` ([ADR 0020](https://github.com/isoloop/isoloop/blob/main/docs/adr/0020-inspection-feed.md));
- with `--allow-write` only: `isoloop_restart`, `isoloop_kill`, `isoloop_block` (at most 10 s), `isoloop_publish` and `isoloop_request` (any requestable topic, with `via: 'mcp'`). Without the flag they aren't listed.

Every tool takes an optional `page`; the default is the newest page that can answer. `connectDevMCP` (`@experimental`) answers these through `kernel.inspect()`, opened on the first call and closed on disconnect, and still accepts a kernel without `inspect()` (it then offers only the app's tools).
