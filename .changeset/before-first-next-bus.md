---
'@isoloop/bus': minor
---

The log bus, run in its own worker (`@isoloop/bus/worker`). Topics are declared with `topic()` and a Standard Schema, validated in the broker, and gathered in one contracts module. Each subscriber has its own offset and a start position (`latest`, `earliest` or `committed`); commits go out together per port ([ADR 0016](https://github.com/isoloop/isoloop/blob/main/docs/adr/0016-fewer-messages-per-record.md)). Topics have retention, request and response, and an optional durable history in OPFS. A new topic version can be seeded from an older one, and isolates reattach after a bus restart ([ADR 0003](https://github.com/isoloop/isoloop/blob/main/docs/adr/0003-schema-format-standard-schema.md), [ADR 0007](https://github.com/isoloop/isoloop/blob/main/docs/adr/0007-bus-worker-supervision.md)). `@isoloop/bus/testing` has helpers for tests.

This entry replaces the interim notes written during development with the package as it stands before its first versioned prerelease.
