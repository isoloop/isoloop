---
'@isoloop/protocol': minor
'@isoloop/bus': minor
'@isoloop/runtime': minor
'@isoloop/host': minor
---

Experimental: batching per port per task (ADR 0016, decision 3), off by default. With `KernelConfig.bus.batch: true`, each end of a bus port (the isolate's bus client, the bus worker, and the host's own subscriptions) sends what it has for that port at the end of each task as one `batch { msgs }` message instead of one message per envelope. Every envelope inside keeps its own order, size limit, schema check, access rules, credit and details in reports. Receivers always accept a `batch`, whatever their own setting; with the setting off, nothing changes on the wire. Anything other than a boolean throws `invalid_config`. Measurement decides whether it becomes the default or is removed.

A synchronous `subscribe` handler now settles its record without an extra microtask, so its commit can share a batch with what it published.
