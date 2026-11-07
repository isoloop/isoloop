---
'@isoloop/bus': minor
'@isoloop/host': minor
'@isoloop/protocol': minor
---

`follow`, orphaned topics and `kernel.dropTopic` (M2b task 19, ADR 0003 decisions 18–19). With `seed.follow`, new records on the source go on to the seeded topic after its seed, through `map` and its schema. A seed may read a topic the contracts no longer list; the bus keeps it for the seed but doesn't open it to isolates. At boot, persistent topics on disk that the contracts no longer list are kept and reported as `bus:orphaned_topics { names, bytes }`. `kernel.dropTopic(name, { force })` deletes one; it rejects with `seed_pending` while a declared seed that reads it hasn't ended, and with `invalid` for a listed topic or one with rejected seed records unless `force` is set.
