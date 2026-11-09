---
'@isoloop/host': minor
---

`kernel.pools()` reports `sharesDocument` for each pool, and a `warning` ("Members of this pool can read each other's DOM and input.") when a member has a surface (ADR 0015), for devtools to show.
