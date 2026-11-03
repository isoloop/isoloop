# M2b: Durable log (outline)

**Goal:** topics with `durability: 'persistent'` are written to the Origin Private File System, so they survive a bus worker crash and a page reload ([ADR 0007](../adr/0007-bus-worker-supervision.md)).

**Done when:** in an E2E test, a persistent topic loses no acknowledged record (invariant I12) when (a) the bus worker is killed mid-stream and (b) the page is reloaded; and a second tab falls back to memory with `bus:durability-degraded`.

**Depends on:** M2 (the `LogStorage` interface, `reattach`/`reset`). Runs in parallel with M3, and **must land before the 0.1 release (M4)**.

Gets a full task list when M2 closes.

## Main work items

1. **Binary codec** (`packages/codec`): encodes structured-clone-compatible values (objects, arrays, strings, numbers, bigint, booleans, null, `Date`, `Map`, `Set`, typed arrays, `ArrayBuffer`) to bytes and back; rejects functions, DOM nodes and class instances with `not_encodable`. Benchmarked against `JSON` and structured clone. **Shared with M5.** Evaluate an existing MessagePack/CBOR library first, then decide whether to write our own.
2. **`OpfsStorage`** implementing `LogStorage`: a directory per topic; segment files (4 MiB, with a length-prefixed record frame and a CRC per record); an offsets file; group commit (5 ms / 256 records); a `publish` is acknowledged after `flush()`.
3. **Recovery:** on `open()`, scan segments, truncate a torn final record (CRC mismatch), rebuild the in-memory index, and restore committed offsets.
4. **Retention and compaction on disk:** segment-level deletion for `last-n`/`time`; rewrite-and-swap for `compacted`, in the background, without blocking appends.
5. **Eviction:** keep only recent segments in memory; replay older ones from disk on demand.
6. **Safe mode:** detect a crash loop during load, quarantine the newest segments (rename, never delete), emit `bus:recovered`.
7. **Single writer across tabs:** a Web Lock `isoloop-bus`; the losing tab runs memory-only and emits `bus:durability-degraded`.
8. **Quota:** report usage in bus metrics; `bus:quota` warning at 80 %; behaviour when full (reject persistent publishes with `quota_exceeded`, keep memory topics working).
9. **Fallback:** if sync access handles are unavailable, use IndexedDB-backed storage, or memory with a warning; decide based on the browser support data at the time.
10. **Flush on freeze:** on the Page Lifecycle `freeze` event and on `pagehide`, the kernel sends the bus a flush request and persistent topics are written immediately instead of waiting for group commit ([ADR 0001](../adr/0001-one-worker-per-isolate.md#what-the-browser-still-controls)). Docs state that memory topics don't survive a discarded tab.
11. **Tests:** storage fault injection (kill during flush, torn writes) in browser tests; the E2E done-criterion; a record published just before `freeze` is on disk after a simulated discard; a throughput bench comparing `memory` and `persistent` topics.

## Open risks

- Codec cost could eat the gains; measure early (item 1) on realistic dashboard records.
- OPFS behaviour differs by browser (sync handle availability, quota, private browsing); run the E2E suite on Chromium, Firefox and WebKit from the first task.
- Compaction rewriting large compacted topics must not stall the bus worker; chunk it across tasks.
