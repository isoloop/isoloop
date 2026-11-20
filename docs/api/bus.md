# @isoloop/bus

Topics and contracts: `topic`, `contracts`, the bus errors and limits, and `testContracts` for tests.

## `@isoloop/bus`

### `contracts`

Builds the contracts list. Rejects duplicate names and `isoloop.*` topics,
which belong to the kernel (ADR 0003, decisions 4 and 6).

```ts nocheck
function contracts(...topics: AnyTopicDef[]): Contracts;
```

**Guides:** [Contracts and grants](../guide/contracts.md).

### `topic`

Defines a topic. Types come from the schemas.

```ts nocheck
function topic<In, Out = In, RIn = never, ROut = RIn>(name: string, def: Omit<TopicDef<In, Out, RIn, ROut>, "name">): TopicDef<In, Out, RIn, ROut>;
```

**Guides:** [Contracts and grants](../guide/contracts.md).

### `unchecked`

A Standard Schema that accepts any value unchanged and only carries the type
(ADR 0003, decision 2). Tools list topics that use it.

```ts nocheck
function unchecked<T>(): StandardSchemaV1<T, T>;
```

**Guides:** [Contracts and grants](../guide/contracts.md).

### `ContractsError`

A contracts list that can't be built: duplicate or reserved names, or a bad definition.

```ts nocheck
class ContractsError extends Error {
  readonly code: ErrorCode;
  readonly topics: readonly string[];
  constructor(code: ErrorCode, message: string, topics: readonly string[]);
}
```

| Member | Description |
| --- | --- |
| `topics` | The topics at fault. |

**Guides:** [Contracts and grants](../guide/contracts.md).

### `DEFAULT_MAX_RECORD_BYTES`

Default `maxRecordBytes`: 256 KiB (design §6.1).

```ts nocheck
const DEFAULT_MAX_RECORD_BYTES: number;
```

**Guides:** [Contracts and grants](../guide/contracts.md).

### `DEFAULT_REQUEST_TIMEOUT_MS`

Requests are forgotten after this long when the caller gives no timeout.

```ts nocheck
const DEFAULT_REQUEST_TIMEOUT_MS = 3e4;
```

**Guides:** [The bus](../guide/bus.md).

### `HOST_PRODUCER`

Producer id for records the host publishes through `kernel.publish`.

```ts nocheck
const HOST_PRODUCER = "host";
```

**Guides:** [The bus](../guide/bus.md).

### `KERNEL_PRODUCER`

Producer id for records the kernel publishes to system topics.

```ts nocheck
const KERNEL_PRODUCER = "kernel";
```

**Guides:** [The bus](../guide/bus.md).

### `AnyTopicDef`

```ts nocheck
type AnyTopicDef = TopicDef<any, any, any, any>;
```

**Guides:** [Contracts and grants](../guide/contracts.md).

### `Contracts`

The default export of a contracts module (ADR 0003, decision 4). Built only
by `contracts()`, so the bus worker can tell it from any other export.

```ts nocheck
type Contracts = {
  readonly "~isoloop": "contracts";
  readonly topics: readonly AnyTopicDef[];
  get(name: string): AnyTopicDef | undefined;
};
```

| Member | Description |
| --- | --- |
| `~isoloop` | Brand, so the bus worker can tell a contracts list from any other export. |
| `get()` | Looks a topic up by name. |

**Guides:** [Contracts and grants](../guide/contracts.md).

### `InputOf`

What a publisher passes.

```ts nocheck
type InputOf<D> = D extends TopicDef<infer In, any, any, any> ? In : never;
```

**Guides:** [Contracts and grants](../guide/contracts.md).

### `OutputOf`

What a subscriber receives.

```ts nocheck
type OutputOf<D> = D extends TopicDef<any, infer Out, any, any> ? Out : never;
```

**Guides:** [Contracts and grants](../guide/contracts.md).

### `ReplyInputOf`

What a responder passes to `reply`.

```ts nocheck
type ReplyInputOf<D> = D extends TopicDef<any, any, infer RIn, any> ? RIn : never;
```

**Guides:** [Contracts and grants](../guide/contracts.md).

### `ReplyOutputOf`

What a requester receives.

```ts nocheck
type ReplyOutputOf<D> = D extends TopicDef<any, any, any, infer ROut> ? ROut : never;
```

**Guides:** [Contracts and grants](../guide/contracts.md).

### `Retention`

```ts nocheck
type Retention = {
  kind: "last-n";
  n: number;
} | {
  kind: "time";
  ms: number;
} | {
  kind: "compacted";
};
```

**Guides:** [The bus](../guide/bus.md).

### `StandardSchemaV1`

The Standard Schema V1 interface (https://standardschema.dev), vendored so
the bus depends on no schema library (ADR 0003, decision 1). Zod 4, Valibot
and ArkType implement it. Copied from the spec; keep it in step with it.

```ts nocheck
interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}
namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }
  export type Result<Output> = SuccessResult<Output> | FailureResult;
  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }
  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }
  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }
  export interface PathSegment {
    readonly key: PropertyKey;
  }
  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }
  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["input"];
  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["output"];
}
```

**Guides:** [Contracts and grants](../guide/contracts.md).

### `ToolSpec`

**Experimental.**

Describes a requestable topic as a tool for agents (ADR 0018, decision 1).
A `tool` field alone exposes nothing: the app's kernel config lists what
agents may call (`agents.expose`). It stays on the host and isn't part of
the `TopicConfig` the bus sees.

```ts nocheck
type ToolSpec = {
  readonly title?: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly consequential?: boolean;
  readonly untrustedContent?: boolean;
};
```

| Field | Description |
| --- | --- |
| `title?` | A short human-readable name. The tool's name is always the topic's name. |
| `description` | What the tool does, for the agent choosing it. |
| `readOnly` | Required: `true` if a call changes nothing. Maps to `readOnlyHint` in WebMCP and MCP. |
| `consequential?` | The call has effects the user should confirm. WebMCP `consequentialHint`, MCP `destructiveHint`. Default `false`. |
| `untrustedContent?` | The reply can carry third-party text. WebMCP `untrustedContentHint`. Default `false`. |

**Guides:** [Tools for agents](../guide/agents.md).

### `TopicDef`

A topic: its name, schema and log policy (design §6.1). Publishers are typed
with `In`, subscribers with `Out`, because the log stores the schema's
validated output (ADR 0003, decision 11). `RIn`/`ROut` type `bus.request`
replies; a topic without `reply` can't be requested.

```ts nocheck
type TopicDef<In, Out = In, RIn = never, ROut = RIn> = {
  readonly name: string;
  readonly schema: StandardSchemaV1<In, Out>;
  readonly reply?: StandardSchemaV1<RIn, ROut>;
  readonly retention: Retention$1;
  readonly maxRecordBytes?: number;
  readonly durability?: "memory" | "persistent";
  readonly seed?: {
    readonly from: AnyTopicDef;
    readonly map: (value: any, record: BusRecord) => In;
    readonly follow?: boolean;
  };
  readonly tool?: [RIn] extends [never] ? never : ToolSpec$1;
};
```

| Member | Description |
| --- | --- |
| `name` | Carries the major version, e.g. `cart.items.v1` (ADR 0003, decision 17). |
| `schema` | Required. `unchecked<T>()` is the explicit opt-out. |
| `reply?` | **Experimental.** Required for `bus.request`. |
| `maxRecordBytes?` | Rough structured size limit per record. Default 256 KiB. |
| `durability?` | Default `memory`. `persistent` keeps the topic in OPFS (ADR 0007): it survives a bus crash and a reload. Where OPFS isn't available, or another tab holds it, it behaves as `memory` and the kernel emits `bus:durability_degraded`. |
| `seed?` | Starts this topic from an older one (ADR 0003, decision 18). On the first boot where this topic is empty and `from` has records, the bus copies them through `map` and this topic's schema before it opens: its publishes wait and its subscribers get nothing until then. `map` must be pure and synchronous. `follow` keeps mapping new `from` records afterwards. |
| `tool?` | **Experimental.** Describes this topic as a tool for agents (ADR 0018, decision 1). Only a topic with `reply` can have one: without it this field's type is `never`. It exposes nothing by itself; the app's `agents.expose` does. The bus never sees it (not part of `topicConfig`). |

**Guides:** [Contracts and grants](../guide/contracts.md).

## `@isoloop/bus/testing`

### `testContracts`

Runs sample values through every schema in a contracts list and reports
samples the schema rejects and outputs that aren't plain, cloneable data
(ADR 0003, decision 11). The broker only checks cloneability in dev builds,
so run this in the contracts package's tests. An empty result means all good.

```ts nocheck
function testContracts(list: Contracts, samples: Readonly<Record<string, TopicSamples>>): Promise<ContractProblem[]>;
```

**Guides:** [Testing isolates and contracts](../guide/testing.md).

### `ContractProblem`

```ts nocheck
type ContractProblem = {
  topic: string;
  schema: "value" | "reply";
  sample: number;
  kind: "invalid" | "not_plain" | "no_samples";
  message: string;
  issues?: Issue[];
};
```

| Field | Description |
| --- | --- |
| `schema` | `value` for the topic schema, `reply` for its reply schema. |
| `sample` | Index of the sample, or -1 for `no_samples`. |
| `kind` | `invalid`: the schema rejected the sample. `not_plain`: its output isn't plain, structured-cloneable data. `no_samples`: the topic has none. |

**Guides:** [Testing isolates and contracts](../guide/testing.md).

### `TopicSamples`

Sample values for one topic. An array is shorthand for `{ values }`.

```ts nocheck
type TopicSamples = readonly unknown[] | {
  values: readonly unknown[];
  replies?: readonly unknown[];
};
```

**Guides:** [Testing isolates and contracts](../guide/testing.md).

<!-- Generated by scripts/docs/api.ts from the published types. Do not edit: run `pnpm docs:api`. -->
