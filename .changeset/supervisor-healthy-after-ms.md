---
'@isoloop/host': minor
'@isoloop/cli': minor
---

breaking: `supervisor.healthyAfterMs` sets the healthy run, from `ready` to the last heartbeat, that clears the count of short runs, and `supervisor.withinMs` is now only the sliding window that counts restarts. On 0.1, `withinMs` was both. The default is 60 000 ms, so an app that sets neither behaves as before. An app that set only `withinMs` would now get a 60 000 ms healthy run: run `npx isoloop@latest migrate 0.2 --from 0.1 --write`, which sets `healthyAfterMs` to the same expression beside `withinMs` in a `createKernel` config and flags the configs it can't rewrite with `// isoloop-migrate:`. Any value other than a positive integer makes `createKernel` throw `invalid_config`. It applies to the bus worker too, and `isolate:failed`'s message quotes it when the short-run limit is met.
