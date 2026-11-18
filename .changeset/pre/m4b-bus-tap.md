---
'@isoloop/protocol': minor
'@isoloop/bus': minor
'@isoloop/host': patch
---

The bus side of the inspection feed ([ADR 0020](https://github.com/isoloop/isoloop/blob/main/docs/adr/0020-inspection-feed.md), decisions 2 and 3). `bus:metrics` now gives each topic its `head` (the next offset to be written) and `retained` (how many records it still holds). Everything else is the bus side of `kernel.inspect()`, and is `@experimental`:

- Protocol: a host-to-bus `tap` that copies records appended to matching topics onto a dedicated port, at most `maxPerSec` a second (default 50), and counts the rest as `skipped`. A tap is not a consumer: it has no cursor or credit and never shows in `bus:metrics`. A host-to-bus `read` returns a topic's last records (at most 100). Both send `RecordPreview`s: the value as JSON-like text cut to 2,048 characters, with its estimated size in bytes.
- Bus: `LogEngine` gains `retained(topic)`, covered by the engine conformance suite.
- Host (internal): the bus controller opens a tap again on each new bus worker after a crash, and keeps the bus restart count.
