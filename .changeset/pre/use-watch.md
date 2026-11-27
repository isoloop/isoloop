---
'@isoloop/react': minor
'@isoloop/preact': minor
---

`useWatch` reads a topic's current value per key instead of its stream. It is experimental.

- `useWatch(topic)` returns a map from key to value; records with no key share the key `null`.
- `useWatch(topic, { key })` returns one key's value, or `undefined` while it has none.
- When several values arrive for a key between two renders, only the newest is shown, and the next view waits until the render showing this one has committed.
- Any number of components can watch one topic; one that mounts later shows the current value at once.
