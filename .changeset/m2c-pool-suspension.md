---
'@isoloop/protocol': minor
'@isoloop/runtime': minor
'@isoloop/host': minor
---

Pool suspension (M2c, ADR 0001): a pool's beat carries each member's idle report (`beat.p.members`), and a pool suspends only as a whole, when every member that isn't stopped or failed is idle under its own `suspend` setting; the worker goes with it. Any member's wake condition (a record, `kernel.resume`) wakes the whole pool. Registering a pool member that asks for `suspend` alongside one that never suspends warns once that the setting has no effect.
