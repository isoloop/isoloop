---
'@isoloop/bus': minor
---

The bus worker serves watches: the current value per key of a topic, instead of every record. Watches are experimental.

- A watch first gets a snapshot, the newest retained value of each key it asks for. After that it gets only the keys that changed, with their newest value, and the next view goes out once the last one is seen.
- A key leaves the view when retention removes its newest record. On a compacted topic, keys stay.
- A watch needs the subscribe grant for its topic.
- With `dev: true`, the bus warns once when a watch of every key holds more than 1,000 keys.
