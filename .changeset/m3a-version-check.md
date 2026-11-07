---
---

The kernel checks an isolate's `requires` stamp against `[FLOOR, VERSION]` (ADR 0012): newer than this host fails with `runtime-too-old`, older than the floor with `isolate-too-old`, both final; unstamped isolates aren't checked. `createDeprecations(dev)` warns once per deprecated member in `dev`.
