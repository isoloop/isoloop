# ADR 0016: Fewer bus messages per record

- **Status:** Proposed
- **Date:** 2026-11-10
- **Amends:** [ADR 0005](0005-bus-topology-message-channels.md) (what travels on an isolate's bus port) and [ADR 0003](0003-schema-format-standard-schema.md), decision 10 (how a failed publish is reported)
- **Records a change to:** the [ADR 0012](0012-isolates-built-apart.md) seam (`ctx.bus.publish`, decision 2, point 8)
- **Touches:** [ADR 0007](0007-bus-worker-supervision.md), step 5 (publishes re-sent after a bus restart)
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
2. **The bus client sends at most one `commits` per port per commit interval** (point 7; 100 ms by default). It holds the latest settled offset per subscription and sends them together. It sends early:
   - when any subscription's uncommitted count reaches half its credit, so a busy subscription never pauses because of the interval;
   - on `shutdown`, for every reason (`stop`, `restart`, `suspend`), and it **waits for the broker's answer** before it acknowledges, bounded by the shutdown grace. The host's `detach` reaches the bus worker on another channel and can overtake commits that were only sent, so sending isn't enough; waiting is what makes a graceful stop or a suspend lose nothing;
   - on the bus client's own close path, also waiting for the answer.
   After a bus restart (ADR 0007, step 4), commits sent first on the new port are rejected: the broker accepts a commit only for a topic the connection already subscribes to, and on a new port the commits arrive before the subscriptions. So a persistent topic redelivers up to one interval of records after a bus restart. The options, **awaiting the user's decision**:
   - **(a), recommended:** accept that cost. It's the same at-least-once window as after a crash (point 6), and it needs no further protocol change. The client doesn't send commits first on a new port.
   - (b) the broker accepts commits from a reattaching connection before its `subscribe`.
   - (c) `subscribe` carries the client's last settled offset.
3. **What counts as settled is unchanged.** A record is settled when its handler returns. A handler that throws marks the subscription stuck, and the commit stops at the record before it, as `drain` does today.
4. **Host subscriptions do the same:** one `commits` per host port per commit interval, or earlier at half the credit.
5. **The single `commit` message is removed, not kept beside `commits`.** Both ends of the bus port come from one build: the bootstrap, which creates the bus client, ships with the host, and ADR 0012 lists the host ↔ worker protocol as free to change in any release. Keeping both would mean two code paths and two sets of tests for one job.
6. **The cost:**
   - A crashed isolate, or a worker killed without a graceful shutdown, can have up to ~100 ms of handled records delivered again on restart. Delivery is at-least-once already; the window grows from one record to ~100 ms.
   - A group member that crashes leaves up to ~100 ms more for the group's redelivery.
   - The commit lag in `BusMetrics.subscriptions` is coarser by up to ~100 ms.
   - After a bus restart, a persistent topic can redeliver up to one interval of records (point 2, option (a)).
7. **The interval is one kernel setting: `KernelConfig.bus.commitIntervalMs`.**
   - **Default 100 ms.** The server measurements try 100 and 250 ms, and the default follows them.
   - **Range:** an integer from 0 to 1,000. `0` means every task: pending commits are sent at the end of each task that settled a record, in that task's `batch` (decision 3). Anything else makes `createKernel` throw `invalid_config`. The cap keeps the redelivery window after a crash under a second.
   - **Per kernel, not per subscription.** The interval is one timer per port, covering every subscription on it, so a per-subscription value has no natural place. `KernelConfig` has no `bus` block yet. The per-isolate `bus` options are on the manifest (`IsolateManifest.bus.onReset`), so this new block takes the same name. The kernel passes the value to each isolate in `init`. The bus worker doesn't use it for commits; it receives it at `boot` only with decision 2, for `acked`.
   - **`acked` (decision 2, point 6) shares it.** Both say how far behind the other side's bookkeeping may be, and one knob is easier to reason about. They can share it because each has its own early send, independent of the interval: commits at half the credit, `acked` at half the inbox limit. A busy subscription or a busy publisher never stalls because of the interval.

8. **Measured** (PR #166, before merge; benchmark server, Chromium, 4 cores at 2.0 GHz, 4 interleaved runs, `matched` at 5 kHz, with the plant's metrics-sampler fix):
   - port messages from 3,007 to 2,401 a second (−20%) at 100 ms, and to 2,206 (−27%) at 250 ms;
   - the messaging work (browser port delivery plus Isoloop's messaging code) down 8–14 ms/s, beyond the run-to-run spread;
   - the renderer total from 1,167 to 1,144 ms/s at 100 ms and 1,142 at 250 ms, within the spread.

   A commit costs about a third of an average message; most of the messaging cost is in deliveries and publishes, which this decision doesn't touch. 250 ms saves about 5 ms/s more than 100 ms for a 2.5× longer redelivery window, so the default stays 100 ms.

### 2. Memory-topic publishes answer only on failure (amends ADR 0003, decision 10)

1. **On a memory topic, `ctx.bus.publish` resolves once the record is sent.** The bus client sends the `publish` without `id`, so the broker sends no `result` for it on success.
2. **A rejection still reaches the publisher and the host.**
   - The broker answers a failed id-less publish with a new message, bus → isolate: `rejected { topic, epoch, seq, error }`. `epoch` and `seq` are the publish id the client already sends (`PublishId`), so the rejection names the exact publish without the client keeping a promise for it.
   - The bus client passes it to `onError` as a `BusError` with the topic and `seq`. The runtime already forwards `onError` to the host as a non-fatal `error`, so the kernel's isolate reports show it.
   - `BusMetrics.rejected` keeps counting rejections by code, as today.
3. **`{ ack: true }` keeps today's behaviour:** `ctx.bus.publish(topic, rec, { ack: true })` waits for the `result` and rejects with the error.
4. **Persistent topics always wait for the result,** with or without `ack`, so their promise still means the record is on disk. Topic handles (`TopicRef`) carry only a name and schema types, so the bus client can't tell a persistent topic from a memory one. The kernel adds the names of the persistent topics to the isolate's `init`; it has them from the contracts `list`. The bus client then sends an `id` for those topics' publishes.
5. **Requests and replies are unchanged.** They already answer only on failure, or with the reply.
6. **Cumulative acknowledgements keep re-send and back-pressure** (ADR 0007, step 5 and the 1,000 limit):
   - Once per commit interval (decision 1, point 7), the broker sends each publishing port `acked { epoch, seq }`, the highest `seq` it has processed from that port, accepted or rejected. It sends nothing when there's nothing new.
   - It sends early when the port has half the inbox limit (500) processed and not yet acked. Without that, a publisher above 1,000 records per interval would hit `bus_unavailable` only because of the interval.
   - The bus client keeps id-less publishes until they're acked. Up to that point it re-sends them after a bus restart, as it does with unanswered calls today, and they still count towards the 1,000 limit.
   - The cost, at the default interval, is about 10 messages/s per publishing port instead of one per publish.
7. **The cost:**
   - Awaiting a memory-topic `publish` no longer means the bus accepted the record, only that it was sent. Code that relies on the rejection has to pass `{ ack: true }`.
   - A rejection arrives through `onError` instead of the promise, so it no longer reaches the `catch` next to the call.
   - With point 6, nothing else is lost. Without point 6, publishes in flight during a bus crash would be lost and publishers would have no back-pressure.
8. **A recorded change to the ADR 0012 seam.** `ctx.bus.publish` is part of `IsolateContext`, which ADR 0012, decision 2 says only grows between floor changes. This decision changes it in place instead:
   - A memory-topic publish no longer rejects on `invalid`; the rejection goes to `onError`.
   - `{ ack: true }` is added.
   - The floor doesn't move.

   **Why in place:** there's no `@isoloop/*` 0.1 yet and so no users; the only isolates built apart are this repo's examples, which move with it. A second method, `ctx.bus.emit()`, with the new behaviour and `publish` left alone, would keep the seam growing. But then only code that switched to `emit` would gain, and every app would carry both methods. From 0.1, a change like this goes through ADR 0012's deprecation and floor rules.

### 3. Batching per port per task, as an experimental opt-in (amends ADR 0005)

1. **Off by default, behind one kernel setting: `KernelConfig.bus.batch`** (boolean, default `false`), in the `bus` block decision 1 adds. The kernel passes it to each isolate in `init` and to the bus worker at `boot`; host ports read it directly.
2. **A new `batch { msgs: Envelope[] }` message**, in both directions on the bus port. **Every receiver always accepts it**, whatever the setting. **A sender batches only when the setting is on:** it queues envelopes and flushes them at the end of the current task, from a microtask; one envelope is sent as itself, two or more as one `batch`. With the setting off, nothing changes on the wire.
3. **Each inner envelope stays whole.** It keeps its own `t`, `id`, `isolate` (pool member) and payload. The receiver handles them in order, as if they had arrived one by one. So:
   - order per port is unchanged;
   - size limits, schema checks, ACL and credit apply per publish and per record, as today;
   - devtools and reports see every message, with its own details.
4. **`commits` (decision 1) and `acked` (decision 2) ride in the same batch** as the publishes and delivers sent in that task. An engine that handles a chunk and publishes its result in one task sends its publish and its commit in one message.
5. **No added latency beyond the current task.** Nothing waits for a timer or a frame; only commits and acks have intervals, set in decisions 1 and 2.
6. **The cost:** one larger clone instead of several smaller ones, and an end-of-task queue in the bus client, the broker and the host controller. Credit still bounds how much a single `batch` can hold. A second code path: the bus conformance suites run with the setting both on and off.
7. **Measurement decides what happens to it** (the benchmark server, the same build with the setting on and off):
   - **it saves beyond the spread with nothing lost:** it becomes the default (`batch: true`), and the setting stays to turn it off;
   - **it doesn't save beyond the spread:** it is removed, with its message type;
   - **it saves only for some workloads** (for example high fan-out dashboards): it stays opt-in, and the guide says when to turn it on.

## Consequences

- **Protocol version.** `PROTOCOL` stays `{ v: 1, min: 1 }`.
  - The changes are new message types (`commits`, `rejected`, `acked`, `batch`) and the removal of `commit`, on a port whose two ends come from one build (ADR 0012, decision 2).
  - Isolates built apart don't speak the bus protocol; they use `ctx.bus`.
  - The M5b plan assumed a new message shape would need a version bump. It doesn't here, for the same reason: no port carries two builds' versions of the protocol.
  - `ctx.bus.publish` is the one seam change, recorded in decision 2, point 8.
- **Expected messages per second for the plant**, `matched` at 1 kHz. These are **estimates** from reading the code, not measurements; the server runs decide.
  - **Baseline:** about 1,760, after the app moves `plant.timings` off the bus and drops the health engine's subscription to its own topic.
  - **Decision 1:** commits from about 610 to about 450 at the default 100 ms interval. Ports that receive fewer than 10 records/s already commit less often than the interval, so only faster ones save. At 250 ms it's about 260. The server runs measure both (`KernelConfig.bus.commitIntervalMs`).
  - **Decision 2:** about 260 results fewer, and about 10 `acked`/s per publishing port more (roughly 40 feeds and engines).
  - **Decision 3:** about 120–160 fewer with `bus.batch` on: the feed's vib and scalars in one message, and engines' commits riding with their publishes. Off by default, so nothing changes unless it's turned on.
  - **Together:** about 1,150–1,250, roughly a third below the baseline.
- **Implementation order,** each landing separately as a `next` prerelease and measured on the benchmark server before the next:
  1. combined commits;
  2. publishes answering only on failure, with `acked`;
  3. batching.

  A step that doesn't measure as a saving beyond the round-to-round spread is reverted, not built on.
- **Tests each change needs:**
  - **Commits:**
    - Broker: `commits` with several topics, stale and out-of-order offsets ignored, credit returned, a group's redelivery after a member detaches with commits pending.
    - Bus client: the interval (`0`, the default and the maximum), the half-credit flush, the flush on `stop`/`restart`/`suspend` before the shutdown answer, a throwing handler stopping the commit, and pending commits sent on the new port after a bus restart.
    - Host controller: the same for host subscriptions.
    - E2E: a pool restart and a wake from suspend resume at the right offset.
  - **Publishes:**
    - Broker: `rejected` for every error code an id-less publish can hit; `acked` cumulative, per port, only when something is new, and early at half the inbox limit.
    - Bus client: `{ ack: true }` and persistent topics (named in `init`) still reject; id-less publishes held until acked, re-sent after a bus restart, and counted towards the 1,000 limit; `onError` gets the topic and `seq`.
    - Host: a rejection appears in the isolate's error report.
  - **Batching:**
    - Broker and bus client: order across mixed inner envelopes, one bad inner envelope not affecting the others, size and credit limits per inner record.
    - Host controller: batches on host ports.
    - The bus conformance suites run with `bus.batch` both on and off.
    - The engine conformance suites run unchanged.
- **Config:** `createKernel` validates `bus.commitIntervalMs` (`invalid_config` outside 0–1,000) and `bus.batch` (`invalid_config` if not a boolean).
- **Docs:** the bus protocol section of the design doc, the guide's `ctx.bus.publish` reference (the `ack` option, where rejections go), `KernelConfig.bus.commitIntervalMs` and `KernelConfig.bus.batch` (experimental, and when to turn it on if it stays opt-in).

## Alternatives considered

- **Deliver once per pool worker (deferred).** The pool's runtime would receive one `deliver` per worker and hand the same record to each member that subscribed. The bus would still decide who may receive it, tagging the delivery with the member ids.
  - **Saves:** from the plant's counts, delivers in `matched` fall from about 815 to about 593 (estimate).
  - **Gives up:**
    - Each member's own copy of a record. A member that mutates a record would change it for the others in its pool. Typed arrays can't be frozen, so the rule would be "don't mutate", or a per-member byte copy.
    - The bus's direct view of each member's position. It would move into the pool runtime.
  - **Why deferred:** decided after decisions 1–3 are measured, and only if deliveries are still a meaningful share of the cost.
  - **If it's ever done, it's an opt-in per pool** (for example `pools: { <name>: { shareRecords: true } }`), not a default, because its trade-off is real: the members of that pool give up their own copies.
- **Batching on by default from the start.** It loses no feature on paper, but its saving is the least certain of the three; decision 1 measured smaller than its estimate. It earns the default by measurement (decision 3, point 7).
- **Commit only on an interval, without the half-credit flush.** Simpler, but a subscription receiving more than 1,000 records per interval would pause on credit.
- **A separate interval for `acked`.** Not needed while each has its own early send (decision 1, point 7). It can be split later without changing the protocol.
- **`ctx.bus.emit()` beside an unchanged `publish`.** It keeps ADR 0012's seam growing, but only code that switches to it gains (decision 2, point 8).
- **Answer only on failure, without `acked`.** Fewer messages (about 40/s fewer in the plant), but publishes in flight during a bus restart would be lost, and publishers would lose their back-pressure (ADR 0007, step 5; the 1,000 limit).
- **Keep `commit` beside `commits`.** Not needed: both ends of the bus port ship in one build.
- **Shared memory rings between the bus and the workers.** These would remove most copies, but need cross-origin isolation (engine constraint 5), which the demo's hosting can't set. Not now.
