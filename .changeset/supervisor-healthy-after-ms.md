---
'@isoloop/host': minor
'isoloop': minor
---

breaking: `supervisor.healthyAfterMs` is the healthy run, from `ready` to the last heartbeat, that clears the count of short runs. `supervisor.withinMs` is now only the sliding window that counts restarts; before, it was both.

The default is 60 000 ms, so an app that sets neither behaves as before. An app that set only `withinMs` would now get a 60 000 ms healthy run instead: run `npx isoloop@latest migrate 0.2 --from 0.1 --write`, which sets `healthyAfterMs` to the same expression beside `withinMs` in a `createKernel` config and flags with `// isoloop-migrate:` the configs it can't rewrite ([the codemod](https://github.com/isoloop/isoloop/blob/main/packages/cli/src/migrate/0.2/healthy-after-ms.ts), [the options](https://github.com/isoloop/isoloop/blob/main/docs/guide/supervision.md#configuring-it)).

Any value other than a positive integer makes `createKernel` throw `invalid_config`. The bus worker follows it too, and `isolate:failed`'s message quotes it when the short-run limit is met.
