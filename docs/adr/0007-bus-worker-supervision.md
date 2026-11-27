# ADR 0007: Bus worker supervision and a durable log

- **Status:** Accepted
- **Date:** 2026-11-03
- **Amended:** 2026-11-20, the bus worker's restart limit is a default (see [the amendment](#amended-the-restart-limit-is-a-default-2026-11-20)); 2026-11-24, short runs count (see [the amendment](#amended-short-runs-count-2026-11-24)); 2026-11-26, the healthy run is `healthyAfterMs` (see [the amendment](#amended-the-healthy-run-is-healthyafterms-2026-11-26)); 2026-11-26, the kill and ready timers use the host's lag clock (see [the amendment](#amended-the-heartbeat-clock-is-the-hosts-lag-2026-11-26))
- **Fills a gap in:** RFC 0001 (which covers isolate crashes only)
- **Replaces:** the RFC's "Persistence (later): compacted topics written to IndexedDB"

## Context

With the broker in its own worker (RFC decision, [ADR 0005](0005-bus-topology-message-channels.md)), the bus worker holds every topic log and committed offset. Held only in memory, all of it is lost when the bus worker crashes or hangs.

The bus worker runs only Isoloop code, never isolate code. So it fails from our own bugs (including a record that triggers one) or from running out of memory, not from a misbehaving isolate.

We considered two ways to survive that:

- **Replicas** (a leader bus worker plus followers, like Kafka replicas or pods). Rejected:
  - Dedicated workers usually share the page's browser process, so replicas sit in the **same failure domain**: when the process dies, they all die.
  - The realistic failures are **correlated**. A follower runs the same code on the same records with the same memory footprint, so a record that crashes the leader, or memory exhaustion, takes the follower down too.
  - They cost a second copy of every append and double the memory.
  - Replication makes sense later only for a different goal: a bus shared **across tabs**.
- **A durable log** in the browser's Origin Private File System (OPFS). Accepted. Dedicated workers get synchronous file access (`createSyncAccessHandle`), which suits append-only log segments.

Rules: `dur.no-replicas`

## Decision

### 1. Supervise the bus like an isolate

The bus worker sends `beat` on its control port. The supervisor tracks it with the same blocked and kill timeouts, and restarts it up to 3 times in 60 s by default (see [the amendment](#amended-the-restart-limit-is-a-default-2026-11-20)). Past the limit the kernel emits `bus:failed`, and isolates keep running with every publish rejected (`bus_unavailable`). The kernel emits `bus:ready { first }`, `bus:crash`, `bus:restart` and `bus:failed`. A contracts module that fails to load also ends in `bus:failed`, but with a `code`, and fails the isolates as well ([ADR 0003](0003-schema-format-standard-schema.md), decision 7).

### 2. Durability per topic

```ts
topic('cart.items.v1', { schema, retention: { kind: 'compacted' }, durability: 'persistent' });
topic('ticks.v1',      { retention: { kind: 'last-n', n: 500 } });   // durability defaults to 'memory'
```

- **`memory`** (default): the log lives in the bus worker's memory only.
- **`persistent`**: appends also go to OPFS segment files, batched (group commit every 5 ms or 256 records). A `publish` is acknowledged after its batch is flushed. Committed offsets of persistent topics are flushed the same way.

Rules: `dur.per-topic`, `dur.group-commit`

### 3. Storage layer under the engine

The `LogEngine` stays the broker's only interface. Durability is a `LogStorage` the engine writes through: `MemoryStorage` in M2, and `OpfsStorage` in milestone M2b. Records are encoded to bytes with one binary codec, shared with the M5 shared-memory engine. Old segments can be evicted from memory and read back from disk on replay, so a persistent topic can hold more than fits in memory.

Rules: `dur.log-storage`, `dur.evict-replay`

### 4. Reattach, not restart, after a bus crash

1. The supervisor starts a new bus worker, which loads persistent topics and their offsets from OPFS.
2. The kernel gives every running isolate a new bus port via `reattach`. **Isolates keep running.** This happens as soon as the new worker is booted, without waiting for it to report `ready`: the new bus buffers each port's publishes and subscriptions while it loads contracts and storage ([ADR 0003](0003-schema-format-standard-schema.md), decision 8), so isolates don't wait on the restore (clarified 2026-11-13, as built in `packages/host/src/bus/controller.ts`).
3. Each isolate's `BusClient` re-sends its subscriptions:
   - **persistent topics** resume after the committed offset, with no gap, whatever `from` the subscription asked for; one that never committed starts at its `from` (made explicit 2026-11-07, M2b: a reattached `from: 'earliest'` subscription first replayed the whole log);
   - **memory topics** answer with `reset { topic, reason: 'bus_restart' }`. Adapters clear their topic state and replay from `earliest` (for example, `useTopic` empties and refills). Plain `subscribe` callers get an `onReset` callback.
4. An isolate that can't handle a reset declares `bus: { onReset: 'restart' }` in its manifest, and the supervisor restarts it.
5. Publishes made during the restart are buffered by the `BusClient` (up to its inbox limit of 1,000 unanswered calls), then sent; past the limit they reject with `bus_unavailable`. Publishes the old bus never answered are sent again on the new port, after the subscriptions. On a memory topic the old log is gone, so nothing is duplicated. On a persistent topic the old bus may have flushed the record before it crashed, so the bus **deduplicates** (amended 2026-11-07, M2b):
   - every publish carries `(producer, epoch, seq)`: the isolate id, its instance (a new one after an isolate restart), and a counter per instance;
   - each record frame on disk stores the triple, and the bus keeps the producer's last 1,000 `seq`s per topic, for its current epoch, rebuilt from the records it reads when it loads (1,000 is the `BusClient`'s inbox limit, so no re-send is older);
   - a re-send whose `seq` the bus already has is answered with the record's original offset and not appended again. Requests carry the triple too; a re-sent request is answered by the reply to the original record.
   Rejecting instead wouldn't prevent the duplicate: an app that retries after `bus_unavailable` writes the record again. Memory topics skip the check.
6. On the host, `kernel.publish` calls the old bus never answered are sent again on the new bus, the same as an isolate's, with the host as the producer. Calls made while no bus is running wait for the new one, up to the same limit of 1,000. (Until M2b the host rejected them with `bus_unavailable`, because it couldn't tell whether they were appended; deduplication makes the re-send safe.)

Since M2b, persistent topics resume as step 3 says. Memory topics, and persistent ones running in memory because of a fallback in decision 6, still get the reset: better than restarting every isolate, and the same code path.

Rules: `dur.reattach`, `dur.resume-committed`, `dur.memory-reset`, `dur.on-reset-restart`, `dur.publish-buffer`, `dur.dedupe`, `dur.host-resend`

### 5. Safe mode against crash loops

If the bus crashes again during or right after loading from OPFS, a persisted record is the likely cause. On the second such crash, the new bus worker sets the newest segment of each persistent topic aside (renamed, not deleted) and starts from the previous one. The kernel emits `bus:recovered { quarantined }` so the host can report it.

Rules: `dur.safe-mode`

### 6. One tab owns the files

Sync access handles are exclusive, so the first tab takes a Web Lock (`isoloop-bus`) and uses OPFS. Other tabs on the same origin fall back to `memory` for all topics and emit `bus:durability-degraded`. Sharing a bus across tabs is out of scope for v1.

**Without OPFS (amended 2026-11-07, M2b task 15).** A browser without sync access handles gets the same fallback, not IndexedDB. Its persistent topics behave as memory topics, and the bus reports `ready.storage: 'memory'`. `bus:durability-degraded` carries a `reason`:

- `another-tab`: the lock is held elsewhere;
- `no-sync-access`: `createSyncAccessHandle` is missing;
- `open-failed`: `getDirectory()` or opening the files throws, as in Firefox's and Safari's private windows.

Every major browser has had sync access handles in normal browsing since 2022 or 2023, so a second storage engine would serve only private windows and old browsers ([investigation](../investigations/opfs-support.md)). IndexedDB storage moves to [would-like](../would-like.md). It comes back if a major browser turns out to lack sync access in normal browsing.

Rules: `dur.one-tab`, `dur.no-sync-access`, `dur.tab-own-bus`

### Amended: the restart limit is a default (2026-11-20)

"Up to 3 times in 60 s" is the default, not a fixed limit. The bus worker is supervised with the kernel's own `supervisor` config (`maxRestarts`, `withinMs`, `backoff`; `createKernel` hands it to the bus controller in `packages/host/src/kernel.ts`), so an app that sets those sets them for the bus worker too. Found while writing the M4c supervision guide (isoloop#320), which describes the code.

### Amended: short runs count (2026-11-24)

The bus worker's restart limit follows [ADR 0001](0001-one-worker-per-isolate.md)'s *Restart limit: short runs*: a crash after a healthy run shorter than `withinMs` counts, measured from the bus's `ready` to its last beat, and the sliding window stays as well. The bus has no fallback: when the limit is met it fails as it does today, and isolates get `bus_unavailable` ([#390](https://github.com/isoloop/isoloop/issues/390)).

### Amended: the healthy run is `healthyAfterMs` (2026-11-26)

The healthy run that clears the bus worker's count of short runs is `supervisor.healthyAfterMs`, not `withinMs`, which is the sliding window only ([ADR 0001](0001-one-worker-per-isolate.md), *Restart limit: `healthyAfterMs`*; [#409](https://github.com/isoloop/isoloop/issues/409)). The bus worker reads it from the kernel's `supervisor` config like the other options, with no separate setting; the default, 60 000 ms, keeps today's behaviour.

### Amended: the heartbeat clock is the host's lag (2026-11-26)

The bus worker's heartbeat kill and ready timeout run on the host's lag clock with a wall-clock cap of 3 × their limit, as isolates' do ([ADR 0001](0001-one-worker-per-isolate.md), *Heartbeat clock: the host's lag*; [#389](https://github.com/isoloop/isoloop/issues/389)); its restart limit stays on wall-clock time.

## Consequences

- A bus crash is a brief pause, not a full reload, and with M2b persistent topics also survive page reloads.
- `reattach` and `reset` are protocol messages from M2 on, even before OPFS exists, so M2b only adds storage.
- Topic values must be encodable by the codec: structured-clone data without functions, DOM nodes or class instances. The broker rejects others at `publish` (`not_encodable`) for persistent topics.
- OPFS quota and eviction apply. The bus reports usage in its metrics and emits `bus:quota` near the limit.
- More code than memory-only with a full restart: storage, codec, segment compaction and safe mode. Hence its own milestone.

Rules: `dur.codec-types`, `dur.quota`

## Alternatives considered

- **Replicated bus workers:** see Context; same failure domain, correlated failures, double the cost.
- **Mirror the log on the main thread:** puts every record back on the main thread, against ADR 0005.
- **IndexedDB** (the RFC's plan): transactional and widely available, but slower for append-heavy logs and asynchronous only. OPFS with sync handles fits a log better. It was the fallback where sync handles are missing until the 2026-11-07 amendment to decision 6, which uses memory instead.
- **Periodic snapshots instead of a write-ahead log:** cheaper writes, but records since the last snapshot are lost. That could come later as an extra `durability: 'snapshot'` mode.

Rules: `dur.no-indexeddb`, `dur.no-main-thread-mirror`, `dur.no-snapshots`
