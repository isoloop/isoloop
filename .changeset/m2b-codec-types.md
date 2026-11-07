---
'@isoloop/codec': minor
'@isoloop/bus': minor
---

The codec covers the rest of the structured-clone types topics allow: `bigint`, `Date`, `Map`, `Set`, `ArrayBuffer`, typed arrays and `DataView`. The broker rejects a publish to a persistent topic whose value the codec can't encode with `not_encodable`; memory topics are unchanged.
