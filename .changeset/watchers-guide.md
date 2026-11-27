---
'@isoloop/react': patch
'@isoloop/preact': patch
'@isoloop/runtime': patch
---

- The docs of `useWatch` and `ctx.bus.watch` now say to use `subscribe` to get every record. `useTopic` shows only the newest value, so it doesn't get every record either.
- The docs of `useTopic` say that every record reaches the isolate, and point to `useWatch` for showing the current value per key.
