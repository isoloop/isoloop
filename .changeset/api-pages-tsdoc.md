---
'@isoloop/react': patch
'@isoloop/preact': patch
'@isoloop/balancer': patch
---

Docs: `useHost` now lists `requestCanvas` among the host calls, and the `maxWorkers` option says its default is `max(2, navigator.hardwareConcurrency - 2)` and that a value you set is raised to 1 if lower.
