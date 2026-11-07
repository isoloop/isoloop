---
'@isoloop/bus': minor
'@isoloop/protocol': minor
---

Seeding: `topic(name, { seed: { from, map, follow } })` starts a topic from an older one (ADR 0003, decision 18). When the topic is empty and its source has records, the bus that holds the files copies them through `map` and the topic's schema, keeping `ts` and `producer`. Until the seed ends, the topic's publishes wait and its subscribes are answered late; other topics don't wait. `contracts()` rejects a seed from an unlisted topic and seed cycles (M2b task 17).
