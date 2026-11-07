---
'@isoloop/bus': minor
---

Retention on disk: `last-n` and `time` topics delete whole segments once every record in them is out of retention (`LogStorage.dropBelow`, applied after the commit that writes them). `flush()` also waits for a commit still writing.
