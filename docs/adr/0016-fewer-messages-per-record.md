# ADR 0016: Fewer bus messages per record

- **Status:** Accepted
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
- **Config:** `createKernel` validates `bus.commitIntervalMs` (`invalid_config` outside 0–1,000, or not an integer).
- **Docs:** the bus protocol section of the design doc (`commits`, the early sends, the redelivery window), and `KernelConfig.bus.commitIntervalMs` in the guide.

## Alternatives considered

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
