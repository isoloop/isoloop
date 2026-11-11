---
'@isoloop/protocol': minor
'@isoloop/bus': minor
'@isoloop/runtime': minor
'@isoloop/host': minor
---

Subscribers commit together (ADR 0016, decision 1). The `commit` message is replaced by `commits { offsets: { topic, offset }[] }`. The isolate's bus client and the host's own subscriptions send one per port per commit interval, instead of one per record. They send early at half a subscription's credit, before an unsubscribe, and first on a new port after a bus restart. On shutdown, for every reason, the client sends what's pending and waits for the broker before `bye`.

`KernelConfig.bus.commitIntervalMs` sets the interval: an integer from 0 to 1,000 (0 sends at the end of every task), default 100; anything else throws `invalid_config`. The cost: a worker killed without a graceful shutdown can have up to one interval of handled records delivered again.
