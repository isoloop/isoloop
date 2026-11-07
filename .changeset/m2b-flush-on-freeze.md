---
'@isoloop/protocol': minor
'@isoloop/bus': minor
'@isoloop/host': minor
---

Flush on freeze: when the page freezes or goes away (`freeze`, `pagehide`), the kernel sends the bus a `flush` control message and persistent topics are written at once instead of at the next group commit (M2b task 16).
