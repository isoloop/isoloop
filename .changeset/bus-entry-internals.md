---
'@isoloop/bus': patch
---

`@isoloop/bus` no longer exports the names its entry carried for the bus worker's own use, all marked `@internal`: `Broker`, `TsEngine`, `MemoryStorage`, the engine and broker types (`LogEngine`, `LogStorage`, `BusPort`, `BrokerOptions` and the rest), and the helpers `publishId`, `estimateSize`, `effectiveDurability`, `toIssues`, `topicConfig` and `isUnchecked`. The public API is unchanged.
