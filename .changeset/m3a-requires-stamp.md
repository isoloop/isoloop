---
---

`defineIsolate` (runtime, Preact and React) stamps the definition with `requires`, the Isoloop `major.minor` it was built against, and the bootstrap reports it in `ready` (ADR 0012). `@isoloop/protocol` adds `majorMinor` and `compareVersions`.
