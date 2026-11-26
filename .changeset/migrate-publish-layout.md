---
'isoloop': patch
---

`isoloop migrate` to 0.2 now keeps the comments of a `publish` record it takes apart: a comment on `key` goes into the new options, one on `value` stays beside the value, and any other goes above the call. It lays out the new arguments the way oxfmt and Prettier do, at the width and indent of the nearest formatter config, so a formatted file stays formatted: arguments already one per line stay that way, a call that no longer fits gets its arguments one per line or its options hugged, and a member chain that now fits goes back on one line.
