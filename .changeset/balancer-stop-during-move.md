---
'@isoloop/balancer': patch
---

`stop(id)` during a move no longer throws "No isolate": it cancels the move, respawns nothing and resolves once the old copy has stopped.
