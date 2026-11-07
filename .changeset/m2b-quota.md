---
'@isoloop/bus': minor
'@isoloop/host': minor
'@isoloop/protocol': minor
---

Quota: bus metrics carry the origin's storage use while the bus keeps files, and the kernel emits `bus:quota { usage, quota }` once it reaches 80 %. When storage is full, or a write fails with `QuotaExceededError`, persistent publishes reject with the new error code `quota_exceeded`, and memory topics carry on.
