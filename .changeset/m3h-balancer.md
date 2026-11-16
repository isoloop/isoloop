---
'@isoloop/balancer': minor
---

New package, `@experimental`: `createBalancer(kernel, opts)` places isolates spawned through it (M3h). An isolate joins the auto pool with room for its measured load, or gets a pool of its own within `maxWorkers`; one that spikes, crashes or kills its pool goes to a quarantine pool and comes back once steady, and a repeat offender is kept apart. Moves are a stop and a spawn with another `pool`, reported as `move` events. Isolates spawned with `kernel.spawn` are never touched.
