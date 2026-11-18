# ADR 0016: Fewer bus messages per record

- **Status:** Accepted. Amended 2026-11-17 (accepted the same day, [#211](https://github.com/isoloop/isoloop/issues/211)): commits carry a delivery sequence, so a group commit can't cover a record redelivered after it (points 10–13), and a consumer group that has committed resumes from its committed offset whatever `from` says (point 14). Points 15 and 16, added 2026-11-17 after the fix (#224), record what a by-hand commit settles and what happens to a record from an old connection. Amended 2026-11-18 (proposed, M3j): a commit also covers the settled first records of a delivery that's only partly settled, so a member that stops partway through a delivery keeps them (points 17 and 18).
- **Date:** 2026-11-11 (proposed 2026-11-10)
- **Amends:** [ADR 0005](0005-bus-topology-message-channels.md), what travels on an isolate's bus port: commits are combined
- **Evidence:**
  - [plant CPU investigation](../investigations/plant-cpu.md) (PR #165), including the measurements of decision 1 and of the batching experiment
  - [plant memory investigation](../investigations/plant-memory.md) (PR #162)
  - in `isoloop/examples`, the matched head-to-heads in `apps/dashboards/plant/comparison/matched/` and `matched-q6/`

## Context

On the matched head-to-head (4 physical cores fixed at 2.0 GHz), Isoloop's plant dashboard uses 8–19 percentage points more CPU across threads than the native builds. A per-thread CPU profile put most of that gap in moving records between threads. In `matched` against native + workers at 5 kHz, the renderer gap is +180 ms/s:

- **+101 ms/s** is the browser delivering port messages. That cost is mostly a fixed price per `MessagePort` message (a mojo receive, a watcher wake-up and `MessagePort::Accept`), not per byte. A worker's own `postMessage`, which native + workers uses, skips most of it.
- **+45 ms/s** is Isoloop's own messaging code on both ends: the broker, the bus client, validation, guards and the host bus controller.

For each record with *k* subscribing isolates, the bus port carries:

1. one `publish`, isolate → bus;
2. one `result` back;
3. *k* `deliver`s. A `deliver` carries `records: BusRecord[]`, but in steady state each holds one record;
4. *k* `commit`s, one per record per subscription. Host subscriptions commit once per `deliver`.

What the per-record commits do, and must keep doing: they set where a restarted or woken isolate resumes (`from: 'committed'`), and they return **credit**. The broker pauses a subscription after 1,000 records delivered and not committed (design §6.3), and redelivers a group's uncommitted records to another member.

The rule this ADR follows, agreed with the user on 2026-11-10: a change goes in if it keeps every feature and measures as a saving beyond the noise on the benchmark server. A change that weakens a feature goes to the user on its own, with its exact cost.

The proposal had three decisions: combined commits; memory-topic publishes answering only on failure; and batching per port per task, as an experimental opt-in. They were built and measured one at a time. Decision 1 is accepted. The other two are recorded under [Not taken](#not-taken).

## Decision

### Combined commits

1. **A new `commits` message** on the bus port, isolate → bus: `commits { offsets: { topic: string; offset: number }[] }`. Each entry is the highest settled offset of one subscription, the same value a `commit` carried.
2. **The bus client sends at most one `commits` per port per commit interval** (point 7; 100 ms by default). It holds the latest settled offset per subscription and sends them together. It sends early:
   - when any subscription's uncommitted count reaches half its credit, so a busy subscription never pauses because of the interval;
   - on `shutdown`, for every reason (`stop`, `restart`, `suspend`). It **waits for the broker's answer** before it acknowledges, bounded by the shutdown grace. The host's `detach` reaches the bus worker on another channel and can overtake commits that were only sent, so sending isn't enough. Waiting is what makes a graceful stop or a suspend lose nothing;
   - on the bus client's own close path, also waiting for the answer.
3. **After a bus restart** (ADR 0007, step 4), the client **doesn't send commits first on the new port.** The broker accepts a commit only for a topic the connection already subscribes to, and on a new port commits would arrive before the subscriptions. So a persistent topic can redeliver up to one interval of records after a bus restart. That's the same at-least-once window as after a crash (point 6), and it needs no further protocol change. Accepting commits before `subscribe`, or carrying the last offset in `subscribe`, were the alternatives (see [Alternatives considered](#alternatives-considered)).
4. **What counts as settled is unchanged.** A record is settled when its handler returns. A handler that throws marks the subscription stuck, and the commit stops at the record before it.
5. **Host subscriptions do the same:** one `commits` per host port per commit interval, or earlier at half the credit.
6. **The single `commit` message is removed, not kept beside `commits`.** Both ends of the bus port come from one build: the bootstrap, which creates the bus client, ships with the host, and ADR 0012 lists the host ↔ worker protocol as free to change in any release.
7. **The cost:**
   - A crashed isolate, or a worker killed without a graceful shutdown, can have up to one interval (~100 ms) of handled records delivered again on restart. Delivery is at-least-once already; the window grows from one record to one interval.
   - A group member that crashes leaves up to one interval more for the group's redelivery.
   - After a bus restart, a persistent topic can redeliver up to one interval of records (point 3).
   - The commit lag in `BusMetrics.subscriptions` is coarser by up to one interval.
8. **The interval is one kernel setting: `KernelConfig.bus.commitIntervalMs`.**
   - **Default 100 ms.** 250 ms was measured too (point 9). It saves about 5 ms/s more for a 2.5× longer redelivery window, so the default stays 100 ms.
   - **Range:** an integer from 0 to 1,000. `0` means every task: pending commits are sent at the end of each task that settled a record. Anything else makes `createKernel` throw `invalid_config`. The cap keeps the redelivery window after a crash under a second.
   - **Per kernel, not per subscription.** The interval is one timer per port, covering every subscription on it. The per-isolate `bus` options are on the manifest (`IsolateManifest.bus`), so this new block takes the same name.
   - **Who uses it:** the kernel passes it to each isolate in `init`, and host ports read it directly. The bus worker doesn't need it: it only receives commits, whenever they arrive.
9. **Measured** (PR #166 before merge; benchmark server, Chromium, 4 cores at 2.0 GHz, 4 interleaved runs, with the plant's metrics-sampler fix), `matched` at 5 kHz:

   | | Port messages/s | Messaging work, ms/s | Renderer total, ms/s |
   | --- | --- | --- | --- |
   | Per-record `commit` | 3,007 | 165 | 1,167 [1,146–1,181] |
   | `commits`, 100 ms | 2,401 (−20%) | 155 | 1,144 [1,083–1,159] |
   | `commits`, 250 ms | 2,206 (−27%) | 147 | 1,142 [1,131–1,153] |

   Messaging work is the browser's port delivery plus Isoloop's messaging code. It's down 8–14 ms/s, beyond the run-to-run spread; the renderer total moves within it. `one` and 1 kHz show the same pattern (16–24% fewer messages). It keeps every feature and cuts messages clearly, so it passes the rule. A commit costs about a third of an average message. Most of the messaging cost is in deliveries and publishes, which this decision doesn't touch.

### Group commits carry a delivery sequence (amended 2026-11-17)

Found by the processor example (isoloop/web#130) and reproduced in `packages/bus/src/groups-commit-loss.test.ts` ([investigation](../investigations/group-commit-loss.md), [#211](https://github.com/isoloop/isoloop/issues/211)).

**The bug.** A commit is cumulative: "everything I hold up to offset N is settled". In a consumer group that assumes a member receives offsets in rising order, and redelivery breaks it. When a member leaves, its uncommitted records go to the others before anything new, so a member can be handed a record whose offset is *lower* than records it has already settled. Its next commit then covers that record before the handler has run. That happens within one interval (the committer already holds a higher offset), or when a commit that was already in flight arrives after the reassignment. The broker drops the entry, and the group's offset moves past it. If that member then stops before it gets to the record (a balancer move does exactly this), nobody gets it again. The design's promise, "a member that leaves hands its uncommitted records to the others", is broken.

10. **Every `deliver` carries a `seq`:** `deliver { topic, records, gap?, seq }`. It counts the deliveries to one subscription on one connection, from 1 at each `subscribe`. The broker records, on each group entry, the `seq` of the delivery it went out in, including when the entry is redelivered to another member.
11. **Every commit entry carries a `seq` too:** `commits { offsets: { topic, offset, seq }[] }`. `seq` is the highest delivery whose records, and those of every earlier delivery on that subscription, are all settled. The committer tracks it beside the highest settled offset. What counts as settled is unchanged (point 4).
12. **A group commit covers only entries with `offset ≤ N` and `seq ≤ S`.** A record redelivered after the commit's deliveries has a higher `seq`, so neither the in-order case nor the crossing can cover it. Records of a delivery that's only partly settled are covered once the whole delivery is. A subscription that isn't in a group keeps the offset rule: its deliveries are always in order, so `seq` never changes the answer there, and its commit lag is unchanged.
13. **What it costs and keeps:**
    - One integer per `deliver` and one per commit entry. Commits stay combined, one `commits` per port per interval, so point 9's message counts stand.
    - Host subscriptions share the committer and get the same rule.
    - Redelivery stays at-least-once: this removes the loss, not the duplicates. A group member that crashes still leaves up to one interval of handled records for the others (point 7).
    - `seq` is per connection and isn't stored. After a bus restart (ADR 0007), a reattaching connection starts again at 1, and the client still sends no commits first on the new port (point 3).
    - `PROTOCOL` stays `{ v: 1, min: 1 }`: both ends of the bus port come from one build (point 6), and `ctx.bus` doesn't change.
14. **A group that has committed resumes from its committed offset, whatever `from` says.** Until now a group that every member had left and that rejoined with `from: 'earliest'` started at the topic's tail and replayed it (the processor did 117 files twice). Now `from` applies only when the group has no committed offset yet: on its first join, or after its offsets were dropped with the topic. Its committed offset is kept, as before, under the consumer id `group:<name>`. `from` on a member joining a group that already has members changes nothing either way: the member takes records from where the group is. The design's "Subscriptions and consumers" and "Groups" paragraphs and the bus guide say so, and that group members don't need `from: 'committed'` for this.

15. **A by-hand `commit(record)` settles that record and every record delivered before it on the subscription** (decided while building the fix, [#224](https://github.com/isoloop/isoloop/pull/224)). Records settle in the order they arrived, so with `autoCommit: false` a commit means "everything up to here is done", as it did before the amendment. The `seq` it sends is that of the latest delivery the commit completes. The alternative was counting each by-hand commit as one record. Then a member that commits only some records would never complete a delivery, its `seq` would stop moving, and its group entries would pause at the credit limit. An isolate that keeps several records in flight after its handler returns must commit the last record whose earlier arrivals are all done.
16. **A record from an old connection commits nothing** (also #224). A record delivered before a bus restart (ADR 0007), or to a subscription since replaced by a new `subscribe`, carries a `seq` from that connection or subscription. If its handler settles it afterwards, the client drops the commit. That follows point 3 (no commits sent first on a new port), and a `seq` from another connection would cover the wrong deliveries. The record comes back through redelivery, which is at-least-once anyway. Offsets the host carries over to a new port go out with `seq: 0`, which never covers a group entry.

### A partly settled delivery keeps what it settled (amended 2026-11-18, M3j)

Found by the M3j bench run of the File processor (isoloop/web, `@isoloop/*@0.1.0-next.2`, 4 cores at 2.0 GHz), reproduced on the bench server with crash logging, and in `groups-commit-loss.test.ts` by a test that arrives with the fix ([#256](https://github.com/isoloop/isoloop/pull/256)).

**The bug.** Point 12 covers a delivery's records only once all of them are settled. A member that falls behind gets its records in batches: the broker sends up to 64 a delivery, as many as its credit allows. If it settles the first records of a batch and then stops, by a crash, a move or a stop, it has committed none of them, and the whole batch goes back to the group. Usually that costs only duplicates. But in the bench run, a corrupt file was settled first in its batch, and its processor crashed a moment later on purpose, as that kind of file does. The file was sent again to the next image processor, which crashed the same way. The two crashed in turn, 8 or 9 times in about 8 s, until the kernel gave up on both. That happened in all 16 balancer runs with faults, which lost about 480 files each. At full clock speed the processors keep up, deliveries carry one record each, and it didn't happen.

17. **A commit entry carries `partial`: how many records of delivery `seq + 1` are settled,** counting from the delivery's first record, in the order they arrived: `commits { offsets: { topic, offset, seq, partial? }[] }`. A group commit also covers the entries of delivery `seq + 1` whose place in it is below `partial`; the broker keeps each entry's place beside its `seq`. Points 11 and 12 otherwise stand:
    - **A redelivered record still can't be covered early.** A commit point names a delivery the member has already received, so a record redelivered later is in a later delivery.
    - **Records settle in the order they arrived** (point 15), so the settled records of a delivery are always its first ones, and a count is enough.
    - **The committer keeps the furthest point:** a whole delivery is further than any part of it, and the highest offset is kept as before.
    - **Own subscriptions** already cover by offset, so nothing changes for them.
    - **The cost** is one more integer in an entry, only while a delivery is partly settled. `PROTOCOL` stays `{ v: 1, min: 1 }`, as in point 13.
18. **A record that crashes every member before it's settled still comes back to each of them** until the kernel gives up on all of them. That's at-least-once delivery with no limit on attempts, and point 17 doesn't change it. A dead-letter topic, which would set a record aside after a number of failed attempts, is in [would-like](../would-like.md).

## Not taken

- **Batching per port per task, as an experimental opt-in (`KernelConfig.bus.batch`), built and removed.**
  - **What it was:** envelopes sent on one port in one task travelling as one `batch` message, each inner envelope whole. Off by default, with a rule: it becomes the default if it saves beyond the spread with nothing lost, and it's removed if it doesn't.
  - **Measured** (PR #167, closed unmerged), on top of combined commits at 100 ms, with the setting off and on: port messages fell only 3–5% (`matched` at 5 kHz, 2,391 → 2,316). No CPU figure moved beyond the spread. The bus worker spent 2–4 ms/s more on its end-of-task queue.
  - **Why it saved so little:** in this app few messages leave the same port in one task, and the broker already sends a subscription's records together. Most of the remaining messages are one record delivered to several isolates, each on its own port, which batching per port can't merge.
  - So it was removed, per its own rule, with its message type. Two fixes it surfaced don't depend on it and landed separately (#169): synchronous handlers no longer yield per record, and a host bus test that passed by timing.
- **Memory-topic publishes answering only on failure (would have amended ADR 0003, decision 10).**
  - **What it was:** a memory-topic `publish` resolving once sent; a rejection coming back as a `rejected` message to `onError`; `{ ack: true }` for today's behaviour; persistent topics always waiting; and a cumulative `acked` about every interval to keep the re-send after a bus restart (ADR 0007, step 5) and the 1,000-unanswered back-pressure.
  - **Why not:** it would remove about 345 `result`s a second in `matched`. Decision 1 measured about 8–14 ms/s for about 600 fewer messages, which puts this at roughly 5–8 ms/s, an estimate from that rate, not a measurement. That saving doesn't justify changing what awaiting `publish` means, moving rejections away from the call's `catch`, and changing the ADR 0012 seam (`ctx.bus.publish`). Under the rule, a weakened feature needs a saving to match.
  - ADR 0003, decision 10 and the ADR 0012 seam stay as they are.

### What remains of the messaging cost

What's left is mostly the bus hop (ADR 0005) times Chromium's fixed cost per port message. Every record crosses threads at least twice, producer → bus worker → subscribers, where native + workers posts once. With commits combined, the remaining messages are publishes, their results and deliveries, and the measurements above put little of that within reach of message-level changes.

- **The one lever left that would remove most copies is shared-memory rings** between the bus worker and the isolates. They need cross-origin isolation (engine constraint 5), which the demo's hosting (GitHub Pages) can't set. Not now.
- **One delivery per pool worker stays deferred** (see [Alternatives considered](#alternatives-considered)).

## Consequences

- **Protocol version.** `PROTOCOL` stays `{ v: 1, min: 1 }`.
  - The change is a new message type, `commits`, and the removal of `commit`, on a port whose two ends come from one build (ADR 0012, decision 2).
  - Isolates built apart don't speak the bus protocol; they use `ctx.bus`, which doesn't change.
- **Tests** (PR #166):
  - Committer unit tests: at most one send per interval, the redelivery window within one interval, the early send at half the credit, `0` meaning every task, and the 0–1,000 check.
  - Bus client, one test per early send:
    - half the credit
    - a throwing handler stopping at the record before it
    - close waiting for the broker's answer
    - before an unsubscribe
    - after a bus restart, no commits sent first on the new port
    - a reset clearing a lost topic
  - Host and kernel: `invalid_config` for -1, 1,001 and 2.5; a host subscription at a 1 s interval receiving all 1,500 records of a last-100 topic, in order.
  - A kill within the interval redelivers what was handled in it, the cost point 7 accepts.
- **Tests for the amendment:** `groups-commit-loss.test.ts` passes (no longer `it.fails`), covering the in-order case and the crossing; a member stopped right after a redelivery loses nothing; own subscriptions' commits unchanged; a group that empties and rejoins `from: 'earliest'` resumes after its committed offset, and a new group with `earliest` starts at the tail.
- **Tests for the 2026-11-18 amendment,** arriving with #256: in `groups-commit-loss.test.ts`, a member that crashes partway through a delivery keeps what it settled (it fails without point 17), and a partly settled delivery never covers a record redelivered after it. The committer keeps the furthest point.
- **Config:** `createKernel` validates `bus.commitIntervalMs` (`invalid_config` outside 0–1,000, or not an integer).
- **Docs:** the bus protocol section of the design doc (`commits`, the early sends, the redelivery window), and `KernelConfig.bus.commitIntervalMs` in the guide. For the 2026-11-18 amendment, the design doc's `commits` message and "Groups" paragraph gain `partial` (#256); the guide's wording on at-least-once delivery stands.

## Alternatives considered

- **For #211 (point 12), redelivered records needing an exact commit.** The broker would never let a cumulative commit cover a redelivered entry, and the client would commit those offsets one by one. A smaller broker change, but `commits` would need a second shape, and a burst of redeliveries after a member leaves would become one entry per record, which this ADR set out to avoid.
- **For #211, group commits as ranges of settled offsets.** Exact in every ordering, and ranges stay small when records are handled in order. But it's the largest change: group commits would stop sharing the single-offset shape, and the broker would have to merge ranges.
- **For point 14, keeping `from` as it is and telling group members to use `from: 'committed'`.** That leaves a replay of the whole topic one option name away, and a group that has committed has already said where it stands.

- **Deliver once per pool worker (deferred).** The pool's runtime would receive one `deliver` per worker and hand the same record to each member that subscribed. The bus would still decide who may receive it, tagging the delivery with the member ids.
  - **Saves:** from the plant's counts, delivers in `matched` fall from about 815 to about 593 a second (estimate).
  - **Gives up:**
    - Each member's own copy of a record. A member that mutates a record would change it for the others in its pool. Typed arrays can't be frozen, so the rule would be "don't mutate", or a per-member byte copy.
    - The bus's direct view of each member's position. It would move into the pool runtime.
  - **If it's ever done, it's an opt-in per pool** (for example `pools: { <name>: { shareRecords: true } }`), not a default, because its trade-off is real.
- **After a bus restart, let the broker accept commits from a reattaching connection before its `subscribe`, or have `subscribe` carry the client's last settled offset.** Either would close the redelivery window after a bus restart. Both add protocol for a window that's the same as after a crash, so the client simply doesn't send them (decision point 3).
- **Commit only on an interval, without the half-credit early send.** Simpler, but a subscription receiving more than 1,000 records per interval would pause on credit.
- **Keep `commit` beside `commits`.** Not needed: both ends of the bus port ship in one build.
- **Shared-memory rings between the bus and the workers.** See [What remains of the messaging cost](#what-remains-of-the-messaging-cost).
