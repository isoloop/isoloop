---
'@isoloop/host': patch
---

When a pool's worker stops responding or fails, every member's crash carries the same one-line message, such as `pool "widgets" restarted: its worker stopped responding (No heartbeat for 10000 ms)`. It names no member, because the kernel can't know which one caused it. It used to blame the first member it checked, and each message wrapped the one before it. A kill through the inspection feed still names the member that was killed.
