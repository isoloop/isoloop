---
'@isoloop/bus': minor
'@isoloop/host': minor
'@isoloop/protocol': minor
'@isoloop/runtime': minor
---

Re-sent publishes are deduplicated on persistent topics (M2b task 20, ADR 0007 steps 5 and 6). Every publish and request from an isolate's `BusClient` or `kernel.publish` carries `(epoch, seq)`: the publisher's instance and a counter. The frame on disk stores it, the bus rebuilds the last 1,000 per producer and topic when it loads, and a re-send it already holds is answered with the original offset instead of appended again; a re-sent request gets the reply to the original record. Memory topics are unchanged. `kernel.publish` calls the bus never answered before a crash are now sent again to the new bus instead of rejecting with `bus_unavailable`.
