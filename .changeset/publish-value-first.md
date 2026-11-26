---
'@isoloop/runtime': minor
'@isoloop/host': minor
'isoloop': minor
'@isoloop/react': patch
'@isoloop/preact': patch
---

breaking: `ctx.bus.publish` and `kernel.publish` take the value first and the key in an options object, like `request`, `reply` and `usePublish`: `publish(topic, value, { key? })` instead of `publish(topic, { value, key? })`. `npx isoloop@latest migrate` rewrites the calls it can prove are Isoloop's and marks the ones it can't with a `// isoloop-migrate:` comment; see [From 0.1 to 0.2](https://isoloop.dev/docs/getting-started/#from-01-to-02). The record on the bus is unchanged.
