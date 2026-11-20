# @isoloop/runtime

The isolate side: `defineIsolate`, the context an isolate starts with, and `createTestContext` for tests.

## `@isoloop/runtime`

### `defineIsolate`

Types an isolate module's default export and stamps it with the version
it was built against. `Root` defaults to the structural `IsolateRoot`.

```ts nocheck
function defineIsolate<Root = IsolateRoot>(def: IsolateDefinition<Root>): IsolateDefinition<Root>;
```

**Guides:** [Writing isolates](../guide/isolates.md).

### `BusError`

Re-exported from `@isoloop/host`: see [`BusError`](host.md#buserror).

### `HostCallError`

A host call that failed, with the protocol's error code.

```ts nocheck
class HostCallError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string);
}
```

**Guides:** [What Isoloop can't hide](../guide/limits.md).

### `BusClient`

```ts nocheck
interface BusClient {
  publish<In>(topic: TopicRef<In, any, any, any>, rec: {
    key?: string;
    value: In;
  }): Promise<void>;
  subscribe<Out>(topic: TopicRef<any, Out, any, any>, fn: (r: TypedRecord<Out>) => void | Promise<void>, opts?: SubscribeOptions): () => void;
  request<In, ROut>(topic: TopicRef<In, any, any, ROut>, value: In, opts?: RequestOptions): Promise<ROut>;
  reply(record: TypedRecord<unknown>, value: unknown): Promise<void>;
  commit(record: TypedRecord<unknown>): void;
}
```

| Member | Description |
| --- | --- |
| `publish()` | Resolves once the broker appended the record; rejects with a `BusError`. |
| `subscribe()` | Returns the unsubscribe function. |
| `request()` | **Experimental.** Topics with a `reply` schema only. Rejects with `timeout` after `timeoutMs` (default 30 s), or with `dropped` at once when the topic's retention removed the request before the bus delivered it to any subscriber. |
| `reply()` | **Experimental.** Answers a request record delivered to this isolate; the broker checks `value` against the topic's `reply` schema. |
| `commit()` | **Experimental.** Commits a record by hand, for `autoCommit: false`: that record and every one delivered before it on its subscription count as settled. |

**Guides:** [Writing isolates](../guide/isolates.md).

### `HostApi`

What `ctx.host` offers (design §4.7).

```ts nocheck
type HostApi = {
  navigate(href: string, o?: {
    replace?: boolean;
    state?: unknown;
  }): Promise<boolean>;
  measure(node: unknown): Promise<Rect>;
  focus(node: unknown): Promise<void>;
  scrollIntoView(node: unknown, opts?: ScrollIntoViewOptionsLike): Promise<void>;
  requestCanvas(node: unknown, size?: {
    width?: number;
    height?: number;
  }): Promise<OffscreenCanvas>;
};
```

| Member | Description |
| --- | --- |
| `navigate()` | Asks the host to navigate (ADR 0002). Needs `grants.navigate`, else `forbidden`. `/x` resolves against the host's `basePath`. Resolves with the host's answer: `true` accepted, `false` refused. |
| `measure()` | The node's box relative to the surface, after pending patches apply. |
| `requestCanvas()` | Hands a rendered `<canvas>` to the isolate as an `OffscreenCanvas` (design §4.7), at `size` in canvas pixels if given. Draw on it from the worker. The element then gets `resize` events with its CSS `width` and `height`, the first at once. Each canvas goes once; a second request rejects with `invalid`, a headless isolate's with `no_surface`. |

**Guides:** [What Isoloop can't hide](../guide/limits.md).

### `IsolateContext`

```ts nocheck
type IsolateContext<Root = IsolateRoot> = {
  readonly id: string;
  readonly config: unknown;
  readonly root: Root | undefined;
  readonly portalRoot: Root | undefined;
  readonly host: HostApi;
  readonly bus: BusClient;
  readonly inspector: IsolateInspector | undefined;
  styles(css: string | readonly string[]): void;
  setValue(node: unknown, value: string, opts?: {
    force?: boolean;
  }): void;
  reportError(error: unknown, opts?: {
    fatal?: boolean;
  }): void;
  onShutdown(fn: (reason: ShutdownReason) => void | Promise<void>): void;
  keepAwake(): () => void;
};
```

| Member | Description |
| --- | --- |
| `config` | `manifest.config`, passed through. |
| `root` | The render target; `undefined` for a headless isolate (ADR 0008). |
| `portalRoot` | A container inside `root` for modals, tooltips, toasts and menus that libraries would otherwise render into `document.body`, which reaches no surface (ADR 0015, decision 11). Made on first use, typically from a component while it renders, and added as `root`'s last child once that render has committed; `undefined` for a headless isolate. |
| `bus` | The log bus, on its own port to the bus worker (design §5). |
| `inspector` | **Experimental.** The inspection feed and its controls (ADR 0020, decision 6), on a port of its own to the host; `undefined` unless the isolate holds `inspect: true`. |
| `styles()` | Adds stylesheets to the surface (design §4.8); a no-op when headless. |
| `setValue()` | Sets an `<input>`'s, `<textarea>`'s or `<select>`'s value. The host owns a focused input's value (design §4.6), so a plain `input.value = …` waits until the user leaves it; with `force` the host applies it at once and keeps the caret at the end, e.g. to clear a chat box after sending. |
| `reportError()` | Reports an error as this isolate's own: framework adapters call it for a render error their boundary caught, so in a pool it crashes only this member, not the whole worker (ADR 0015, decision 8). `fatal` (the default) crashes the isolate, which the host restarts as usual. |
| `onShutdown()` | Runs on stop, within the host's grace period, before the worker goes. |
| `keepAwake()` | Holds the isolate against suspension (ADR 0001); call the result to release. Only matters for isolates spawned with `suspend`. |

**Guides:** [Writing isolates](../guide/isolates.md).

### `IsolateDefinition`

```ts nocheck
type IsolateDefinition<Root = IsolateRoot> = {
  start(ctx: IsolateContext<Root>): void | Promise<void>;
  requires?: string;
};
```

| Field | Description |
| --- | --- |
| `requires?` | The Isoloop `major.minor` it was built against, stamped by `defineIsolate` (ADR 0012). The host fails an isolate outside its `[FLOOR, VERSION]`; a definition without one isn't checked. |

**Guides:** [Writing isolates](../guide/isolates.md).

### `IsolateInspector`

**Experimental.**

The inspection feed and its controls, as an isolate with `inspect: true`
sees them (ADR 0020, decision 6). `ctx.inspector` is `undefined` without
the grant.

```ts nocheck
type IsolateInspector = {
  snapshot(): Promise<InspectSnapshot>;
  on(fn: (m: InspectMessage) => void): () => void;
  records(topic: string, o: {
    last: number;
  }): Promise<InspectRecord[]>;
  tap(o: {
    topics: string[];
    maxPerSec?: number;
    onSkipped?: (count: number) => void;
  }, fn: (r: InspectRecord) => void): () => void;
  restart(id: string): Promise<void>;
  kill(id: string): Promise<void>;
  block(id: string, ms: number): Promise<void>;
};
```

| Member | Description |
| --- | --- |
| `snapshot()` | Isolates, pools, the bus, and the last 200 events. Once the port has ended it resolves with the last snapshot it got, if any. |
| `on()` | The host's feed messages from now on: events at once, beats and bus metrics about once a second. Returns the function that stops them. |
| `records()` | The last `last` retained records of `topic` (at most 100), oldest first, as previews. |
| `tap()` | Records appended to matching topics, at most `maxPerSec` a second (default 50), as previews. Not a consumer: it isn't in the bus figures. `onSkipped` gets each count of records left out over the cap, at most once a second (ADR 0020, decision 6, amended 2026-11-19). Returns the function that ends it. |
| `restart()` | Restarts an isolate, as `kernel.restart(id)` does. Like `kill` and `block`, it rejects for an unknown id, and once the port has ended. |
| `kill()` | Ends an isolate's worker as a crash (`worker_error`), so the supervisor restarts it. For a pooled isolate that ends the pool's worker: every member crashes and restarts, and the feed shows each one. Resolves once the kill is sent, not when the isolate is back. |
| `block()` | Busy-loops an isolate's worker for `ms`, at most 10 s. |

**Guides:** [The inspection feed](../guide/inspection.md).

### `IsolateRoot`

What a render root offers, structurally, so DOM-typed isolate code can pass
its own nodes. Use `defineIsolate<HTMLElement>(…)` to get the DOM's types.

```ts nocheck
interface IsolateRoot {
  append(...nodes: (object | string)[]): void;
  replaceChildren(...nodes: (object | string)[]): void;
  appendChild<T extends object>(node: T): T;
  insertBefore<T extends object>(node: T, ref: object | null): T;
  removeChild<T extends object>(node: T): T;
  readonly childNodes: ArrayLike<object>;
  textContent: string | null;
  addEventListener(type: string, fn: (event: never) => void, options?: unknown): void;
}
```

**Guides:** [Writing isolates](../guide/isolates.md).

### `RequestOptions`

**Experimental.**

`request`'s options.

```ts nocheck
type RequestOptions = {
  key?: string;
  timeoutMs?: number;
};
```

| Field | Description |
| --- | --- |
| `key?` | The request record's key. |
| `timeoutMs?` | Default 30 s: the call rejects with `BusError('timeout')` after it. |

**Guides:** [Writing isolates](../guide/isolates.md).

### `ScrollIntoViewOptionsLike`

```ts nocheck
type ScrollIntoViewOptionsLike = {
  behavior?: "auto" | "instant" | "smooth";
  block?: "start" | "center" | "end" | "nearest";
  inline?: "start" | "center" | "end" | "nearest";
};
```

**Guides:** [What Isoloop can't hide](../guide/limits.md).

### `SubscribeOptions`

```ts nocheck
type SubscribeOptions = {
  from?: StartPosition;
  group?: string;
  autoCommit?: boolean;
  onReset?: () => void;
  onGap?: (gap: {
    from: number;
    to: number;
  }) => void;
};
```

| Field | Description |
| --- | --- |
| `from?` | Default `latest`. With `group`, it applies only while the group has no committed offset: a group that has committed resumes after it, and a member joining a group that has members takes records from where the group is (ADR 0016, point 14). |
| `group?` | **Experimental.** Share the topic with other subscribers of the same group: each record goes to one of them. |
| `autoCommit?` | **Experimental.** Default true: commit each record once its handler settles. |
| `onReset?` | A bus restart lost this memory topic (ADR 0007). Clear what was built from it; records from the new bus follow. |
| `onGap?` | Records in `[from, to]` were dropped by retention before they reached this subscription (design §6.3), e.g. while the isolate was suspended. |

**Guides:** [Writing isolates](../guide/isolates.md).

## `@isoloop/runtime/testing`

### `createTestContext`

```ts nocheck
function createTestContext(o?: TestContextOptions): TestContext;
```

**Guides:** [Testing isolates and contracts](../guide/testing.md).

### `TestContext`

```ts nocheck
type TestContext = {
  readonly ctx: IsolateContext;
  readonly errors: {
    error: unknown;
    fatal: boolean;
  }[];
  emit: (topic: string, value: unknown, key?: string) => void;
  reset: (topic: string) => void;
  readonly published: {
    topic: string;
    key?: string;
    value: unknown;
  }[];
  subscriptions: () => {
    topic: string;
    from: string;
  }[];
  shutdown: (reason?: ShutdownReason) => Promise<void>;
};
```

| Field | Description |
| --- | --- |
| `errors` | What `ctx.reportError` got, in order. |
| `emit` | Delivers a record to every subscription on `topic`, in order. |
| `reset` | Runs `onReset` of every subscription on `topic` (a bus restart lost it, ADR 0007). |
| `published` | Every `publish`, in order. |
| `subscriptions` | Open subscriptions, by topic and start position. |
| `shutdown` | Runs the `onShutdown` handlers, as the runtime does on `stop`. |

**Guides:** [Testing isolates and contracts](../guide/testing.md).

### `TestContextOptions`

```ts nocheck
type TestContextOptions = {
  id?: string;
  config?: unknown;
  root?: object;
  respond?: (topic: string, value: unknown) => unknown;
  host?: Partial<HostApi>;
};
```

| Field | Description |
| --- | --- |
| `root?` | The render root, e.g. an element on the test page; omit for a headless context. |
| `respond?` | Answers `bus.request`; default: reject with `timeout` after the request's `timeoutMs`. |
| `host?` | Answers host calls; default: `measure` gives a zero rect, the rest resolve. |

**Guides:** [Testing isolates and contracts](../guide/testing.md).

<!-- Generated by scripts/docs/api.ts from the published types. Do not edit: run `pnpm docs:api`. -->
