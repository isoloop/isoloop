---
'isoloop': minor
---

New: the `isoloop` command line, with `isoloop contracts export <module> [--out file]` ([ADR 0003](https://github.com/isoloop/isoloop/blob/main/docs/adr/0003-schema-format-standard-schema.md), decision 21). It loads a contracts module (its default export made by `contracts()`; a `.ts` module works on Node ≥ 26) and prints one JSON document with JSON Schema (draft 2020-12) for every topic, made through Standard JSON Schema (Zod ≥ 4.2): `schema`, or `input` and `output` when they differ, the same for `reply`, and the topic's `tool` annotations ([ADR 0018](https://github.com/isoloop/isoloop/blob/main/docs/adr/0018-tools-for-agents.md)). An `unchecked()` schema exports as `{}`, is listed under `unchecked` and warns. A schema without Standard JSON Schema, or one its converter can't express, is reported per topic, nothing is written and the exit code is 1. `isoloop mcp` and `isoloop skill add` follow in later M4a tasks.
