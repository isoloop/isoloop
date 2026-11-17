---
'@isoloop/dom': minor
---

Internal: Isoloop's render bridge, `isoloop-dom@1`. A worker-side DOM subset sized to what Preact and React use, a host-side applier with a sanitising policy, and a conformance suite in `/testing`. `@isoloop/runtime` and `@isoloop/host` use it; app code doesn't ([ADR 0010](https://github.com/isoloop/isoloop/blob/main/docs/adr/0010-own-render-bridge.md), [ADR 0011](https://github.com/isoloop/isoloop/blob/main/docs/adr/0011-dom-package.md)).

This entry replaces the interim notes written during development with the package as it stands before its first versioned prerelease.
