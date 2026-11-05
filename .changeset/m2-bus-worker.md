---
'@isoloop/protocol': minor
'@isoloop/bus': minor
---

The bus worker (`bus-worker.js`, exported as `@isoloop/bus/worker`). `boot` imports the contracts module, checks it against the host's topic list and fails with `contracts_failed`, `contracts_invalid`, `contracts_mismatch` or `reserved_topic`. `attach` and `detach` wire isolate ports to the broker, and publishes sent while the contracts load are buffered and validated in order. The worker sends `beat`, 1 s `metrics` and `error`, answers host publishes with `result`, and runs `time` and `compacted` retention every second.
