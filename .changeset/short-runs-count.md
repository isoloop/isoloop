---
'@isoloop/host': patch
---

A crash loop slower than the restart window now fails. A crash counts toward `supervisor.maxRestarts` when the isolate's healthy run before it (from `ready` to its last heartbeat) was shorter than `supervisor.healthyAfterMs`; a run of `healthyAfterMs` or longer clears the count. The sliding window still applies, and the isolate fails on whichever limit it meets first. Before, an isolate whose crashes took longer to detect than the window allowed restarted without end and never showed its fallback. The bus worker uses the same rule. The backoff grows with the larger of the two counts, Retry clears both, and `isolate:failed`'s message ends with the limit that was met.
