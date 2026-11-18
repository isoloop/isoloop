---
'@isoloop/host': minor
'@isoloop/protocol': minor
'@isoloop/runtime': minor
---

New, `@experimental`: the `inspect` grant, which gives an isolate the inspection feed and its controls ([ADR 0020](https://github.com/isoloop/isoloop/blob/main/docs/adr/0020-inspection-feed.md), decision 6).

- **`grants: { …, inspect: true }`** gives the isolate `ctx.inspector`; without it `ctx.inspector` is `undefined`. An isolate holding it can't be pooled: spawning one into a pool fails with `invalid_config`, because a pool merges its members' grants.
- **`ctx.inspector`** mirrors the host's `Inspector`, asynchronously: `snapshot()`, `on(fn)`, `records(topic, { last })`, `tap({ topics, maxPerSec? }, fn)`, and the controls `restart(id)`, `kill(id)` and `block(id, ms)`. It runs on a port of its own to the host, never through the bus, so it keeps working while the bus restarts and doesn't appear in the bus figures. The feed reaches the port only while the isolate listens.
- **The controls:** `restart` calls `kernel.restart`. `kill` ends the isolate's worker as a crash (`worker-error`), so the supervisor restarts it like any other. For a pooled isolate that's the pool's worker, so every member crashes and restarts. The call resolves once the kill is sent. `block` busy-loops the isolate's worker for up to 10 s, so you can watch the heartbeat go late and the supervisor act. After the host `Inspector`'s `close()`, or once `ctx.inspector`'s port has ended, the controls reject, while the last snapshot stays readable. Nothing gates them in production.
- **The host's `Inspector`** gains the same `tap`, `records`, `restart`, `kill` and `block`.
- **`heapBytes` is removed** from the beat and the feed's types. Nothing filled it: Chromium has `performance.memory` only on the main thread, not in workers. Memory per isolate comes from the host instead (ADR 0020, decision 4, amended).

The new isolate message (`inspect { port }`) is an addition to the host–isolate seam ([ADR 0012](https://github.com/isoloop/isoloop/blob/main/docs/adr/0012-isolates-built-apart.md)), so under [ADR 0019](https://github.com/isoloop/isoloop/blob/main/docs/adr/0019-versioning-and-releases.md) it ships in a minor. Runtimes before it ignore the message.
