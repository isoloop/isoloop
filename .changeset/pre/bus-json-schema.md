---
'@isoloop/bus': patch
---

Internal: the bus can make JSON Schema (draft 2020-12) from a topic's schemas through the vendored Standard JSON Schema interface (`~standard.jsonSchema`, Zod ≥ 4.2). A schema without the interface, an `unchecked()` schema, or a converter that throws comes back as a typed "not exportable" result. Nothing public changes yet. The kernel's agent tools and `isoloop contracts export` will use it (ADR 0018, ADR 0003 decision 21).
