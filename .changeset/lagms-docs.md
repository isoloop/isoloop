---
'@isoloop/host': patch
'@isoloop/protocol': patch
'isoloop': patch
---

The docs of `lagMs` say what it measures: how late the last beat fired. A blocked worker sends no beat, so it keeps the last beat's value during the block; read `state` and the time since the last beat to see a block in progress. The `isoloop_isolates` tool description says so too.
