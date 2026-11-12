---
'@isoloop/runtime': patch
---

A synchronous subscription handler no longer yields a microtask per record: the bus client awaits a handler's result only when it is a promise. Async handlers are unchanged; a synchronous throw still stops the commits at the record before it.
