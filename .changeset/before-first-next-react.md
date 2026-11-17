---
'@isoloop/react': minor
---

React isolates: `defineIsolate(Component)` and the hooks `useTopic`, `usePublish`, `useRequest`, `useHost`, `useRoute`, `useIsolate` and `usePortalRoot`. React 18 and 19 are supported. A render error is caught at the isolate's root and reported as its own, so in a pool only that member restarts.

This entry replaces the interim notes written during development with the package as it stands before its first versioned prerelease.
