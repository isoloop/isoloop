---
'@isoloop/dom': minor
'@isoloop/runtime': minor
'@isoloop/host': minor
---

New internal package `@isoloop/dom`, Isoloop's own render bridge (`isoloop-dom@1`, ADR 0010 and 0011). It has three entries: `/worker` (the DOM subset and its recorder), `/host` (the applier and node-id map) and `/testing` (the conformance suite).

`@isoloop/runtime` starts modules whose default export is `{ start(ctx) }`. They render into `ctx.root`, and when the isolate has a surface the DOM subset is installed as the worker's `document`. Function exports still run as legacy isolates.

`@isoloop/host` renders `isoloop-dom@1` through the component registry, with host-owned input rules. `HostRenderBridge` gains `idFor` and `nodeFor`. An isolate that reports a render format the host doesn't speak fails at once with reason `render-fmt-mismatch`, without a restart.
