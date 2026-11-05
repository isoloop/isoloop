---
'@isoloop/protocol': minor
'@isoloop/bus': minor
'@isoloop/host': minor
---

The host bus controller (ADR 0005, ADR 0007). With `contracts: { url, list }` and `workers.bus`, the kernel starts the bus worker before any isolate, gives each isolate a `MessageChannel` attached to the bus, and adds `kernel.publish` (rejecting with a `BusError`) and `kernel.subscribe`. The bus is supervised like an isolate: a crash starts a new bus worker and sends every running isolate `reattach` with a new port, and each memory-topic subscription gets one `reset`. `bus: { onReset: 'restart' }` restarts an isolate instead. Contract errors are fatal: `bus:failed { code }`, every isolate fails and `spawn` throws `bus_failed`. Past the restart limit, `bus:failed { reason }` and every publish rejects with `bus_unavailable`. New events: `bus:ready`, `bus:crash`, `bus:restart`, `bus:failed`, `bus:metrics`. Protocol: `TopicRef`, `TypedRecord`, `ContractsList`, `topicConfigOf`, and `attach.reattach`.
