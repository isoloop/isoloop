# @isoloop/react

The React adapter: `defineIsolate` for a component, and hooks for the bus and the host.

## `@isoloop/react`

### `defineIsolate`

Makes `Component` an isolate: the module's default export, which renders it into the
isolate's surface (with `createRoot`) and unmounts the root on shutdown, so effects clean up and
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
import { defineIsolate, usePublish, useTopic } from '@isoloop/react';
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

The isolate's host calls (`ctx.host`): `measure`, `focus`, `scrollIntoView`, `navigate`
and `requestCanvas`. Pass them the elements a ref holds; the host acts on what it
rendered for them, after pending changes are applied.

```ts nocheck
function useHost(): HostApi;
```

**Returns:** The host API.

**Throws:**
- `Error` outside a component that `defineIsolate` rendered.

**Guides:** [Writing isolates](../guide/isolates.md).

### `useIsolate`

The isolate's context, as `start(ctx)` gets it: `ctx.bus`, `ctx.host`, `ctx.config` and
the rest.

```ts nocheck
function useIsolate(): IsolateContext;
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
function useRequest<In, ROut>(topic: TopicRef<In, any, any, ROut>): (value: In, opts?: RequestOptions) => Promise<ROut>;
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
function useRoute(): RouteValue | undefined;
```

**Returns:** The current route, or `undefined` until the first one arrives, and always
with routing off.

**Throws:**
- `Error` outside a component that `defineIsolate` rendered.

**Guides:** [Writing isolates](../guide/isolates.md).

### `useTopic`

The latest value on `topic`, read through `useSyncExternalStore`, so concurrent renders
never tear. The subscription lives while the component is mounted; StrictMode's extra
subscribe and unsubscribe leave one.

Any number of components can read the same topic. Every `useTopic` on a topic in one
isolate shares one bus subscription: the first to mount subscribes, the last to unmount
unsubscribes, and each gets the same latest value, so one that mounts later sees the
current value at once. The first one's `from` sets where the shared subscription starts; a
later `useTopic` with a different `from` gets the shared value and a console warning.

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

### `useWatch`

**Experimental.**

A watcher skips values; use `useTopic` or `subscribe` to get every record.

The current value per key of `topic`, as a map from key to value. Records with no key
share the key `null`. It starts with the newest retained value of each key, then follows
the keys that change; when several values arrive for a key between two renders, only the
newest is shown. A key leaves the map when retention removes its newest record. Treat the
map and its values as read-only.

Any number of components can watch the same topic, and one that mounts later shows the
current map at once. The bus sends the next view only once the render showing this one
has committed, so a component never gets values faster than it draws them. StrictMode's
extra mount leaves one watch.

```ts nocheck
function useWatch<Out>(topic: TopicRef<any, Out, any, any>): ReadonlyMap<string | null, Out>;
function useWatch<Out>(topic: TopicRef<any, Out, any, any>, opts: UseWatchOptions): Out | undefined;
```

| Parameter | Description |
| --- | --- |
| `topic` | The topic to watch. The isolate needs a subscribe grant for it. |

**Returns:** The current value per key: empty until the first view arrives. A bus restart
that lost a memory topic empties it.

**Throws:**
- `Error` outside a component that `defineIsolate` rendered.

### `BusError`

Also exported by `@isoloop/host`, which documents it: see [`BusError`](host.md#buserror).

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

The host page's current location, as the kernel publishes it on each navigation.

```ts nocheck
type RouteValue = {
  href: string;
  pathname: string;
  path: string | null;
  search: string;
  hash: string;
  state: unknown;
};
```

| Field | Description |
| --- | --- |
| `href` | The absolute URL. |
| `pathname` | The URL's path, as `location.pathname` has it. |
| `path` | `pathname` relative to `basePath`, starting with `/`; `null` outside it. |
| `search` | The query string, with its `?`, or `''`. |
| `hash` | The fragment, with its `#`, or `''`. |
| `state` | `history.state` as is; `null` when it was too large for the bus (`route:state_dropped`). |

**Guides:** [Writing isolates](../guide/isolates.md).

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

### `UseWatchOptions`

**Experimental.**

Options for `useWatch`: the one key to read.

```ts nocheck
type UseWatchOptions = {
  key: string | null;
};
```

| Field | Description |
| --- | --- |
| `key` | The key to read; `null` reads the records with no key. |

<!-- Generated by scripts/docs/api.ts from the published types. Do not edit: run `pnpm docs:api`. -->
