---
'@isoloop/bus': minor
---

Make JSON Schema from a topic's schemas at run time: `jsonSchemaOf(schema)` and `topicJsonSchemas(topic)` (both `@experimental`) return draft 2020-12 input and output schemas, and the `reply`'s, through the vendored Standard JSON Schema interface (`~standard.jsonSchema`, Zod ≥ 4.2). A schema without the interface, an `unchecked()` one, or one whose converter throws comes back as `{ ok: false, reason, message }` naming the topic and part, never as a throw. The kernel's agent tools and `isoloop contracts export` build on it (ADR 0018, ADR 0003 decision 21).
