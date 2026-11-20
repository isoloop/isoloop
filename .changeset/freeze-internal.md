---
'@isoloop/host': minor
'@isoloop/runtime': minor
'@isoloop/bus': minor
'@isoloop/dom': minor
'@isoloop/vite': minor
'@isoloop/protocol': patch
'@isoloop/codec': patch
---

The API freeze marks Isoloop's own internals `@internal`, so they leave the public API and its reference: the bus's engine, storage and broker types and its helpers (`Broker`, `TsEngine`, `MemoryStorage`, `LogEngine`, `estimateSize`, `isContracts`, `topicConfig` and the rest), host's `HostRenderBridge`, runtime's `REQUIRES`, vite's `ISOLATES_ID`, `MANIFEST` and `WORKERS_ID`, and the worker DOM and applier in `@isoloop/dom/worker` and `@isoloop/dom/host`. They're still exported for the other `@isoloop/*` packages; app code shouldn't import them. `@isoloop/protocol` and `@isoloop/codec` say they're internal packages in their READMEs.
