---
'@isoloop/bus': minor
'@isoloop/host': minor
'@isoloop/protocol': minor
---

One tab owns the OPFS files: the bus worker takes the Web Lock `isoloop-bus`. A bus in another tab runs every topic in memory, and the kernel emits `bus:durability-degraded { reason: 'another-tab' }`. The same event, with `open-failed`, now replaces the console-only warning when the files can't be opened or read back. A bus restarting in the owning tab waits up to 2 s for the lock.
