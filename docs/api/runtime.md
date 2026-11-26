# @isoloop/runtime

The isolate side: `defineIsolate`, the context an isolate starts with, and `createTestContext` for tests.

## `@isoloop/runtime`

### `defineIsolate`

Types an isolate module's default export and stamps it with the version
it was built against.

```ts nocheck
function defineIsolate<Root = IsolateRoot>(def: IsolateDefinition<Root>): IsolateDefinition<Root>;
```

| Parameter | Description |
| --- | --- |
| `def` | The isolate: its `start(ctx)`. |

**Returns:** The definition, with `requires` set to this build's `major.minor`.

**Example:**

```ts
import { defineIsolate } from '@isoloop/runtime';
import { count } from './topics';

export default defineIsolate<HTMLElement>({
  start(ctx) {
    const button = document.createElement('button');
    button.textContent = 'Add one';
    button.addEventListener('click', () => void ctx.bus.publish(count, 1));
    ctx.root?.append(button);
  },
});
```

**Guides:** [Writing isolates](../guide/isolates.md).

### `BusError`

Also exported by `@isoloop/host`, which documents it: see [`BusError`](host.md#buserror).

### `HostCallError`

A host call (`ctx.host`) that failed, with an error code to branch on.

```ts nocheck
class HostCallError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string);
}
```

| Member | Description |
| --- | --- |
| `code` | What went wrong: `not_found`, `no_surface`, `forbidden`, `invalid`, `timeout`, … |

**Guides:** [What Isoloop can't hide](../guide/limits.md).

### `BusClient`

An isolate's side of the bus: `ctx.bus`, on its own port to the bus worker.

```ts nocheck
interface BusClient {
  publish<In>(topic: TopicRef<In, any, any, any>, value: In, opts?: {
    key?: string;
  }): Promise<void>;
  subscribe<Out>(topic: TopicRef<any, Out, any, any>, fn: (r: TypedRecord<Out>) => void | Promise<void>, opts?: SubscribeOptions): () => void;
  request<In, ROut>(topic: TopicRef<In, any, any, ROut>, value: In, opts?: RequestOptions): Promise<ROut>;
  reply(record: TypedRecord<unknown>, value: unknown): Promise<void>;
  commit(record: TypedRecord<unknown>): void;
}
```

| Member | Description |
| --- | --- |
| `publish()` | Appends a record to a topic: `publish(count, 1)`, or `publish(prices, 102, { key: 'AAPL' })` with a key. |
| `subscribe()` | Delivers a topic's records to `fn`, one at a time, in order: the next waits until `fn`'s promise settles. One subscription per topic: subscribing again replaces the last one. |
| `request()` | **Experimental.** Appends a request record to a topic with a `reply` schema and waits for the first valid reply. |
| `reply()` | **Experimental.** Answers a request record delivered to this isolate. |
| `commit()` | **Experimental.** Commits a record by hand, for `autoCommit: false`: that record and every one delivered before it on its subscription count as settled. |

**Guides:** [Writing isolates](../guide/isolates.md).

### `HostApi`

What `ctx.host` offers: calls the host runs on the main thread for the
isolate. Each runs after the DOM changes made before it, and rejects with a
`HostCallError`: `timeout` after 5 s without an answer, `not_found` for a
node that isn't rendered, `no_surface` in a headless isolate.

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
| `navigate()` | Asks the host to navigate. `/x` resolves against the host's `basePath`. |
| `measure()` | Measures a rendered node, after pending changes apply. |
| `focus()` | Focuses a rendered node on the page. |
| `scrollIntoView()` | Scrolls the page so a rendered node is in view. |
| `requestCanvas()` | Hands a rendered `<canvas>` to the isolate as an `OffscreenCanvas`. Draw on it from the worker. The element then gets `resize` events with its CSS `width` and `height`, the first at once. |

**Guides:** [What Isoloop can't hide](../guide/limits.md).

### `IsolateContext`

An isolate's whole world, as `start(ctx)` gets it.

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
| `id` | The isolate's id, from the manifest. |
| `config` | `manifest.config`, passed through. |
| `root` | The render target inside the surface; `undefined` for a headless isolate. |
| `portalRoot` | A container inside `root` for modals, tooltips, toasts and menus that libraries would otherwise render into `document.body`, which reaches no surface. Made on first use, typically from a component while it renders, and added as `root`'s last child once that render has committed; `undefined` for a headless isolate. |
| `host` | Calls the host runs on the main thread: navigate, measure, focus, scroll, hand over a canvas. |
| `bus` | The bus, on its own port to the bus worker. |
| `inspector` | **Experimental.** The inspection feed and its controls, on a port of its own to the host; `undefined` unless the isolate holds `inspect: true`. |
| `styles()` | Adds stylesheets to the surface; a no-op when headless. |
| `setValue()` | Sets an `<input>`'s, `<textarea>`'s or `<select>`'s value. The host owns a focused input's value, so a plain `input.value = …` waits until the user leaves it; with `force` the host applies it at once and keeps the caret at the end, for example to clear a chat box after sending. |
| `reportError()` | Reports an error as this isolate's own: framework adapters call it for a render error their boundary caught, so in a pool it crashes only this member, not the whole worker. |
| `onShutdown()` | Adds a handler that runs on stop, within the host's grace period (1 s), before the worker goes. |
| `keepAwake()` | Holds the isolate against suspension. Only matters for isolates spawned with `suspend`. |

**Guides:** [Writing isolates](../guide/isolates.md).

### `IsolateDefinition`

An isolate module's default export: what `defineIsolate` returns.

```ts nocheck
type IsolateDefinition<Root = IsolateRoot> = {
  start(ctx: IsolateContext<Root>): void | Promise<void>;
  requires?: string;
};
```

| Member | Description |
| --- | --- |
| `start()` | Runs once, when the isolate starts in its worker. A `start` that throws, or whose promise rejects, crashes the isolate. |
| `requires?` | The Isoloop `major.minor` it was built against, stamped by `defineIsolate`. The host fails an isolate built for a newer Isoloop, or for one older than it still runs; a definition without one isn't checked. |

**Guides:** [Writing isolates](../guide/isolates.md).

### `IsolateInspector`

**Experimental.**

The inspection feed and its controls, as an isolate with `inspect: true`
sees them: `ctx.inspector`, on a port of its own to the host. It's
`undefined` without the grant.

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
| `snapshot()` | The feed's state now. |
| `on()` | The host's feed messages from now on: events at once, beats and bus metrics about once a second. |
| `records()` | The last records of a topic still retained, oldest first, as previews. |
| `tap()` | Records appended to matching topics, as previews. Not a consumer: it isn't in the bus figures. |
| `restart()` | Restarts an isolate, as `kernel.restart(id)` does. |
| `kill()` | Ends an isolate's worker as a crash (`worker_error`), so the supervisor restarts it. For a pooled isolate that ends the pool's worker: every member crashes and restarts, and the feed shows each one. |
| `block()` | Busy-loops an isolate's worker. |

**Guides:** [The inspection feed](../guide/inspection.md).

### `IsolateRoot`

What a render root offers, structurally, so DOM-typed isolate code can pass
its own nodes. Each member works as the DOM's. Use
`defineIsolate<HTMLElement>(…)` to get the DOM's types instead.

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

`bus.request`'s options.

```ts nocheck
type RequestOptions = {
  key?: string;
  timeoutMs?: number;
};
```

| Field | Description |
| --- | --- |
| `key?` | The request record's key. Default: none. |
| `timeoutMs?` | How long to wait for a reply, in ms; the call then rejects with `BusError('timeout')`. Default 30 000 (30 s). |

**Guides:** [Writing isolates](../guide/isolates.md).

### `ScrollIntoViewOptionsLike`

`scrollIntoView`'s options, typed here since worker code has no DOM types.

```ts nocheck
type ScrollIntoViewOptionsLike = {
  behavior?: "auto" | "instant" | "smooth";
  block?: "start" | "center" | "end" | "nearest";
  inline?: "start" | "center" | "end" | "nearest";
};
```

| Field | Description |
| --- | --- |
| `behavior?` | Default `'auto'`. |
| `block?` | Default `'start'`. |
| `inline?` | Default `'nearest'`. |

**Guides:** [What Isoloop can't hide](../guide/limits.md).

### `SubscribeOptions`

`bus.subscribe`'s options.

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
| `from?` | Where to start. Default `latest`. With `group`, it applies only while the group has no committed offset: a group that has committed resumes after it, and a member joining a group that has members takes records from where the group is. |
| `group?` | **Experimental.** Share the topic with other subscribers of the same group: each record goes to one of them. Default: none. |
| `autoCommit?` | **Experimental.** Commit each record once its handler settles. Default true. |
| `onReset?` | A bus restart lost this memory topic. Clear what was built from it; records from the new bus follow. Default: none. |
| `onGap?` | Records in `[from, to]` were dropped by retention before they reached this subscription, for example while the isolate was suspended. Default: none. |

**Guides:** [Writing isolates](../guide/isolates.md).

## `@isoloop/runtime/testing`

### `createTestContext`

Makes an `IsolateContext` with no worker, bus or host behind it, for
testing an isolate or a component on a page. The test drives the bus
(`emit`, `reset`) and sees what the isolate did (`published`,
`subscriptions`, `errors`). `ctx.inspector` is `undefined`.

```ts nocheck
function createTestContext(o?: TestContextOptions): TestContext;
```

| Parameter | Description |
| --- | --- |
| `o` | The id, config, root, and how requests and host calls are answered. |

**Returns:** The context and its handles.

**Guides:** [Testing isolates and contracts](../guide/testing.md).

### `TestContext`

A context to test an isolate with, and the handles to drive it and see what it did.

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
| `ctx` | The context to pass to `start(ctx)`, or to render a component with. |
| `errors` | What `ctx.reportError` got, in order. |
| `emit` | Delivers a record to every subscription on `topic`, in order. |
| `reset` | Runs `onReset` of every subscription on `topic`, as when a bus restart loses a memory topic. |
| `published` | Every `publish`, in order. |
| `subscriptions` | Open subscriptions, by topic and start position. |
| `shutdown` | Runs the `onShutdown` handlers, as the runtime does on `stop`. `reason` defaults to `'stop'`. |

**Guides:** [Testing isolates and contracts](../guide/testing.md).

### `TestContextOptions`

`createTestContext`'s options.

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
| `id?` | `ctx.id`. Default `'test'`. |
| `config?` | `ctx.config`. Default `null`. |
| `root?` | The render root, for example an element on the test page. Default: none, a headless context. |
| `respond?` | Answers `bus.request`. Default: reject with `timeout` after the request's `timeoutMs`. |
| `host?` | Answers host calls. Default: `measure` gives a zero rect, the rest resolve. |

**Guides:** [Testing isolates and contracts](../guide/testing.md).

<!-- Generated by scripts/docs/api.ts from the published types. Do not edit: run `pnpm docs:api`. -->
