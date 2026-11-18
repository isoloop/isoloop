---
'@isoloop/protocol': minor
'@isoloop/runtime': minor
---

A runtime message for the inspection feed's block control ([ADR 0020](https://github.com/isoloop/isoloop/blob/main/docs/adr/0020-inspection-feed.md), decision 4), `@experimental`. A host-to-isolate `block { ms }` busy-loops the isolate's worker for `ms`, cut to `MAX_BLOCK_MS` (10 s), so a developer can watch containment work: the beat goes late and the supervisor acts as it would for a stuck isolate. For a pool member it blocks the whole worker, and the time is billed to that member's `busyMs`. The host sends it only for inspect access, which a later M4b task wires up; runtimes before this one ignore it.
