---
'isoloop': patch
---

`isoloop migrate` to 0.2 now rewrites a `publish` whose second argument is a conditional between two records with the same value (`k === undefined ? { value } : { key: k, value }` becomes `value, k === undefined ? {} : { key: k }`) and marks one it can't rewrite. It treats a receiver ending in `#kernel` or `#bus` (`this.#kernel`) as Isoloop's, and marks a call on a receiver it can't name, such as `this.#k`, instead of leaving it as it is. A value over several lines keeps its indentation when the `value:` wrapper goes.
