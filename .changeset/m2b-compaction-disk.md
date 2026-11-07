---
'@isoloop/bus': minor
---

Compacted persistent topics are compacted on disk too: once half of a topic's records on disk are superseded, the bus rewrites its older segments in the background, one segment between commits, keeping only the latest record per key. A crash at any point of the rewrite leaves either the old segments or the new ones.
