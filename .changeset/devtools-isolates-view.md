---
'@isoloop/devtools': minor
---

The panel's isolates view lists every isolate. For each one it shows the state, lag, busy time, memory (Chromium, cross-origin isolated, with its age), crash restarts, the patch queue and the pool, and it marks the panel itself as `devtools`. A table under it lists each pool and its members. Each isolate has Restart, Kill and Block 2 s controls; Kill on a pool member ends the whole pool's worker.
