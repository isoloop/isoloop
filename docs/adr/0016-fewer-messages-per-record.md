# ADR 0016: Fewer bus messages per record

- **Status:** Proposed
- **Date:** 2026-11-10
- **Amends:** [ADR 0005](0005-bus-topology-message-channels.md) (what travels on an isolate's bus port) and [ADR 0003](0003-schema-format-standard-schema.md), decision 10 (how a failed publish is reported)
- **Touches:** [ADR 0007](0007-bus-worker-supervision.md), step 5 (publishes re-sent after a bus restart) and [ADR 0012](0012-isolates-built-apart.md), decision 2 (`ctx.bus` is part of the seam)
- **Evidence:** [plant memory investigation](../investigations/plant-memory.md) (PR #162); matched head-to-head in `isoloop/examples`, `apps/dashboards/plant/comparison/matched/`

## Context

On the matched head-to-head (4 physical cores fixed at 2.0 GHz), Isoloop's plant dashboard uses 8–19 percentage points more CPU across threads than the native builds. Read as is, it also shows 70–220 MB more memory, most of it uncollected garbage. The memory investigation traced both to allocation: Isoloop allocates about 19.8 MB/s against native + workers' 9.9 MB/s. Every bus message leaves a structured clone, a `MessageEvent` and a serialized buffer behind.

For each record with *k* subscribing isolates, the bus port carries:

1. one `publish`, isolate → bus;
2. one `result` back, because the bus client always sets `id` (`packages/runtime/src/bus-client.ts`, `call`), although the broker answers only when `id` is set (`packages/bus/src/broker.ts`, `#receive`);
3. *k* `deliver`s. A `deliver` already carries `records: BusRecord[]`, and the broker pumps each subscription once per microtask (up to 64 records). But each publish arrives as its own task, so in steady state each `deliver` holds one record;
4. *k* `commit`s, one per record per subscription (`drain`, with `autoCommit`). Host subscriptions commit once per `deliver` (`packages/host/src/bus/controller.ts`).

Counted from the plant's code (estimates, `matched`, 1 kHz): about **2,320 messages/s**. That's 345 publishes, 345 results, 815 delivers and 815 commits. A quarter of it is the dashboard's own `plant.timings` traffic, which is moving off the bus in the app. That change is outside this ADR, and the estimates below start from that corrected baseline.

What the per-record messages do today, and must keep doing:

- **Commits** set where a restarted or woken isolate resumes (`from: 'committed'`). They also return **credit**: the broker pauses a subscription after 1,000 records delivered and not committed (design §6.3), and redelivers a group's uncommitted records to another member.
- **Results** give the publisher three things:
  - the `invalid`, `too_large`, `forbidden` and similar error, as a rejection of the `publish` promise (ADR 0003, decision 10);
  - for persistent topics, confirmation that the record is on disk (ADR 0007);
  - for the bus client, a count of unanswered calls. It holds every unanswered publish so it can **re-send it after a bus restart** (ADR 0007, step 5), and it rejects new calls with `bus_unavailable` past 1,000 unanswered, which is the publisher's only **back-pressure**.

[M5b](../plans/m5b-delivery-batching.md) plans a spike on batching for throughput, and its candidates 2 (publish batching) and 3 (batched results) overlap decisions 2 and 3 here. This ADR takes them up now, measured on the plant's CPU and memory rather than on peak records/s. M5b's broker-side coalescing across tasks (its candidates 1 and 4) stays with M5b.

The rule this ADR follows, agreed with the user on 2026-11-10: a change goes in if it keeps every feature and measures as a saving beyond the noise on the benchmark server. A change that weakens a feature is listed with its exact cost.

## Decision

### 1. Combined commits (amends ADR 0005)

1. **A new `commits` message** on the bus port, isolate → bus: `commits { offsets: { topic: string; offset: number }[] }`. Each entry is the highest settled offset of one subscription, the same value a `commit` carries today.
2. **The bus client sends at most one `commits` per port every ~100 ms.** It holds the latest settled offset per subscription and sends them together. It sends early:
   - when any subscription's uncommitted count reaches half its credit, so a busy subscription never pauses because of the interval;
   - on `shutdown`, for every reason (`stop`, `restart`, `suspend`), before it acknowledges, so a graceful stop or a suspend loses nothing;
   - on the bus client's own close path;
   - on a new port after a bus restart, before its subscriptions resume (ADR 0007, step 4).
3. **What counts as settled is unchanged.** A record is settled when its handler returns. A handler that throws marks the subscription stuck, and the commit stops at the record before it, as `drain` does today.
4. **Host subscriptions do the same:** one `commits` per host port every ~100 ms, or earlier at half the credit.
5. **The single `commit` message is removed, not kept beside `commits`.** Both ends of the bus port come from one build: the bootstrap, which creates the bus client, ships with the host, and ADR 0012 lists the host ↔ worker protocol as free to change in any release. Keeping both would mean two code paths and two sets of tests for one job.
6. **The cost:**
   - A crashed isolate, or a worker killed without a graceful shutdown, can have up to ~100 ms of handled records delivered again on restart. Delivery is at-least-once already; the window grows from one record to ~100 ms.
   - A group member that crashes leaves up to ~100 ms more for the group's redelivery.
   - The commit lag in `BusMetrics.subscriptions` is coarser by up to ~100 ms.

### 2. Memory-topic publishes answer only on failure (amends ADR 0003, decision 10)

1. **On a memory topic, `ctx.bus.publish` resolves once the record is sent.** The bus client sends the `publish` without `id`, so the broker sends no `result` for it on success.
2. **A rejection still reaches the publisher and the host.**
   - The broker answers a failed id-less publish with a new message, bus → isolate: `rejected { topic, epoch, seq, error }`. `epoch` and `seq` are the publish id the client already sends (`PublishId`), so the rejection names the exact publish without the client keeping a promise for it.
   - The bus client passes it to `onError` as a `BusError` with the topic and `seq`. The runtime already forwards `onError` to the host as a non-fatal `error`, so the kernel's isolate reports show it.
   - `BusMetrics.rejected` keeps counting rejections by code, as today.
3. **`{ ack: true }` keeps today's behaviour:** `ctx.bus.publish(topic, rec, { ack: true })` waits for the `result` and rejects with the error.
4. **Persistent topics always wait for the result,** with or without `ack`, so their promise still means the record is on disk. Topic handles (`TopicRef`) carry only a name and schema types, so the bus client can't tell a persistent topic from a memory one. The kernel adds the names of the persistent topics to the isolate's `init`; it has them from the contracts `list`. The bus client then sends an `id` for those topics' publishes.
5. **Requests and replies are unchanged.** They already answer only on failure, or with the reply.
6. **Cumulative acknowledgements keep re-send and back-pressure** (proposed here to keep ADR 0007, step 5 and the 1,000 limit):
   - About every 100 ms, the broker sends each publishing port `acked { epoch, seq }`, the highest `seq` it has processed from that port, accepted or rejected. It sends nothing when there's nothing new.
   - The bus client keeps id-less publishes until they're acked. Up to that point it re-sends them after a bus restart, as it does with unanswered calls today, and they still count towards the 1,000 limit.
   - The cost is about 10 messages/s per publishing port instead of one per publish.
7. **The cost:**
   - Awaiting a memory-topic `publish` no longer means the bus accepted the record, only that it was sent. Code that relies on the rejection has to pass `{ ack: true }`.
   - A rejection arrives through `onError` instead of the promise, so it no longer reaches the `catch` next to the call.
   - With point 6, nothing else is lost. Without point 6, publishes in flight during a bus crash would be lost and publishers would have no back-pressure.

### 3. Batching per port per task (amends ADR 0005)

1. **A new `batch { msgs: Envelope[] }` message**, in both directions on the bus port, carries several envelopes sent in the same task. The sender queues envelopes and flushes them at the end of the current task, from a microtask: one envelope is sent as itself, two or more as one `batch`.
2. **Each inner envelope stays whole.** It keeps its own `t`, `id`, `isolate` (pool member) and payload. The receiver handles them in order, as if they had arrived one by one. So:
   - order per port is unchanged;
   - size limits, schema checks, ACL and credit apply per publish and per record, as today;
   - devtools and reports see every message, with its own details.
3. **`commits` (decision 1) and `acked` (decision 2) ride in the same batch** as the publishes and delivers sent in that task. An engine that handles a chunk and publishes its result in one task sends its publish and its commit in one message.
4. **No added latency beyond the current task.** Nothing waits for a timer or a frame; only commits and acks have intervals, set in decisions 1 and 2.
5. **The cost:** one larger clone instead of several smaller ones, and an end-of-task queue in the bus client, the broker and the host controller. Credit still bounds how much a single `batch` can hold.

## Consequences

- **Protocol version.** `PROTOCOL` stays `{ v: 1, min: 1 }`.
  - The changes are new message types (`commits`, `rejected`, `acked`, `batch`) and the removal of `commit`, on a port whose two ends come from one build (ADR 0012, decision 2).
  - Isolates built apart don't speak the bus protocol; they use `ctx.bus`.
  - The M5b plan assumed a new message shape would need a version bump. It doesn't here, for the same reason: no port carries two builds' versions of the protocol.
  - The open question below is whether decision 2 changes the `ctx.bus.publish` seam.
- **Expected messages per second for the plant**, `matched` at 1 kHz. These are **estimates** from reading the code, not measurements; the server runs decide.
  - **Baseline:** about 1,760, after the app moves `plant.timings` off the bus and drops the health engine's subscription to its own topic.
  - **Decision 1:** commits from about 610 to about 450 at a 100 ms interval. Ports that receive fewer than 10 records/s already commit less often than the interval, so only faster ones save. At 250 ms it's about 260. See open question 2.
  - **Decision 2:** about 260 results fewer, and about 10 `acked`/s per publishing port more (roughly 40 feeds and engines).
  - **Decision 3:** about 120–160 fewer: the feed's vib and scalars in one message, and engines' commits riding with their publishes.
  - **Together:** about 1,150–1,250, roughly a third below the baseline.
- **Implementation order,** each landing separately as a `next` prerelease and measured on the benchmark server before the next:
  1. combined commits;
  2. publishes answering only on failure, with `acked`;
  3. batching.

  A step that doesn't measure as a saving beyond the round-to-round spread is reverted, not built on.
- **Tests each change needs:**
  - **Commits:**
    - Broker: `commits` with several topics, stale and out-of-order offsets ignored, credit returned, a group's redelivery after a member detaches with commits pending.
    - Bus client: the interval, the half-credit flush, the flush on `stop`/`restart`/`suspend` before the shutdown answer, a throwing handler stopping the commit, and pending commits sent on the new port after a bus restart.
    - Host controller: the same for host subscriptions.
    - E2E: a pool restart and a wake from suspend resume at the right offset.
  - **Publishes:**
    - Broker: `rejected` for every error code an id-less publish can hit; `acked` cumulative, per port, and only when something is new.
    - Bus client: `{ ack: true }` and persistent topics (named in `init`) still reject; id-less publishes held until acked, re-sent after a bus restart, and counted towards the 1,000 limit; `onError` gets the topic and `seq`.
    - Host: a rejection appears in the isolate's error report.
  - **Batching:**
    - Broker and bus client: order across mixed inner envelopes, one bad inner envelope not affecting the others, size and credit limits per inner record.
    - Host controller: batches on host ports.
    - The engine conformance suites run unchanged.
- **Docs:** the bus protocol section of the design doc and the guide's `ctx.bus.publish` reference (the `ack` option, where rejections go).

## Alternatives considered

- **Deliver once per pool worker (deferred).** The pool's runtime would receive one `deliver` per worker and hand the same record to each member that subscribed. The bus would still decide who may receive it, tagging the delivery with the member ids.
  - **Saves:** from the plant's counts, delivers in `matched` fall from about 815 to about 593 (estimate).
  - **Gives up:**
    - Each member's own copy of a record. A member that mutates a record would change it for the others in its pool. Typed arrays can't be frozen, so the rule would be "don't mutate", or a per-member byte copy.
    - The bus's direct view of each member's position. It would move into the pool runtime.
  - **Why deferred:** decided after decisions 1–3 are measured, and only if deliveries are still a meaningful share of the cost.
- **Commit only on an interval, without the half-credit flush.** Simpler, but a subscription receiving more than 1,000 records per interval would pause on credit.
- **Answer only on failure, without `acked`.** Fewer messages (about 40/s fewer in the plant), but publishes in flight during a bus restart would be lost, and publishers would lose their back-pressure (ADR 0007, step 5; the 1,000 limit).
- **Keep `commit` beside `commits`.** Not needed: both ends of the bus port ship in one build.
- **Shared memory rings between the bus and the workers.** These would remove most copies, but need cross-origin isolation (engine constraint 5), which the demo's hosting can't set. Not now.

## Open questions

1. **Is decision 2 a change to the seam?** `ctx.bus.publish` is part of `IsolateContext` (ADR 0012, decision 2), and today its promise rejects on `invalid`. Decision 2 changes that default for memory topics.
   - **(a)** Treat it as a change made before 0.1, in place, like ADR 0010's M3a amendment. No `@isoloop/*` 0.1 exists yet, and the only isolates built apart are this repo's examples. The floor stays.
   - **(b)** Leave `publish` as it is, and add `ctx.bus.emit(topic, rec)` with decision 2's behaviour. The seam only grows, so nothing has to be deprecated, and apps opt in per call.

   The agreed decision was (a). (b) follows ADR 0012 more strictly, at the cost of a second method.
2. **The commit interval.** At 100 ms the plant's commits fall by about a quarter, because most of its ports receive fewer than 10 records/s. At 250 ms they fall by more than half, and a crash can redeliver up to 250 ms. Should the interval be 250 ms, or measured at both on the server?
3. **`acked` (decision 2, point 6)** wasn't in the agreed outline. It is proposed here because without it a bus restart loses in-flight publishes and publishers lose back-pressure. Is it accepted as part of decision 2?
