# @isoloop/preact

The Preact adapter: `defineIsolate` for a component, and hooks for the bus and the host.

## `@isoloop/preact`

### `defineIsolate`

Makes `Component` an isolate: the module's default export, which renders it into the
isolate's surface (with Preact) and unmounts it on shutdown, so effects clean up and
subscriptions end. Every hook in this package works inside it.

A render error is caught at the root and reported as this isolate's own crash, so in
a pool it fails only this member. The isolate needs a surface: started headless, it
throws an `Error` at start.

```ts nocheck
function defineIsolate(Component: ComponentType<IsolateProps>): IsolateDefinition;
```

| Parameter | Description |
| --- | --- |
| `Component` | The root component. It gets `IsolateProps`. |

**Returns:** The isolate definition, stamped with the runtime version it was built against.

**Example:**

```tsx
import { defineIsolate, usePublish, useTopic } from '@isoloop/preact';
import { count } from './topics';

function Counter() {
  const n = useTopic(count, { from: 'earliest' }) ?? 0;
  const publish = usePublish(count);
  return <button onClick={() => void publish(n + 1)}>Count: {n}</button>;
}

export default defineIsolate(Counter);
```

**Guides:** [Writing isolates](../guide/isolates.md).

### `useHost`

The isolate's host calls (`ctx.host`): `measure`, `focus`, `scrollIntoView` and
`navigate`. Pass them the elements a ref holds; the host acts on what it rendered for
them, after pending changes are applied.

```ts nocheck
function useHost(): HostApi$1;
```

**Returns:** The host API.

**Throws:**
- `Error` outside a component that `defineIsolate` rendered.

**Guides:** [Writing isolates](../guide/isolates.md).

### `useIsolate`

The isolate's context, as `start(ctx)` gets it: `ctx.bus`, `ctx.host`, `ctx.config` and
the rest.

```ts nocheck
function useIsolate(): IsolateContext$1;
```

**Returns:** The context of the isolate this component runs in.

**Throws:**
- `Error` outside a component that `defineIsolate` rendered.

**Guides:** [Writing isolates](../guide/isolates.md).

### `usePortalRoot`

The container inside this isolate's surface for modals, tooltips, toasts and menus
(`ctx.portalRoot`), for `createPortal` or a library's container option. Content
portalled there stays inside the isolate's surface.

```ts nocheck
function usePortalRoot(): Element;
```

**Returns:** The portal container.

**Throws:**
- `Error` in a headless isolate, or outside a component that `defineIsolate` rendered.

**Guides:** [Worker pools](../guide/pools.md).

### `usePublish`

A function that publishes to `topic`. The function is stable while `topic` is the same.

```ts nocheck
function usePublish<In>(topic: TopicRef<In, any, any, any>): (value: In, opts?: {
  key?: string;
}) => Promise<void>;
```

| Parameter | Description |
| --- | --- |
| `topic` | The topic to publish to. The isolate needs a publish grant for it. |

**Returns:** `(value, opts?) => Promise<void>`, with `opts.key` for the record's key. The
promise resolves once the bus has appended the record, and rejects with a `BusError`:
`forbidden` without a publish grant, `invalid` when the schema rejects the value
(`issues` says why), `too_large` over the topic's `maxRecordBytes`, `not_encodable`
for a value the bus can't store, `quota_exceeded` when storage is full,
`unknown_topic`, or `bus_unavailable`.

**Throws:**
- `Error` outside a component that `defineIsolate` rendered.

**Guides:** [Writing isolates](../guide/isolates.md).

### `useRequest`

**Experimental.**

A function that sends a request on `topic` and resolves with the first valid reply.
The function is stable while `topic` is the same.

```ts nocheck
function useRequest<In, ROut>(topic: TopicRef<In, any, any, ROut>): (value: In, opts?: RequestOptions$1) => Promise<ROut>;
```

| Parameter | Description |
| --- | --- |
| `topic` | A topic with a `reply` schema. |

**Returns:** `(value, opts?) => Promise<reply>`. `opts` takes `key` and `timeoutMs`
(default 30 s). The promise rejects with a `BusError`: `timeout` when no reply came
in time, `dropped` when retention removed the request before any subscriber got it,
`reply_invalid` when the reply failed the `reply` schema, `not_requestable` on a
topic without one, and the publish codes (`forbidden`, `invalid`, `too_large`,
`unknown_topic`, `bus_unavailable`) for the request itself.

**Guides:** [Writing isolates](../guide/isolates.md).

### `useRoute`

The host's current location. The route is read only while a component uses this hook.

```ts nocheck
function useRoute(): RouteValue$1 | undefined;
```

**Returns:** The current route, or `undefined` until the first one arrives, and always
with routing off.

**Throws:**
- `Error` outside a component that `defineIsolate` rendered.

**Guides:** [Writing isolates](../guide/isolates.md).

### `useTopic`

The latest value on `topic`. It subscribes on mount and unsubscribes on unmount;
a different `topic` or `from` subscribes again.

```ts nocheck
function useTopic<Out>(topic: TopicRef<any, Out, any, any>, opts?: UseTopicOptions): Out | undefined;
```

| Parameter | Description |
| --- | --- |
| `topic` | The topic to read. The isolate needs a subscribe grant for it. |
| `opts` | Where reading starts (`UseTopicOptions`). |

**Returns:** The latest value, or `undefined` until one arrives. A bus restart that lost a
memory topic clears it back to `undefined`.

**Throws:**
- `Error` outside a component that `defineIsolate` rendered.

**Guides:** [Writing isolates](../guide/isolates.md).

### `BusError`

Re-exported from `@isoloop/host`: see [`BusError`](host.md#buserror).

### `HostCallError`

Re-exported from `@isoloop/runtime`: see [`HostCallError`](runtime.md#hostcallerror).

### `HostApi`

Re-exported from `@isoloop/runtime`: see [`HostApi`](runtime.md#hostapi).

### `IsolateContext`

Re-exported from `@isoloop/runtime`: see [`IsolateContext`](runtime.md#isolatecontext).

### `IsolateProps`

The props `defineIsolate` passes to the isolate's component.

```ts nocheck
type IsolateProps = {
  config: unknown;
};
```

| Field | Description |
| --- | --- |
| `config` | The `config` the isolate was spawned with (`manifest.config`), passed through unchanged; `undefined` when it has none. |

**Guides:** [Writing isolates](../guide/isolates.md).

### `RequestOptions`

Re-exported from `@isoloop/runtime`: see [`RequestOptions`](runtime.md#requestoptions).

### `RouteValue`

Re-exported from `@isoloop/react`: see [`RouteValue`](react.md#routevalue).

### `UseTopicOptions`

Options for `useTopic`.

```ts nocheck
type UseTopicOptions = {
  from?: StartPosition;
};
```

| Field | Description |
| --- | --- |
| `from?` | Where reading starts. Default `'latest'`: only records appended from now. `'earliest'` replays the topic, so a compacted one gives its current value at once. |

**Guides:** [Writing isolates](../guide/isolates.md).

<!-- Generated by scripts/docs/api.ts from the published types. Do not edit: run `pnpm docs:api`. -->
