---
'@isoloop/balancer': minor
---

New package, `@experimental`: `createBalancer(kernel, opts)` places isolates spawned through it (M3h). One per kernel (`balancer_exists`). An isolate joins the `balancer-N` pool with room for its measured load, or gets a pool of its own within `maxWorkers`; one that spikes, crashes or kills its pool goes to a quarantine pool (`balancer-quarantine-N`) and comes back once steady, and a repeat offender is kept apart. Moves are a stop and a spawn with another `pool`, reported as `move` events. `measure(id)` gives any isolate's load over the last 3 s. Isolates spawned with `kernel.spawn` are never touched.
