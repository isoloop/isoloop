# M2b: Durable log

**Status:** done, 2026-11-07 (tasks 1–22, from [#72](https://github.com/isoloop/isoloop/pull/72)). Where the build differs from a task, the task has an *As built* note. Write-up: [A durable log in the Origin Private File System](../posts/m2b-durable-log.md).

**Goal:** topics with `durability: 'persistent'` are written to the Origin Private File System, so they survive a bus worker crash and a page reload ([ADR 0007](../adr/0007-bus-worker-supervision.md)).

**Done when:** in an E2E test, a persistent topic loses no acknowledged record (invariant I12) when (a) the bus worker is killed mid-stream and (b) the page is reloaded; and a second tab falls back to memory with `bus:durability-degraded`.

**Depends on:** M2 (the `LogStorage` interface, `reattach`/`reset`). Runs in parallel with M3, and **must land before the 0.1 release (M4)**.

## Scope

**In:** the binary codec (`packages/codec`), `OpfsStorage` under the existing `LogStorage` interface ([design §6.2](../design/system-design.md#62-logengine-interface)), recovery, retention and compaction on disk, eviction, safe mode, the single-writer lock, quota, the fallback without sync access handles, flush on freeze, seeding and orphaned topics ([ADR 0003](../adr/0003-schema-format-standard-schema.md)), and the duplicate-publish decision from ADR 0007.

**Out:** the WASM engine (M5; it reuses the codec), sharing the bus across tabs ([would-like](../would-like.md)).

**Order:** task 1 (a decision) and task 2 first; 3–4 after 2. Storage (5–8) follows the codec. Then three tracks in parallel: disk management (9–12), tabs and limits (13–16) and seeding (17–19). Tasks 20–22 close the milestone. Run every browser test on Chromium, Firefox and WebKit from task 5 on.

## Tasks

### 1. Record the decision: deduplicate re-sent publishes
- From the open risk below and [ADR 0007](../adr/0007-bus-worker-supervision.md) steps 5 and 6. After a bus crash, an isolate re-sends publishes the old bus never answered; on a persistent topic the old bus may already have flushed them. **Decided (2026-11-06): deduplicate.** Rejecting wouldn't prevent the duplicate, because an app that retries after `bus_unavailable` writes the record again. Each record frame carries `(producer, epoch, seq)`: the isolate id, its instance, and a per-instance counter. The bus keeps the last `seq` per producer and topic, rebuilt from each segment's tail on load, and answers a re-send it already has with the original offset. The host's `kernel.publish` gets the same treatment instead of rejecting, so both sides behave alike. Memory topics are unchanged. Written up as an ADR 0007 amendment; it shapes the frame in task 5.
- **Tests:** none; task 20 implements it.

### 2. Codec: evaluate
- Benchmark a MessagePack and a CBOR library against `JSON` and structured clone on realistic records (the dashboard's trades and book updates, the four-loops topics): encode and decode speed, size, bundle size. **Decided (2026-11-06):** our own codec, covering exactly the structured-clone types topics allow, unless a library is more than 2× faster on these records; then it comes in wrapped behind our interface, with conformance tests. The ADR records the numbers and the outcome.
- **Files:** `bench/codec/`, `docs/investigations/codec.md`.
- **Tests:** the bench runs and reports.
- *As built:* Written up as [ADR 0014](../adr/0014-own-codec.md) (0013 is reserved for `@isoloop/local`). No library was more than 2× faster: at most 1.42×. Task 3 merged before this one, so the evaluation could bench our own codec.

### 3. Codec: core types
- **Files:** `packages/codec/src/{encode,decode,index}.ts`. Objects, arrays, strings, numbers, booleans, `null`, `undefined`.
- **Tests (unit):** property tests (fast-check) that `decode(encode(v))` equals `v` for generated values; a fixed byte layout for a sample of values, so the format can't drift silently.
- *As built:* `encode` returns a view into a shared 16 KiB chunk, not a fresh copy, so a caller that keeps the bytes copies them; most of the speed comes from that.

### 4. Codec: the rest, and `not_encodable`
- `bigint`, `Date`, `Map`, `Set`, typed arrays, `ArrayBuffer`. Functions, DOM nodes, class instances and symbols throw, and the broker rejects such publishes to persistent topics with `not_encodable` ([ADR 0007](../adr/0007-bus-worker-supervision.md) consequences).
- **Files:** `packages/codec/src/`, `packages/bus/src/broker.ts`.
- **Tests (unit):** round trips for each type; a class instance or function rejects with `not_encodable` on a persistent topic and is accepted on a memory topic.

### 5. `OpfsStorage`: segments and group commit
- One directory per topic; 4 MiB segment files of length-prefixed frames with a CRC32 each; `appendBatch` buffers, group commit every 5 ms or 256 records; `flush()` resolves when the batch is written. The broker acknowledges a persistent `publish` only after its flush.
- **Files:** `packages/bus/src/storage/opfs.ts`, `src/storage/frame.ts`, `src/broker.ts` (ack after flush).
- **Tests (browser, bus worker in a real `Worker`):** 10,000 records written and read back; a segment rolls over at 4 MiB; a publish resolves only after its flush.
- *As built:* Playwright's WebKit has no OPFS: `navigator.storage.getDirectory()` throws `UnknownError`, even in a persistent context (real Safari has it). From here on the bus browser tests run in all three engines, but the OPFS ones skip on WebKit.

### 6. `OpfsStorage`: committed offsets
- `saveOffsets` writes an offsets file per topic with the same group commit; written to a second file and swapped, so a crash leaves the old one or the new one, never half.
- **Files:** `packages/bus/src/storage/opfs.ts`.
- **Tests (browser):** offsets survive a reopen; a write killed halfway leaves the previous offsets.
- *As built:* Committed offsets go to two slot files written in turn, with a generation number, not to a second file renamed over the first: OPFS has no atomic rename, and the slots give the same "old or new, never half".

### 7. Recovery
- `open()` scans segments, truncates a torn final record (CRC mismatch), rebuilds the in-memory index and restores committed offsets. The bus reports them in `ready.restored`.
- **Files:** `packages/bus/src/storage/opfs.ts`, `src/storage/recover.ts`, `src/server.ts` (`ready`).
- **Tests (browser):** fault injection: a truncated last frame, a flipped byte, an empty segment; each opens with every complete record kept.

### 8. Wire it into the bus
- The bus worker opens `OpfsStorage` for persistent topics (`ready.storage: 'opfs'`), and drops the one-time "behaves as memory" warning. After a bus restart, persistent subscriptions resume from the committed offset with no `reset` ([ADR 0007](../adr/0007-bus-worker-supervision.md) step 3).
- **Files:** `packages/bus/src/server.ts`, `src/engine/ts-engine.ts`, `src/engine/memory-storage.ts`.
- **Tests (browser):** a forced bus crash: a persistent topic's subscriber gets no `reset` and no `gap`, and sees every acknowledged record; a memory topic's subscriber still gets one `reset`.

### 9. Retention on disk
- Segment-level deletion for `last-n` and `time`, after the last record a segment holds falls out of retention.
- **Files:** `packages/bus/src/storage/opfs.ts`.
- **Tests (browser):** a `last-n: 1000` topic written with 100,000 records keeps only the segments it needs.
- *As built:* Segment retention is a new `LogStorage.dropBelow`; `rewrite` stays for compaction (task 10).

### 10. Compaction on disk
- Rewrite-and-swap for `compacted` topics in the background, chunked across tasks so appends never wait more than one chunk.
- **Files:** `packages/bus/src/storage/compact.ts`.
- **Tests (browser):** after compaction only the latest record per key is left, in order (I5); appends during compaction land after it; a crash mid-rewrite leaves the old segments.

### 11. Eviction and replay from disk
- Only recent segments stay in memory; `readSegment` replays older ones when a subscriber starts from an evicted offset.
- **Files:** `packages/bus/src/engine/ts-engine.ts`, `src/storage/opfs.ts`.
- **Tests (browser):** a subscriber from `earliest` on a topic larger than the memory window gets every record in order.

### 12. Safe mode
- A crash during or right after load counts; on the second, the new bus renames each persistent topic's newest segment aside (never deletes it) and starts from the previous one, then emits `bus:recovered { quarantined }`.
- **Files:** `packages/bus/src/storage/safe-mode.ts`, `packages/host/src/bus/controller.ts`, `packages/host/src/kernel.ts` (the event).
- **Tests (browser):** a contracts module whose schema throws on one stored record crashes the bus twice, then the bus starts with that segment quarantined.

### 13. One tab owns the files
- A Web Lock `isoloop-bus`; a tab that doesn't get it runs every topic in memory and emits `bus:durability-degraded`.
- **Files:** `packages/bus/src/storage/lock.ts`, `src/server.ts`, `packages/host/src/kernel.ts`.
- **Tests (E2E):** a second tab gets `bus:durability-degraded` and works; closing the first lets a reload of the second take the lock.

### 14. Quota
- Usage in bus metrics; `bus:quota` at 80 %; when full, persistent publishes reject with `quota_exceeded` and memory topics keep working.
- **Files:** `packages/bus/src/storage/opfs.ts`, `src/server.ts`, `packages/protocol/src/errors.ts`, `packages/host/src/kernel.ts`.
- **Tests (browser):** with a storage stub reporting 81 % and then 100 %, the event fires once and publishes reject.

### 15. Fallback without sync access handles
- **Decided (2026-11-06): memory with a warning.** Without sync access handles, persistent topics behave like memory topics, the bus reports `ready.storage: 'memory'`, and the kernel emits `bus:durability-degraded` with reason `no-sync-access`, as for a second tab (ADR 0007, decision 6). IndexedDB storage moves to [would-like](../would-like.md). The investigation checks the support data first; if a major browser lacks sync access in normal browsing, the decision is revisited. An ADR 0007 amendment replaces its IndexedDB fallback.
- **Files:** `packages/bus/src/storage/` (the fallback), `docs/investigations/opfs-support.md`.
- **Tests (browser):** with sync handles hidden, the bus starts, reports the fallback in `ready.storage`, and the done-criterion E2E passes or degrades as decided.

### 16. Flush on freeze
- On the Page Lifecycle `freeze` event and on `pagehide`, the kernel asks the bus to flush, and persistent topics are written at once ([ADR 0001](../adr/0001-one-worker-per-isolate.md#what-the-browser-still-controls)). The hosting guide states that memory topics don't survive a discarded tab.
- **Files:** `packages/host/src/kernel.ts`, `packages/protocol/src/control.ts` (`flush`), `packages/bus/src/server.ts`, `docs/guide/hosting.md`.
- **Tests (E2E):** a record published just before a simulated freeze and discard is on disk after reload.
- *As built:* The E2E can't tell the flush from the normal 5 ms group commit; the host test with a 60-second group commit is what proves it.

### 17. Seeding: state and buffering
- `seed: { from, map, follow }` ([ADR 0003](../adr/0003-schema-format-standard-schema.md) decision 18). A seeding topic buffers its publishes and holds its subscribers; other topics don't wait. Seeding runs only in the tab holding the lock.
- **Files:** `packages/bus/src/seed.ts`, `src/topic.ts`, `src/broker.ts`.
- **Tests (browser):** v2 publishes during seeding land after the seeded history; a v2 subscriber gets nothing until seeding ends, then everything in order.
- *As built:* A subscribe to a seeding topic is answered when the seed ends, so `from: 'latest'` also starts after the seeded history. This task required `seed.from` to be listed in the contracts; task 19 dropped that rule.

### 18. Seeding: exactly once, rejects and progress
- Seed progress stored atomically with the appends, so a seed killed halfway resumes without duplicates; original `ts` and `producer` kept; a record `map` throws on or v2 rejects is skipped and reported (`bus:seed_rejected`, rate-limited) with its offset kept; `bus:seeded` at the end.
- **Files:** `packages/bus/src/seed.ts`, `src/storage/opfs.ts`.
- **Tests (browser):** a seed killed halfway resumes without duplicates; a rejected v1 record is reported and v2 still opens; a `map` returning a promise counts as `seed_async`.
- *As built:* `copied` in `bus:seeded` is the topic's head when the seed ends, so it also counts records an earlier, interrupted run copied.

### 19. `follow`, orphaned topics, `dropTopic`
- `follow` forwards new v1 records to v2 after the seed. At boot, persistent topics the contracts no longer list are kept, not opened, and reported as `bus:orphaned_topics`. `kernel.dropTopic(name, { force })` deletes one, rejecting with `seed_pending` if a pending seed needs it.
- **Files:** `packages/bus/src/seed.ts`, `src/server.ts`, `packages/host/src/kernel.ts`.
- **Tests (browser):** a v1 publish after seeding reaches v2 with `follow`; an unlisted topic is reported with its size; `dropTopic` on a topic a pending seed needs rejects with `seed_pending`.
- *As built:* `seed.from` may be a topic the contracts no longer list (ADR 0003's `follow` and `seed_pending` need it): the bus keeps it for the seed, isolates can't reach it. A bus with no persistent topic in its contracts doesn't open the files, so it reports no orphans. `follow` progress isn't saved: a crash between a source append and its forward loses that forward. `seed_pending` is covered by a unit test only.

### 20. Re-sent publishes, as decided in task 1
- **Files:** `packages/runtime/src/bus-client.ts`, and `packages/bus/src/broker.ts` if deduplication was chosen.
- **Tests (browser):** a bus killed between flushing a publish and answering it: the record is in the log exactly once afterwards.
- *As built:* `LogEngine.append(topic, rec, id?)` stores `(epoch, seq)` in the frame and `LogEngine.appended(topic, producer, id)` finds the original offset; the TS engine keeps the producer's last 1,000 per topic, current epoch only. Requests carry ids too, and a re-sent request is answered by the reply to the original record. The host's unanswered publishes are now re-sent instead of rejecting with `bus_unavailable`. The browser test can't pin the kill between flush and answer (the window is too short to hit); the broker test does it deterministically, on a disk that keeps what was flushed.

### 21. The done-criterion E2E
- **File:** `e2e/durable.spec.ts`. A persistent topic loses no acknowledged record (I12) when (a) the bus worker is killed mid-stream and (b) the page is reloaded; a second tab falls back to memory with `bus:durability-degraded`. Updates the I12 row in [design §8](../design/system-design.md#8-invariants).
- **Tests (E2E, Chromium, Firefox, WebKit):** the spec.
- *As built:* Chromium and Firefox; the OPFS tests skip on Playwright's WebKit (task 5).

### 22. Throughput bench, demo and write-up
- `bench/throughput` gains a `persistent` run next to `memory`, report only.
- Demo: four-loops' store topic made persistent; reload the page and the state is still there; kill the bus and nothing is lost. Post: "A durable log in the Origin Private File System".
- *As built:* The demo keeps `count.v1` and `note.v1` on disk too, not only `store.v1`: S folds store.v1 from them, so persisting the fold alone would let S overwrite it with a fold of an empty log after a reload. The demo found that a reattached `from: 'earliest'` subscription replayed a persistent topic from the start instead of resuming from its committed offset (ADR 0007 step 3); fixed in [#118](https://github.com/isoloop/isoloop/pull/118). It also showed at-least-once delivery in practice: in Firefox, a crash can come before a commit's write, so the store's fold and D's log skip offsets they already applied. The ADR 0007 note that every topic is memory until M2b ships is corrected in its own PR, for review.

## Risks

- Codec cost could eat the gains; measure early (item 1) on realistic dashboard records.
- OPFS behaviour differs by browser (sync handle availability, quota, private browsing); run the E2E suite on Chromium, Firefox and WebKit from the first task.
- Compaction rewriting large compacted topics must not stall the bus worker; chunk it across tasks.
- **Re-sent publishes can duplicate.** After a bus crash, an isolate's `BusClient` sends again every publish the old bus never answered ([ADR 0007](../adr/0007-bus-worker-supervision.md), step 5). With memory topics the old log is gone, so nothing duplicates. With persistent topics the old bus may have flushed the record before it crashed, and the re-send appends it twice. Decided in task 1: the bus deduplicates on `(producer, epoch, seq)`, so the re-send is answered with the original offset.
