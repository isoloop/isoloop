# A durable log in the Origin Private File System

*M2b write-up, 2026-11-07*

M2b's promise: **a persistent topic loses no acknowledged record when the bus worker is killed mid-stream, or when the page is reloaded.** That's invariant I12, and [`e2e/durable.spec.ts`](../../e2e/durable.spec.ts) checks it in Chromium and Firefox:
- **The kill:** the host streams 1,000 publishes and the bus worker dies after the 300th. Every publish is acknowledged, and the log reads 0…999 once each, in order.
- **The reload:** 500 acknowledged records come back after a reload.
- **A second tab:** it gets memory topics and a `bus:durability-degraded` event, because only one tab can own the files.

## On disk

`durability: 'persistent'` topics go to the origin's private file system, through sync access handles in the bus worker ([ADR 0007](../adr/0007-bus-worker-supervision.md)):
- **Segments:** one directory per topic, 4 MiB segment files of length-prefixed frames, each with a CRC-32.
- **Group commit:** appends are batched every 5 ms or 256 records. A persistent `publish` is acknowledged only once its batch is written. That ack is what I12 promises.
- **Committed offsets:** stored in two slot files written in turn, with a generation number. OPFS has no atomic rename, and two slots still give "the old offsets or the new ones, never half".
- **Recovery:** on load, a torn tail (a frame running past the end of the file, or a bad CRC) is cut off. Offsets a corrupt frame used are skipped, never handed out again (I5).
- **Safe mode:** if the bus crashes twice in a row while loading, the next one sets the newest segments aside, so one poisoned record can't take the app down for good.
- **Retention and compaction on disk:** `last-n` and `time` delete whole segments. `compacted` rewrites old segments in the background, so appends don't wait. A topic larger than 8 MiB keeps only its recent records in memory, and an older read pages them back in from disk.

## Our own codec

Records need a binary encoding on disk. The rule set beforehand was "our own unless a library is more than 2× faster", on the dashboard's trade and order-book records. The best libraries, msgpackr and cbor-x, came in at most 1.42× faster, and slower in most cases. Ours is also the smallest at 3.1 KB gzipped, against 12–13 KB. So [`@isoloop/codec`](../../packages/codec) covers exactly the structured-clone types a topic can hold ([ADR 0014](../adr/0014-own-codec.md), [investigation](../investigations/codec.md)). A value it can't encode, such as a function or a class instance a schema produced, is rejected with `not_encodable` before it reaches a persistent topic.

## The browser's edges

- **One tab owns the files.** The bus takes the `isoloop-bus` Web Lock. A second tab runs its persistent topics in memory and says so: `bus:durability-degraded { reason: 'another-tab' }`. The other reasons are `no-sync-access` and `open-failed`, the latter in Firefox's and Safari's private windows. We dropped the planned IndexedDB fallback: every major browser has had sync access handles in normal browsing since 2022 or 2023 ([investigation](../investigations/opfs-support.md)).
- **Quota:** `bus:quota` fires at 80 % of the origin's quota. When storage is full, persistent publishes reject with `quota_exceeded` and memory topics carry on.
- **Freezing:** on `freeze` and `pagehide`, the kernel asks the bus to write the pending batch at once, instead of at the next group commit. A record published just before a discard is on disk after the reload.

## Seeding

A topic can start from an older version of itself: `seed: { from: 'cart.v1', map }` copies v1 through `map` and v2's schema, exactly once, even across crashes. While the seed runs, v2's publishes and subscribers wait, and other topics don't. With `follow`, new v1 records keep flowing into v2. Persistent topics the contracts no longer list stay on disk and are reported as `bus:orphaned_topics`; `kernel.dropTopic` deletes them.

## Re-sends, and a bug the demo found

After a bus crash, publishes the old bus never answered are sent again. With a memory log that's harmless. With a durable one, the old bus may have written the record just before it died. So every publish now carries `(epoch, seq)`, its publisher's instance and counter. The bus remembers the last 1,000 per producer and topic, rebuilt from disk when it loads, and answers a re-send it already has with the original offset. The host's `kernel.publish` gets the same treatment. It used to reject with `bus_unavailable`; now it re-sends.

The demo found a second bug. [four-loops](../../examples/four-loops) now keeps `count.v1`, `note.v1` and `store.v1` on disk, and has a "Crash the bus" button. After a crash, the store isolate counted its one note twice. Its subscription said `from: 'earliest'`, and the new bus honoured that literally, replaying the whole log. ADR 0007 had always said a persistent subscription resumes from its committed offset. Now it does: a reattached subscription to a persistent topic starts after what it committed.

The demo also made a known rule visible: delivery is at least once. A commit reaches the disk on the next group commit, like a record. In Firefox, a crash right after a commit can therefore come before that write, and the records since the last commit on disk come again. The store's fold and D's log now skip offsets they've already applied. That's what any handler that isn't naturally idempotent has to do, and the guide should say so in M4.

## The numbers

[`bench/throughput`](../../bench/throughput) now runs twice: on a memory topic and on a persistent one. Same 10 subscribers, 200-byte records, measured locally (WSL2, headless Chromium):

| | memory | persistent (OPFS) |
| --- | --- | --- |
| records/s delivered | 32.4k | 31.9k |
| records/s published | 3.2k | 3.2k |

On this bench, the disk costs almost nothing in throughput. The bench is limited by delivery, the same one-record-per-task problem the M2 write-up described. Group commit hides the writes behind it. The CI numbers are in the `bench-results` artifact of each run.

## What M2b didn't do

- **No OPFS in Playwright's WebKit.** `getDirectory()` throws there even in a persistent context, though real Safari has it. The OPFS tests skip on WebKit, and that browser's tests run in memory.
- **`follow` progress isn't saved.** A crash between a source append and its forward loses that one forward.
- **Memory topics are still lost** in a bus crash, by design: they get a `reset`. Sharing the bus across tabs stays in [would-like](../would-like.md).

## Next

M3b builds the markets dashboard on the adapters from M3a and on this log: its alert rules can be persistent from the start. After that comes M4, the 0.1 release.
