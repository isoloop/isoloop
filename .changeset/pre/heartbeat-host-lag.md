---
'@isoloop/host': patch
---

The heartbeat kill (`heartbeat.killAfterMs`) and the ready timeout (`heartbeat.readyTimeoutMs`) no longer count time in which the page's main thread was waiting for a CPU. The supervisor adds up how late its own 50 ms check fired and leaves that time out of a worker's silence. A CPU-starved page, where beats are sent but the main thread can't hear them, no longer kills workers that are only slow. A silence of 3 × `killAfterMs` in wall-clock time still terminates the worker, and a start of 3 × `readyTimeoutMs` still times out, so a hung worker on a starved page is killed at most 3 times later. On a page that isn't starved nothing changes. The bus worker's kill and ready timeout work the same way. `blockedAfterMs` and the busy overlay, the restart window (`withinMs`), the healthy run (`healthyAfterMs`) and the backoff stay on wall-clock time.
