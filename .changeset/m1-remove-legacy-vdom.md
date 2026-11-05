---
'@isoloop/runtime': minor
'@isoloop/host': minor
'@isoloop/protocol': patch
---

Removes `legacy-vdom@1` and the M0 isolate API.

`@isoloop/runtime` no longer exports `createLegacyIsolate`, `h`, `LEGACY_VDOM` or the `Legacy*` isolate types. A module whose default export is a function now fails with a fatal error; isolates export `{ start(ctx) }` (`defineIsolate`).

`@isoloop/host` accepts only `isoloop-dom@1` for an isolate with a surface. The M1 bus over the isolate port (`x-pub` / `x-sub`) stays until M2 replaces it.
