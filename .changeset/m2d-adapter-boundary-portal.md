---
'@isoloop/runtime': minor
'@isoloop/react': minor
'@isoloop/preact': minor
---

Per-isolate error boundary and portal root (ADR 0015). The isolate context gains `reportError(error, { fatal })`, which reports an error as the isolate's own, and `portalRoot`, a container inside the surface for modals, tooltips, toasts and menus. The React and Preact adapters wrap each isolate's root in a boundary that reports render errors through `reportError`, so in a pool a render error crashes only that member, and add `usePortalRoot()`. Under a runtime without `reportError`, the boundary rethrows as before. `createTestContext()` records reported errors in `errors`.
