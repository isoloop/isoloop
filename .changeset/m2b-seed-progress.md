---
'@isoloop/bus': minor
'@isoloop/host': minor
'@isoloop/protocol': minor
---

Seeding, exactly once: seed progress is saved with every batch, after the batch's records, so a seed cut short resumes without copying a record twice. A source record that `map` throws on, returns a promise for (`seed_async`), or the topic's schema rejects is skipped, recorded and reported as `bus:seed_rejected` (at most 10 a second per topic); the kernel emits `bus:seeded { topic, copied, rejected }` when the seed ends. A seed that ended doesn't run again (M2b task 18).
