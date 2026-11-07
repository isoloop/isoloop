---
'@isoloop/bus': patch
---

After a bus restart, a reattached subscription to a persistent topic resumes after the offset it committed on the old bus, as ADR 0007 step 3 says, instead of starting at its `from` again. A `from: 'earliest'` subscriber no longer sees the records it already handled a second time. With no commit, it still starts at its `from`.
