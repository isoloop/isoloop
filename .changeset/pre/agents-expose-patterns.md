---
'@isoloop/host': patch
---

`AgentsConfig.expose`'s TSDoc describes grant patterns as they work: `*` matches one or more characters, dots included. It had described a one-segment `*` and a `>`, which the matcher doesn't have.
