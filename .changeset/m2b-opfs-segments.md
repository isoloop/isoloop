---
'@isoloop/bus': minor
---

`OpfsStorage`: persistent topics in the Origin Private File System, one directory per topic, 4 MiB segment files of length-prefixed frames with a CRC-32 each, written through sync access handles with a group commit every 5 ms or 256 records. The engine writes persistent topics through its storage, and the broker acknowledges a persistent publish only once its batch is on disk.
