---
'@isoloop/host': patch
---

When a pool's worker fails, every other member's crash message is the same one line, with one member named. Each message used to wrap the one before it, so in a large pool they grew very long and each named a different member.
