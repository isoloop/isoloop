---
'@isoloop/dom': minor
'@isoloop/runtime': minor
---

A pool's visual members render into their own roots in one shared document (ADR 0015). `@isoloop/dom/worker` adds `addRoot()`: each root sends its own batches and knows itself as `ROOT_ID` to its surface, and a node can't move from one member's root to another's. The runtime gives each visual pool member such a root. `@isoloop/dom/testing` adds `servePoolFixture()` and `mountMembers()` for pooled fixtures.
