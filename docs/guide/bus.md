# The bus

The bus is a log of records per topic, in its own worker, with retention, replay, consumer groups, request and reply, and an optional durable copy on disk.

## When to use it

Use the bus for everything that crosses between isolates, and between isolates and the host: feeds, state that other widgets read, commands, and questions that need an answer. An isolate never calls another isolate directly, so a crash in one doesn't reach the others, and the bus keeps what they missed.

- **State others read:** a compacted topic keeps the latest record per key, so a widget that starts late reads the current value from `earliest`.
- **Work to share out:** a consumer group splits a topic's records among its members (`@experimental`).
- **A question with one answer:** request and reply on a topic with a `reply` schema (`@experimental`).
- **State that must survive a reload:** a `persistent` topic.

It isn't a database or a queue between tabs. Each tab has its own bus ([Limits](#limits)).

To declare topics and schemas, see [contracts and grants](contracts.md). To give the kernel the bus worker and the contracts module, see [hosting](hosting.md#the-bus-worker-and-the-contracts-module).

## Where the bus runs

The kernel starts the bus worker before any isolate. Each isolate gets a `MessageChannel` of its own to it, so records go from an isolate's worker to the bus worker and on to the subscribers' workers without passing through the main thread. The records that do reach the main thread are the host's own: `kernel.publish`, `kernel.subscribe` and `kernel.request`.

The bus worker runs only Isoloop's code, never an isolate's. It checks each publish against the isolate's **grants**, the topic's schema and size limit, and appends the validated output to the topic's log ([diagram: a record through the bus](../diagrams/bus-publish.html)).

## Topics and records

A **topic** is a named, ordered log. Its name carries a major version (`plant.ticks.v1`). A **record** is one entry in it:

| Field | Meaning |
| --- | --- |
| `offset` | The record's place in its topic. Offsets start at 0, only go up, and are never reused. |
| `key` | An optional string you set when publishing. Consumer groups and compaction use it. |
| `value` | What the topic's schema produced. Records are never validated again on replay. |
| `ts` | `Date.now()` when the bus appended it. |
| `producer` | The publishing isolate's id, `host` for `kernel.publish` and `kernel.request`, `kernel` for the kernel's own topics. |
| `req` | Set on a request: who asked (`from`) and under which `id`. |

`isoloop.*` topics belong to the kernel. Every isolate may subscribe to them without a grant, none may publish to them, and `kernel.publish` rejects them with `forbidden`. Contracts that name one fail with `reserved_topic`.

A topic's size limit is `maxRecordBytes`, 256 KiB by default (`DEFAULT_MAX_RECORD_BYTES`), a rough estimate of the value's structured size. A bigger value rejects with `too_large`.

## Publishing and subscribing

Grants decide which topics an isolate may use. They're set when you spawn it, and the isolate can't widen them. A pattern without `*` matches exactly. `*` matches one or more characters, dots included, so `plant.*` covers `plant.ticks.v1`. The default is no grants.

```ts
import statsUrl from './stats?isolate';

kernel.spawn({
  id: 'stats',
  src: statsUrl,
  grants: {
    publish: ['plant.stats.*'],
    subscribe: ['plant.ticks.v1', 'plant.settings.v1'],
  },
});
```

In an isolate, `ctx.bus` publishes and subscribes. `publish` resolves once the bus has appended the record, and rejects with a `BusError` whose `code` says why (`forbidden`, `invalid`, `too_large`, `unknown_topic`, `bus_unavailable`, and the others in this page). For `invalid`, `issues` lists the schema's messages and paths.

```ts
import { defineIsolate } from '@isoloop/runtime';
import { z } from 'zod';
import { topic } from '@isoloop/bus';

const ticks = topic('plant.ticks.v1', {
  schema: z.object({ sensor: z.string(), value: z.number() }),
  retention: { kind: 'last-n', n: 500 },
});

export default defineIsolate({
  start(ctx) {
    const stop = ctx.bus.subscribe(
      ticks,
      (r) => {
        console.log(r.offset, r.key, r.value.value);
      },
      { from: 'earliest' },
    );
    void ctx.bus.publish(ticks, { key: 'boiler-1', value: { sensor: 'boiler-1', value: 71.5 } });
    ctx.onShutdown(stop);
  },
});
```

### Where a subscription starts

`from` says where a new subscription reads from:

- **`latest`** (the default): new records only.
- **`earliest`:** the oldest record the topic still retains.
- **`committed`:** the record after the last one this isolate settled on the topic. With no commit yet, it starts at `earliest`.

An isolate's place is kept under its id, so it survives the isolate's restarts. Each isolate has one subscription per topic: subscribing again replaces the first. With the kernel's `dev: true`, the bus warns in the console when that happens.

### Handlers and commits

A subscription runs its handler for one record at a time, in order, and waits for an async handler to finish. A record is **settled** when its handler returns, and the client reports settled offsets to the bus together, at most once per commit interval. The interval is `bus.commitIntervalMs` in the kernel config: an integer from 0 to 1,000, default 100.

- **`autoCommit: false`** (`@experimental`) leaves settling to you: `ctx.bus.commit(record)` settles that record and every one delivered before it on the subscription.
- **A handler that throws** is reported to the host as a non-fatal error, and the subscription stops committing. It's redelivered from the failed record the next time it starts with `from: 'committed'`.
- **Credit:** the bus sends at most 1,000 records that haven't been settled. At that point it pauses the subscription, keeps only its position, and reads on from the log when settled records give credit back. A handler that never settles holds the subscription at that limit.

From the host, `kernel.subscribe(topic, fn, { from })` reads a topic on the main thread and `kernel.publish(topic, { key?, value })` writes to it. They take no consumer group and no commit options. `publish` takes an object with the payload under `value`, while `request` and `reply` (and `usePublish` in React and Preact) take the payload itself: `ctx.bus.publish(topic, { value: n })`, `ctx.bus.request(topic, n)`.

## Retention

A log can't grow without limit, so each topic says what it keeps. `retention` is required:

```ts
import { topic } from '@isoloop/bus';
import { z } from 'zod';

const price = z.object({ symbol: z.string(), last: z.number() });

export const prices = topic('markets.prices.v1', {
  schema: price,
  retention: { kind: 'last-n', n: 1_000 },
});

export const recent = topic('markets.recent.v1', {
  schema: price,
  retention: { kind: 'time', ms: 60_000 },
});

export const latestPrice = topic('markets.latest.v1', {
  schema: price,
  retention: { kind: 'compacted' },
});
```

- **`last-n`:** the newest `n` records. Older ones go as new ones arrive.
- **`time`:** records younger than `ms`, by their `ts`. The bus checks once a second, and removes records from the oldest end until it meets one that's young enough, so a record with an older `ts` behind a newer one stays until it reaches the end.
- **`compacted`:** the newest record for each key. A record that a later record with the same key replaces is removed, a while after it's replaced (the bus compacts once a second, and when half of a topic's records, at least 1,024, are replaced). **Records with no key are never removed.** Give every record on a compacted topic a key.

A subscription that falls behind retention, because its isolate was busy or suspended, skips what was removed. Its `onGap` handler gets `{ from, to }`, the offsets it missed. Compaction isn't a gap: a compacted topic leaves out replaced records without a report.

```ts
import { defineIsolate } from '@isoloop/runtime';
import { topic } from '@isoloop/bus';
import { z } from 'zod';

const latestPrice = topic('markets.latest.v1', {
  schema: z.object({ symbol: z.string(), last: z.number() }),
  retention: { kind: 'compacted' },
});

export default defineIsolate({
  start(ctx) {
    const bySymbol = new Map<string, number>();
    ctx.bus.subscribe(
      latestPrice,
      (r) => {
        bySymbol.set(r.value.symbol, r.value.last);
      },
      {
        from: 'earliest',
        onReset: () => bySymbol.clear(),
        onGap: (gap) => console.warn(`missed offsets ${gap.from} to ${gap.to}`),
      },
    );
  },
});
```

`onReset` is for a bus restart that loses a memory topic ([below](#when-the-bus-worker-crashes)). A request is a record too, so its topic's retention also limits how many requests can wait ([request and reply](#request-and-reply)).

## Durability

By default a topic's log lives in the bus worker's memory. Set `durability: 'persistent'` and the bus also writes it to the origin's private file system (OPFS), in append-only segment files.

```ts
import { topic } from '@isoloop/bus';
import { z } from 'zod';

export const cart = topic('cart.items.v1', {
  schema: z.object({ sku: z.string(), qty: z.number() }),
  retention: { kind: 'compacted' },
  durability: 'persistent',
});
```

| | `memory` (default) | `persistent` |
| --- | --- | --- |
| A bus worker crash | The log and committed offsets are lost | Kept |
| A page reload or a closed tab | Lost | Kept |
| A discarded tab | Lost | Kept |
| When `publish` resolves | At once | Once the record's batch is on disk (batches go out every 5 ms or 256 records) |
| What a value must be | Anything the schema produces and structured clone accepts | Data the bus's codec can write: no functions, DOM nodes or class instances, or `publish` rejects with `not_encodable` |

On disk, retention and compaction apply as in memory. A persistent topic keeps its recent records in memory, about 8 MiB, and reads older ones back from disk when a subscription needs them, so it can hold more than fits in memory. When the page freezes or goes away, the kernel asks the bus to write what it has pending at once ([hosting](hosting.md#persistent-topics-and-a-discarded-tab)).

What survives a reload: a persistent topic's records, and the committed offsets of every consumer of it, so a subscription with `from: 'committed'`, or a group that has committed, picks up where it left off. Isolates themselves are new instances, and memory topics start empty.

Persistent topics can run as memory topics. The kernel then emits `bus:durability_degraded` with a `reason`:

- **`another_tab`:** only one tab's bus holds the files, through the Web Lock `isoloop-bus`. Other tabs on the origin keep every topic in memory.
- **`no_sync_access`:** the browser has no OPFS sync access handles.
- **`open_failed`:** the files couldn't be opened, as in some private windows.

Storage is limited by the origin's quota. The kernel emits `bus:quota` once use reaches 80 %. At 100 %, publishes to persistent topics reject with `quota_exceeded`, and memory topics carry on.

A persistent topic that the contracts no longer list stays on disk, reported by `bus:orphaned_topics`, until `kernel.dropTopic(name)` deletes it.

## Consumer groups

Consumer groups are `@experimental` in 0.1: `group`, `autoCommit` and `ctx.bus.commit` may change before 1.0.

By default every subscribing isolate gets every record. Give subscriptions the same `group` and the topic's records are shared out: each goes to one member.

```ts
import { defineIsolate } from '@isoloop/runtime';
import { topic } from '@isoloop/bus';
import { z } from 'zod';

const orders = topic('shop.orders.v1', {
  schema: z.object({ id: z.string(), customer: z.string(), total: z.number() }),
  retention: { kind: 'time', ms: 3_600_000 },
  durability: 'persistent',
});

export default defineIsolate({
  start(ctx) {
    ctx.bus.subscribe(
      orders,
      async (r) => {
        await fetch(`/api/invoices/${r.value.id}`, {
          method: 'PUT',
          body: JSON.stringify(r.value),
        });
      },
      { group: 'billing', from: 'earliest' },
    );
  },
});
```

- **Key hashing:** a record goes to a member by a hash of its key, so the records of one key reach one member, in order. Records with no key go round-robin. The members are sorted by isolate id, so the same key reaches the same member while membership stays the same.
- **Order holds while membership is stable.** If a record's member has no credit left, the group waits for it instead of sending the record to another member. When a member joins or leaves, a key may move.
- **Offsets belong to the group**, kept as `group:<name>`. The group's offset moves only past records every member has settled.
- **A member that leaves** (it stops, crashes or unsubscribes) hands its unsettled records to the others, who get them before anything new. If it was the last member, the group's offset waits for the next one.
- **`from` applies only until the group first commits.** After that, a group resumes after its committed offset whatever `from` says, and a member joining a group that has members reads from where the group is. Group members don't need `from: 'committed'` to keep their place.

## Request and reply

Request and reply are `@experimental` in 0.1: `ctx.bus.request`, `ctx.bus.reply`, a topic's `reply` schema and `useRequest` may change before 1.0.

A topic with a `reply` schema can be requested. The requester sends a value and waits for one answer. The request is appended to the topic like a publish, with `req` set on the record; the reply goes straight back to the requester and isn't stored in a log.

```ts
import { BusError, defineIsolate } from '@isoloop/runtime';
import { quoteTool } from './contracts';

export default defineIsolate({
  async start(ctx) {
    try {
      const quote = await ctx.bus.request(quoteTool, { symbol: 'ACME' }, { timeoutMs: 5_000 });
      console.log(quote.vwap);
    } catch (err) {
      if (err instanceof BusError && err.code === 'timeout') console.warn('No answer in 5 s');
      else throw err;
    }
  },
});
```

The responder subscribes to the topic and answers each request record, which is the one with `req` set:

```ts
import { defineIsolate } from '@isoloop/runtime';
import { quoteTool } from './contracts';

export default defineIsolate({
  start(ctx) {
    const vwap = new Map<string, number>();
    ctx.bus.subscribe(quoteTool, async (r) => {
      if (r.req === undefined) return; // a plain record, not a request
      await ctx.bus.reply(r, { symbol: r.value.symbol, vwap: vwap.get(r.value.symbol) ?? null });
    });
  },
});
```

The rules:

- **The requester needs a publish grant, the responder a subscribe grant.** A topic without `reply` rejects the request with `not_requestable`.
- **The first valid reply wins.** The bus checks it against the `reply` schema. A later reply rejects with `already_replied`. A reply that fails the schema rejects for the responder with `invalid`, and the requester gets `reply_invalid` at once.
- **Only an isolate that was delivered the request may reply.** Others get `forbidden`. Several subscribers all see the request; use a group when only one should.
- **`timeout`:** a request waits `timeoutMs`, 30 s by default (`DEFAULT_REQUEST_TIMEOUT_MS`). The bus then forgets it, and a late reply gets `timeout`. A reply to a requester that has gone is dropped.
- **`dropped`:** a request is a record, so retention can remove it. When a burst of requests pushes older ones out of the log before the bus handed them to any subscriber, their requesters get `dropped` at once, rather than waiting for the timeout. A request already delivered is its responder's to answer. Size a requestable topic's `retention` for its largest burst.
- **A responder that restarts within the timeout** gets the request again when it subscribes with `from: 'committed'` or `earliest`, and can answer it.

From the host, `kernel.request` is the same call, with two more codes: `no_responder` at once when no isolate that could answer is alive, and `aborted` when its `signal` aborts. It's `@experimental`. See [tools for agents](agents.md#calling-from-the-host-kernelrequest).

## Handlers must be idempotent

Delivery is at least once. A record can reach a handler more than once, so a handler that has a side effect must be safe to run again on the same record. A handler that crashes after the side effect but before the record is settled runs again on the same record after the restart. Records come again when:

- **An isolate crashes or restarts.** Up to one commit interval of records it had already handled come again with `from: 'committed'`, because the last commit hadn't gone out.
- **A group member leaves.** Its unsettled records go to the others, some of which it may have handled.
- **The bus restarts.** A persistent topic redelivers up to one interval of records ([below](#when-the-bus-worker-crashes)).
- **A handler throws.** The record and those after it aren't committed, so they come again at the next start.

Make the effect idempotent: write to a place named by something in the record (an id in the value) instead of appending, and have the other side ignore an id it has seen. Don't rely on `offset` for that on a memory topic, because a bus restart starts it again from 0.

```ts
import { defineIsolate } from '@isoloop/runtime';
import { topic } from '@isoloop/bus';
import { z } from 'zod';

const payments = topic('shop.payments.v1', {
  schema: z.object({ id: z.string(), cents: z.number() }),
  retention: { kind: 'time', ms: 3_600_000 },
  durability: 'persistent',
});

export default defineIsolate({
  start(ctx) {
    ctx.bus.subscribe(
      payments,
      async (r) => {
        // PUT to a URL named by the payment's id: a second run changes nothing.
        await fetch(`/api/payments/${r.value.id}`, {
          method: 'PUT',
          body: JSON.stringify(r.value),
        });
      },
      { from: 'committed' },
    );
  },
});
```

Publishing has a second case: a persistent topic doesn't append a publish twice when the bus crashes before answering and the client sends it again, but if your own code retries after an error, that is a new record. Put an id in the value and have readers skip repeats.

## When the bus worker crashes

The kernel watches the bus worker with heartbeats, like an isolate. A worker error, or no beat for `heartbeat.killAfterMs` (10 s by default), ends it. The kernel starts a new one, up to 3 times in 60 s by default (`supervisor.maxRestarts` and `supervisor.withinMs`), and emits `bus:crash`, `bus:restart` and `bus:ready { first: false }` ([diagram: the crash and reattach](../diagrams/bus-crash-reattach.html)). Past the limit it emits `bus:failed`, isolates keep running, and every publish rejects with `bus_unavailable`.

Isolates keep running. Each one gets a new port to the new bus as soon as it boots, and its bus client:

1. **Re-sends its subscriptions.** A persistent topic resumes after the subscription's committed offset, whatever its `from`. A subscription that never committed starts at its `from`.
2. **Re-sends every publish and request the old bus never answered,** in order. While the new bus loads, it buffers what arrives. A persistent topic recognises a publish it already wrote and answers with the original offset, without appending it again. Past 1,000 unanswered calls, new ones reject with `bus_unavailable`.
3. **Drops the commits it hadn't sent.** A persistent topic redelivers up to one commit interval of records, as after a crash.

A **memory topic** is gone with the old bus. Each subscription to it gets `onReset`, then records from the new bus. Clear whatever you built from the topic there (`useTopic` in the React and Preact adapters does). An isolate that can't handle that sets `bus: { onReset: 'restart' }` in its manifest, and the kernel restarts it instead.

If the new bus crashes while it loads, or within 2 s of becoming ready, twice in a row, the next one starts in **safe mode**. For each persistent topic it sets the newest segment aside, renamed to `<segment>.quarantined` and never deleted, and starts from the one before. The kernel emits `bus:recovered` with the quarantined names.

## Limits

- **Consumer groups and request and reply are `@experimental` in 0.1.** They may change before 1.0.
- **At least once, not exactly once.** See [handlers must be idempotent](#handlers-must-be-idempotent).
- **One bus per tab.** Tabs don't share a bus, and only one tab's bus owns the files. Persistent topics in other tabs run in memory.
- **Memory topics are lost** on a reload, a discarded tab and a bus restart.
- **Retention drops records.** A subscription that falls behind, a request that waits too long, and a late reader all miss what retention removed. `onGap` reports it.
- **A compacted topic keeps keyless records forever.**
- **Order is per topic.** There's no order across topics. In a group, order holds per key while membership is stable.
- **One subscription per topic per isolate.** A second `subscribe` replaces the first; with `dev: true` the bus warns in the console.
- **Values are structured data.** Functions, DOM nodes and class instances don't cross the bus, and the size limit is a rough estimate.
- **A restart limit.** After 3 bus restarts in 60 s, the bus is down for good until the page reloads.
- **An isolate's own request doesn't check for a responder.** With nobody answering, it waits for its timeout. Only `kernel.request` fails at once with `no_responder`.

## See also

- [Hosting](hosting.md): the bus worker and contracts module URLs, and persistent topics on a discarded tab.
- [Tools for agents](agents.md): `kernel.request` and the retention a tool's topic needs.
- [The inspection feed](inspection.md): per-subscription lag and the records on a topic, live.
- [Worker pools](pools.md): how a pool's members resubscribe after a crash.
- [Contracts and grants](contracts.md): declaring topics, their schemas and who may publish.
