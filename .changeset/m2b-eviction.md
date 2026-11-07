---
'@isoloop/bus': minor
---

Persistent topics keep only their recent records in memory, about 8 MiB each (`residentBytes`). Older ones are evicted, and a subscriber that starts from an evicted offset gets them read back from disk, segment by segment, in order. `LogEngine` gains `readable` and `page` for this.
