# Contracts and grants

How to define the topics your isolates share, with schemas the bus checks on every publish, and the grants that decide which isolate may use each topic.

## When to use it

Every app with a bus has one **contracts module**: the list of its topics, each with a name, a schema and a retention policy. Read this page before you write your first topic, and again before you change one, since a topic's name carries its version.

- **How records flow** (start positions, consumer groups, commits, replay after a restart) is the bus's side, not the contract's.
- **Exposing a topic to agents** builds on a request contract. The [agents guide](agents.md) covers the `tool` field and `agents.expose`.
- **The `inspect` grant** is covered in the [inspection guide](inspection.md).

## The contracts module

The module's default export is `contracts(...)`, called with every topic the app uses. Three parties read the same source:

- **The bus worker** imports the module from a URL and builds its topics from that list only.
- **The host** imports the list statically and passes it with the URL in `KernelConfig.contracts`.
- **Isolates** import the topic handles, for their types and to publish or subscribe.

```ts
// contracts.ts
import { contracts, topic } from '@isoloop/bus';
import { z } from 'zod';

export const cartItems = topic('cart.items.v1', {
  schema: z.object({
    sku: z.string(),
    qty: z.number().int().positive().default(1),
  }),
  retention: { kind: 'compacted' },
  durability: 'persistent',
});

export const prices = topic('catalog.prices.v1', {
  schema: z.object({ sku: z.string(), price: z.number() }),
  retention: { kind: 'last-n', n: 1000 },
});

export default contracts(cartItems, prices);
```

The host passes both halves. With `@isoloop/vite`, `?isolate` gives the module's URL as a separate bundle, which the bus worker can import (see [hosting](hosting.md)):

```ts
import { createKernel } from '@isoloop/host';
import list from './contracts';
import contractsUrl from './contracts?isolate';

const kernel = createKernel({ contracts: { url: contractsUrl, list }, workers });
```

`contracts` and `workers.bus` go together: `createKernel` throws when only one of them is set. Without either, there's no bus worker: isolates get a bus port that isn't connected, and `kernel.publish` rejects with `bus_unavailable`.

`contracts()` checks the list when the module loads, and throws a `ContractsError` whose `topics` names the topics at fault:

| Code | Cause |
| --- | --- |
| `reserved_topic` | A name starts with `isoloop.`. Those topics belong to the kernel. |
| `contracts_invalid` | Two topics share a name, a definition is malformed (no schema, a retention without its `n` or `ms`, a bad `tool`), or seeds form a cycle. |

## Defining a topic

`topic(name, options)` returns a frozen `TopicDef`, typed from its schemas; `AnyTopicDef` stands for any topic. The schema type is `StandardSchemaV1`, an interface Isoloop vendors.

| Option | Default | What it does |
| --- | --- | --- |
| `schema` | required | A [Standard Schema](https://standardschema.dev) V1: Zod 4, Valibot and ArkType all implement it. `unchecked<T>()` is the explicit opt-out. |
| `retention` | required | How much of the topic the bus keeps: `{ kind: 'last-n', n }`, `{ kind: 'time', ms }`, or `{ kind: 'compacted' }` (the latest record per key). |
| `durability` | `'memory'` | `'persistent'` keeps the topic in OPFS, so it survives a bus crash and a reload ([ADR 0007](../adr/0007-bus-worker-supervision.md)). Where OPFS isn't available, or another tab holds it, the topic behaves as `'memory'` and the kernel emits `bus:durability_degraded`. |
| `maxRecordBytes` | 256 KiB (`DEFAULT_MAX_RECORD_BYTES`) | A record over it rejects with `too_large`. |
| `reply` | none | A schema for replies, which makes the topic requestable ([below](#request-and-reply)). |
| `seed` | none | Starts the topic from an older one ([below](#versions-and-migrations)). |
| `tool` | none | Describes a requestable topic as a tool for agents (`@experimental`, [agents guide](agents.md)). |

Isoloop depends on no schema library. Any library that implements Standard Schema works, for example Valibot:

```ts
import { topic } from '@isoloop/bus';
import * as v from 'valibot';

export const prices = topic('catalog.prices.v1', {
  schema: v.object({ sku: v.string(), price: v.number() }),
  retention: { kind: 'last-n', n: 1000 },
});
```

### What the bus checks

- **Only the bus worker validates,** on every publish. Isolates and the host carry only the types, so their bundles don't include a schema library. A record the schema rejects fails the publish with `invalid`, and the error carries the schema's issues as `{ message, path }` objects.
- **The log stores the schema's output,** not what was published: defaults applied, coercions done. So publishers are typed with the schema's input and subscribers with its output.
- **Validation happens once.** Replayed records, records read by a late subscriber and records restored from OPFS aren't validated again.
- **Async schemas work.** The bus awaits them and still appends in publish order.
- **Unknown fields** follow the schema library's own rule. Zod strips them by default. Keep that default rather than strict mode, so a newer producer still passes an older contract.
- **The output must be plain, structured-cloneable data.** Persistent topics reject anything else with `not_encodable`. Memory topics are checked with `structuredClone` only when `KernelConfig.dev` is set.

`InputOf` and `OutputOf` give the two types:

```ts
import { topic, type InputOf, type OutputOf } from '@isoloop/bus';
import { z } from 'zod';

const cartItems = topic('cart.items.v1', {
  schema: z.object({ sku: z.string(), qty: z.number().int().positive().default(1) }),
  retention: { kind: 'compacted' },
});

type Published = InputOf<typeof cartItems>; // { sku: string; qty?: number | undefined }
type Delivered = OutputOf<typeof cartItems>; // { sku: string; qty: number }
```

### Opting out with `unchecked()`

`unchecked<T>()` is a schema that accepts any value unchanged and only carries the type. The bus doesn't check what's published. Tools list such topics, so none goes unvalidated by accident: `isoloop contracts export` exports it as `{}` with a warning, and a topic with an unchecked schema can't be exposed to agents (`not_exposable`).

```ts
import { topic, unchecked } from '@isoloop/bus';

type Sample = { name: string; value: number };

export const telemetry = topic('app.telemetry.v1', {
  schema: unchecked<Sample>(),
  retention: { kind: 'time', ms: 60_000 },
});
```

## Versions and migrations

**A topic's name carries its major version:** `cart.items.v1`. Within a version, a schema may only change compatibly, by adding optional fields. Old records are never validated again, so readers must cope with an optional field being missing. Anything else (removing or renaming a field, making one required, narrowing a type) is a new topic, `cart.items.v2`.

Deploy contracts before or together with their producers.

**A new version can start from the old one** with `seed`. On the first boot where v2 is empty and v1 has records, the bus copies each v1 record through `map` and v2's schema before v2 opens. Until then v2's publishes wait, and its subscribers get nothing, so history always comes before new records.

```ts
import { topic } from '@isoloop/bus';
import { z } from 'zod';

const cartItemsV1 = topic('cart.items.v1', {
  schema: z.object({ sku: z.string(), qty: z.number() }),
  retention: { kind: 'compacted' },
  durability: 'persistent',
});

// Renaming a field is a breaking change, so it's a new topic.
export const cartItemsV2 = topic('cart.items.v2', {
  schema: z.object({ sku: z.string(), quantity: z.number() }),
  retention: { kind: 'compacted' },
  durability: 'persistent',
  seed: { from: cartItemsV1, map: (v1) => ({ sku: v1.sku, quantity: v1.qty }) },
});
```

- **`map` is pure and synchronous.** A returned promise counts as a rejected record (`seed_async`).
- **Every record is copied once,** even across a crash: the bus records how far it got with each append.
- **A record that `map` throws on, or that v2's schema rejects,** is skipped and reported with `bus:seed_rejected`. When the seed finishes, the kernel emits `bus:seeded` with the counts copied and rejected.
- **`follow: true`** keeps mapping new v1 records into v2 for as long as the contracts list both topics, for a rollout where some producers still publish v1.
- **On a fresh install** there's nothing to copy, and the seed does nothing. Seeds chain: v3 can seed from v2.

The seed may read a v1 that the contracts no longer list: the bus keeps it on disk for the seed without opening it to isolates. At boot, persistent topics on disk that no contract lists are kept and reported with `bus:orphaned_topics`. Nothing is deleted on its own. `kernel.dropTopic(name)` deletes one, and rejects with `seed_pending` while a seed still reads from it.

A migration that `map` can't express (joining topics, calling a server) is a headless isolate that subscribes to v1 from `committed` and publishes to v2 ([ADR 0003](../adr/0003-schema-format-standard-schema.md), decision 20).

## Request and reply

A topic with a `reply` schema is **requestable**. The request is an ordinary record on the topic, and the reply goes straight back to the caller, outside the log. `ReplyInputOf` and `ReplyOutputOf` give the reply's two types.

```ts
import { defineIsolate } from '@isoloop/runtime';
import { quoteTool } from './contracts';

export default defineIsolate({
  async start(ctx) {
    const quote = await ctx.bus.request(quoteTool, { symbol: 'BTC' }, { timeoutMs: 5_000 });
    console.log(quote.vwap);
  },
});
```

The isolate that answers subscribes to the topic and replies to the records that carry `req`:

```ts
import { defineIsolate } from '@isoloop/runtime';
import { quoteTool } from './contracts';

const vwap = new Map<string, number>();

export default defineIsolate({
  start(ctx) {
    ctx.bus.subscribe(quoteTool, async (r) => {
      if (r.req === undefined) return; // a plain record, not a request
      await ctx.bus.reply(r, { symbol: r.value.symbol, vwap: vwap.get(r.value.symbol) ?? null });
    });
  },
});
```

| What happens | Result |
| --- | --- |
| `request` on a topic without `reply` | rejects with `not_requestable` |
| No reply within `timeoutMs` (default 30 s) | rejects with `timeout` |
| Retention removed the request before any subscriber got it | rejects with `dropped`, at once |
| The reply fails the `reply` schema | the responder's `reply` rejects with `invalid`, and the caller gets `reply_invalid` at once |
| A second valid reply | rejects with `already_replied`: the first one wins |
| An isolate that wasn't delivered the request replies | rejects with `forbidden` |

A request can reach several subscribers, and a crash after the side effect but before the reply delivers the record again. So a handler that changes anything should do it once per `r.req.id`.

## Grants

Each isolate gets its **grants** when it's spawned: the topics it may publish to and subscribe to. Without `grants` an isolate may do neither.

```ts
import cartUrl from './cart?isolate';

kernel.spawn({
  id: 'cart',
  src: cartUrl,
  surface: document.getElementById('cart')!,
  grants: {
    publish: ['cart.items.v1'],
    subscribe: ['cart.*', 'catalog.prices.v1'],
  },
});
```

- **Patterns:** without `*` a pattern matches one name exactly. `*` matches one or more characters, dots included, so `cart.*` covers `cart.items.v1` and `cart.*.v1` covers `cart.items.v1`.
- **The bus enforces them.** Publishing without a publish grant, or subscribing without a subscribe grant, rejects with `forbidden`.
- **A request is a publish,** so the caller needs a publish grant for the topic. The isolate that answers needs a subscribe grant.
- **`isoloop.*` topics** belong to the kernel. Isolates and host code can't publish to them (`forbidden`).
- **`navigate: true`** lets the isolate call `navigate()` ([ADR 0002](../adr/0002-host-owns-routing.md)). Default false.
- **`inspect: true`** gives the isolate the inspection feed and its controls (`@experimental`, [inspection guide](inspection.md)). Default false.
- **A pool's members share a worker,** so in effect the pool can do what any of its members may: the union of their grants. That's why an isolate holding `inspect` can't be pooled (`invalid_config`). See [pools](pools.md).

## What's checked at start

Contract problems fail at start, not at the first publish:

1. **`contracts()`,** when the module loads: reserved and duplicate names, malformed definitions, seed cycles.
2. **`createKernel`:** `contracts` without `workers.bus` or the reverse, and `agents.expose` patterns ([agents guide](agents.md)).
3. **The bus worker,** when it imports the module. The host sends the part of each topic that can be copied (name, retention, durability, size limit, whether it has `reply`, the seed's source and `follow`), and the bus compares it with the module it loaded:
   - `contracts_mismatch`: the host was built against different contracts than the URL serves;
   - `contracts_failed`: fetching or importing the module threw;
   - `contracts_invalid`: the module has no default export made by `contracts()`;
   - `reserved_topic`: the module defines an `isoloop.*` topic.

These failures are deterministic, so the bus isn't restarted. The kernel emits `bus:failed` with the code. Isolates already spawned fail with reason `bus_failed`, and later `spawn()` calls throw `bus_failed`.

Isolates don't wait for the contracts to load. The bus accepts their subscriptions at once and holds their publishes until the contracts are in, up to 1,000 per isolate's port, after which publishes reject with `bus_unavailable`.

## Exporting JSON Schema

`isoloop contracts export` writes JSON Schema (draft 2020-12) for every topic in a contracts module:

```sh
npx isoloop contracts export src/contracts.ts --out contracts.schema.json
```

- **The document** has a `target` and a `topics` map. Each topic has `schema`, or `input` and `output` when the two differ (Zod's output for an object adds `additionalProperties: false`), and likewise `reply`, or `replyInput` and `replyOutput`. A topic with a `tool` carries it too.
- **`unchecked()` schemas** export as `{}`, are listed under the topic's `unchecked`, and print a warning.
- **A schema that can't be converted** fails the command: every such topic is reported, nothing is written, and the exit code is 1.
- **It needs [Standard JSON Schema](https://standardschema.dev/json-schema)** (`~standard.jsonSchema`) on each schema, so there's no converter per library. Zod 4.2 and later have it.
- **The CLI imports the module with Node** (26 or later), so the module and what it imports must load there.

Commit the export and review its diff in CI: a change that isn't adding an optional field means a new topic version.

## Limits

- **No hot swap.** The contracts loaded at boot stay until the page reloads; a bus restart imports the same URL again.
- **Records are validated once, on publish.** A schema change doesn't re-check what's already in the log, which is why a version may only add optional fields.
- **Isoloop doesn't compare two versions of a schema for you.** Breaking changes are caught by reviewing the exported JSON Schema's diff.
- **A seed's `map` can't be async.** Use a migrator isolate for migrations that need I/O.
- **Grants are per isolate, and a pool merges its members' grants.** Grants keep isolates to their topics; they aren't a security boundary (see [What Isoloop can't hide](limits.md#not-a-security-boundary)).

## See also

- [Agents](agents.md): the `tool` field, `agents.expose` and `kernel.request`.
- [Inspection feed](inspection.md): the `inspect` grant.
- [Pools](pools.md): what sharing a worker does to grants.
- [Hosting](hosting.md): serving the contracts module and the workers.
- [ADR 0003](../adr/0003-schema-format-standard-schema.md): Standard Schema, the contracts module, versioning and seeding.
- [ADR 0018](../adr/0018-tools-for-agents.md): tools on contracts.
- [ADR 0007](../adr/0007-bus-worker-supervision.md): durability and bus restarts.
