---
'@isoloop/host': minor
---

A new kernel event, `isolate:beat` `{ id, pool?, lagMs, busyMs?, at }`, reports every heartbeat as it arrives, once per member of a pool (ADR 0017). It is emitted only while someone listens. `@isoloop/balancer` reads every beat through it instead of polling `isolates()`, which keeps only the latest one.
