---
'@isoloop/bus': minor
---

`OpfsStorage` keeps the committed offsets of persistent topics, written with the same group commit after the records, into two slot files in turn, so a write killed halfway leaves the previous offsets. `open()` restores them.
