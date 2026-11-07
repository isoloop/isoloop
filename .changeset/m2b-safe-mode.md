---
'@isoloop/bus': minor
'@isoloop/host': minor
'@isoloop/protocol': minor
---

Safe mode (ADR 0007, decision 5): when the bus crashes twice in a row while loading, or within 2 s of `ready`, the next bus worker sets each persistent topic's newest segment aside and starts from the one before it. The kernel emits `bus:recovered { quarantined }`. Quarantined segments are kept on disk (`<segment>.to-<next>.quarantined`), and their offsets are never handed out again. A stored record the restore can't read now crashes the bus, so safe mode can recover from it; before, the bus fell back to memory.
