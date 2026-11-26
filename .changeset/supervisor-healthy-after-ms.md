---
'@isoloop/host': minor
---

`supervisor.healthyAfterMs` sets the healthy run, from `ready` to the last heartbeat, that clears the count of short runs. `supervisor.withinMs` is now only the sliding window that counts restarts. The default is 60 000 ms, so an app that sets neither behaves as before; an app that set only `withinMs` now gets a 60 000 ms healthy run, so set `healthyAfterMs` to the same value to keep the old behaviour. Any value other than a positive integer makes `createKernel` throw `invalid_config`. It applies to the bus worker too, and `isolate:failed`'s message quotes it when the short-run limit is met.
