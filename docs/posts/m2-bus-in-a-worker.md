# A Kafka-shaped bus in a Web Worker

*M2 write-up, 2026-11-06*

M2's promise was one sentence: **a restarted isolate rebuilds its state from the log in a test.** That test is [`e2e/replay.spec.ts`](../../e2e/replay.spec.ts). It clicks A five times, sends two notes, then crashes D, the isolate that keeps the message log. The new D reads exactly the seven records back from the bus and shows the same history, with no new events. A headless store isolate is restarted the same way and rebuilds its state from its command topics, while the isolates reading it keep showing the latest state the whole time.

## Why the bus has its own worker

In M0 and M1 the bus was a stand-in on the main thread. The RFC put the broker in a worker but still routed every record through a "bus bridge" on the main thread, which meant four copies per record and a main thread busy copying data it never looks at.

So the bus worker talks to isolates directly ([ADR 0005](../adr/0005-bus-topology-message-channels.md)):

- The kernel starts the bus worker first, then creates one `MessageChannel` per isolate. One end goes to the isolate, the other to the bus in `attach`, together with the isolate's grants.
- Every `publish`, `subscribe`, `deliver` and `commit` travels on that port. **No record crosses the main thread**, except the ones the host asks for itself through `kernel.publish` and `kernel.subscribe`.
- The replay test checks it: four-loops counts the messages the main thread receives, and after all those clicks, notes and crashes it has seen zero `deliver`s.

## What "Kafka-shaped" means here

- **Topics are append-only logs with offsets.** Retention is per topic: `last-n`, `time`, or `compacted` (the latest record per key). A subscriber starts from `earliest`, `latest` or its `committed` offset.
- **Contracts are checked in the broker** ([ADR 0003](../adr/0003-schema-format-standard-schema.md)). Every topic has a schema, in any Standard Schema library (Zod and Valibot are tested), loaded from one contracts module. An invalid publish is rejected before it reaches the log, and the log stores the schema's *output*, so a transform or a default runs once, not in every subscriber.
- **Grants are enforced by the bus, not by trust.** An isolate can only publish and subscribe to what its manifest grants. A browser test with a real kernel and bus worker ([`grants.test.ts`](../../packages/host/src/grants.test.ts)) checks the whole path, from the manifest to `attach` to the broker.
- **Backpressure is credit-based.** A subscriber holds up to 1,000 undelivered records; past that, delivery pauses until it commits. Records arrive in batches of up to 64. If retention drops records a slow subscriber hadn't read, it gets a `gap` with the missing range instead of a silent jump.
- **Consumer groups and request/response** are in too: members of a group split a keyed stream with per-key order kept, and `bus.request` / `reply` validate replies against a schema, first valid reply wins.
- **Routing goes through the bus.** The host owns the URL and publishes it to the system topic `isoloop.route.v1` ([ADR 0002](../adr/0002-host-owns-routing.md)). Isolates that care subscribe; `navigate` needs a grant.

## When the bus itself crashes

The bus worker runs only our code, so it fails from our bugs, not from an isolate. It's supervised like an isolate, with heartbeats and a restart limit ([ADR 0007](../adr/0007-bus-worker-supervision.md)). What's different is the recovery:

- **Isolates keep running.** The kernel starts a new bus worker and hands every isolate a new port (`reattach`). Their `BusClient` re-sends its subscriptions, then the publishes the old bus never answered, in order.
- **Memory topics are gone, and isolates are told.** Each subscription gets exactly one `reset`, so an adapter can clear and refill instead of showing stale data. An isolate that can't cope declares `onReset: 'restart'` and is restarted instead.

A browser test kills the bus on purpose and checks both ([`bus.test.ts`](../../packages/host/src/bus.test.ts)): every isolate stays `running`, and every memory subscription sees one `reset`.

## Isolates that sleep

M2 also lifted M1's `suspend_unsupported` guard ([ADR 0001](../adr/0001-one-worker-per-isolate.md)). An isolate with `suspend: 'when-idle'` is stopped after a quiet minute (unless it holds `keepAwake`) and started again when a record arrives on one of its topics. On wake it gets every record it missed, in order, or a `gap` if retention dropped some. Hidden visual isolates aren't woken by records; they catch up when shown. It's opt-in, and the default stays `'never'`. Eight browser tests cover it ([`suspension.test.ts`](../../packages/host/src/suspension.test.ts)).

## The unflattering numbers

[`bench/throughput`](../../bench/throughput) runs 10 isolate workers subscribed to one publisher, with 200-byte records. On CI, headless Chromium ([#50](https://github.com/isoloop/isoloop/pull/50)):

| | result | budget |
| --- | --- | --- |
| records/s delivered | 45.5k (36.7k locally) | ≥ 50k |
| p95 delivery latency | 125 ms | (report only) |

We're under budget, and the reason is plain. Every `publish` reaches the bus worker as its own task, and the broker only coalesces deliveries within one microtask, so a "batch" never holds more than one record. Each record costs 11 `postMessage`s: one `result` back to the publisher and one `deliver` to each of the 10 subscribers. The 125 ms is mostly queueing: the bench keeps up to 500 publishes unanswered, and they wait behind each other.

We left the budget where it is. Batching across tasks is a spike of its own, [M5b](../plans/m5b-delivery-batching.md), after the shared-memory engine in M5. It ends either in a design change or in an honest new number for the budget.

## What M2 didn't do

- **Nothing is durable yet.** Every topic lives in the bus worker's memory, so a bus crash means `reset` and a page reload means an empty log. `durability: 'persistent'` is accepted but behaves as memory. [M2b](../plans/m2b-durable-log.md) writes persistent topics to the Origin Private File System, with group commit and crash recovery.
- **Re-sent publishes could duplicate once the log is durable.** After a bus crash, an isolate re-sends what the old bus never answered, which is safe while the old log dies with the worker. Once records survive on disk, the old bus may already have written one. M2b deduplicates on a producer id and sequence number, so the re-send gets the original offset back instead of a second copy.
- **The contracts module's load time wasn't measured with Zod.** Isolates start in parallel and the bus buffers their publishes while contracts load, but the bench's contracts have no Zod, so the cost is still unknown.

## Next

M2b (the durable log) and M3a (Preact and React adapters) run in parallel. Then M3b builds the markets dashboard on them: live exchange feeds in headless isolates, with no backend, switchable to single-threaded mode beside live metrics.
