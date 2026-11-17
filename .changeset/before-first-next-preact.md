---
'@isoloop/preact': minor
---

Preact isolates: `defineIsolate(Component)` and the hooks `useTopic`, `usePublish`, `useRequest`, `useHost`, `useRoute`, `useIsolate` and `usePortalRoot`. Preact 10 and 11 are supported. A render error is caught at the isolate's root and reported as its own, so in a pool only that member restarts.

This entry replaces the interim notes written during development with the package as it stands before its first versioned prerelease.
