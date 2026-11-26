# Writing isolates

How to write an isolate's module in plain DOM, Preact or React, and what it can use inside its worker.

## When to use it

Read this when you write the code that runs inside an isolate: a widget, a data feed, or a headless worker that answers requests. Each isolate runs in a worker of its own, or as a member of a [pool](pools.md), and talks to the rest of the app only through the bus and the host calls on its context.

- **The app's side** (`createKernel`, the Vite plugin, the contracts module) is in [getting started](getting-started.md) and the [hosting guide](hosting.md).
- **Where an isolate runs** (its own worker, a pool, the balancer) is a spawn option: see [pools](pools.md) and the [balancer](balancer.md).
- **Code that has to read layout synchronously,** or that needs `window` and `localStorage`, belongs on the main thread. [What Isoloop can't hide](limits.md) says what an isolate can't do.

## An isolate module

An isolate is a module whose default export comes from `defineIsolate`. The host loads it by URL in its worker and calls `start(ctx)` once. In plain DOM, with `@isoloop/runtime`:

```ts
import { defineIsolate } from '@isoloop/runtime';
import { count } from './topics';

export default defineIsolate<HTMLElement>({
  start(ctx) {
    let n = 0;
    const button = document.createElement('button');
    const show = () => {
      button.textContent = `Count: ${n}`;
    };
    button.addEventListener('click', () => void ctx.bus.publish(count, n + 1));
    ctx.bus.subscribe(
      count,
      (r) => {
        n = r.value;
        show();
      },
      { from: 'earliest' },
    );
    show();
    ctx.root?.append(button);
  },
});
```

The app spawns it with a surface to render into, and grants for the topics it uses. With `@isoloop/vite`, a `?isolate` import gives the module's URL:

```ts
import counter from './counter?isolate';

kernel.spawn({
  id: 'counter',
  src: counter,
  surface: document.getElementById('counter')!,
  grants: { publish: ['count.v1'], subscribe: ['count.v1'] },
});
```

- **`defineIsolate` stamps the module** with the Isoloop `major.minor` it was built against (`requires`). A host runs isolates built for its own version and for older ones back to a floor. One outside that range fails at once with a version mismatch, and isn't restarted.
- **`defineIsolate<HTMLElement>`** types `ctx.root` with the DOM's types. Without the type argument, `ctx.root` is the structural `IsolateRoot`: `append`, `replaceChildren`, `appendChild`, `insertBefore`, `removeChild`, `childNodes`, `textContent` and `addEventListener`.
- **`start` may be `async`.** A `start` that throws, or whose promise rejects, crashes the isolate, and the host restarts it as for any crash.
- **An isolate without `surface` is headless:** `ctx.root` and `ctx.portalRoot` are `undefined`, and there's no `document`. Use it for feeds, aggregators and request handlers.

## The context

`start(ctx)` gets the isolate's whole world. Preact and React components reach the same object through `useIsolate()`.

| Member | What it is |
| --- | --- |
| `ctx.id` | The isolate's id, from the manifest. |
| `ctx.config` | `manifest.config`, passed through as it is. |
| `ctx.root` | The render target inside the surface, or `undefined` when headless. |
| `ctx.portalRoot` | A container inside `root` for modals, tooltips, toasts and menus, which would otherwise go to `document.body` and reach no surface ([pools](pools.md#modals-tooltips-and-toasts)). Made on first use. |
| `ctx.bus` | The bus client, on its own port to the bus worker: `publish`, `subscribe`, `request`, `reply` and `commit`. |
| `ctx.host` | Host calls: `measure`, `focus`, `scrollIntoView`, `navigate` and `requestCanvas`. Each returns a promise. |
| `ctx.styles(css)` | Adds stylesheets to the surface. A no-op when headless. |
| `ctx.setValue(node, value, { force })` | Sets an input's, textarea's or select's value. The host owns a focused input's value, so a plain `input.value = …` waits until the user leaves it; with `force` it applies at once. |
| `ctx.onShutdown(fn)` | Runs `fn` on stop, restart or suspend, before the worker goes. |
| `ctx.reportError(error, { fatal })` | Reports an error as this isolate's own. `fatal` (the default) crashes the isolate, and the host restarts it as usual. |
| `ctx.keepAwake()` | Holds the isolate against suspension; call the function it returns to release it. Only matters for isolates spawned with `suspend`. |
| `ctx.inspector` | The inspection feed, for isolates with the `inspect` grant (`@experimental`; see [inspection](inspection.md)). |

### The bus client

`ctx.bus` talks to the bus worker directly, never through the main thread. Topics are the ones in the app's contracts module, and each call is checked against the isolate's grants: a publish without a grant rejects with a `BusError` whose code is `forbidden`.

- **`publish(topic, value, { key? })`** resolves once the bus appended the record, and rejects with a `BusError` otherwise. `request(topic, value, { key?, timeoutMs? })`, `reply(record, value)` and `usePublish`'s function take the value the same way.
- **`subscribe(topic, fn, opts?)`** runs `fn` for one record at a time, in order, and returns the function that unsubscribes. By default a record is committed once `fn` returns, so delivery is at least once: a handler that throws stops the subscription's commits, and that record is delivered again after a restart.
- **`request(topic, value, opts?)`** (`@experimental`) sends a request on a topic with a `reply` schema and resolves with the first valid reply. It rejects with `timeout` after `timeoutMs` (30 s by default), or with `dropped` when the topic's retention removed the request before any subscriber got it.
- **`reply(record, value)`** (`@experimental`) answers a request record this isolate received. The bus checks `value` against the topic's `reply` schema.
- **`commit(record)`** (`@experimental`) settles a record by hand, for subscriptions with `autoCommit: false`.

The options of `subscribe`:

| Option | Default | What it does |
| --- | --- | --- |
| `from` | `'latest'` | Where to start: `'latest'` (new records only), `'earliest'` (everything the topic still holds), or `'committed'` (after the last record this isolate committed). With `group`, it applies only while the group has no committed offset. |
| `group` | none | Shares the topic with the other subscribers of the same group: each record goes to one of them (`@experimental`). |
| `autoCommit` | `true` | Commits each record once its handler settles (`@experimental`). |
| `onReset` | none | Called when a bus restart lost this memory topic. Clear what you built from it; records from the new bus follow. |
| `onGap` | none | Called with `{ from, to }` when retention dropped records before they reached this subscription, for example while the isolate was suspended. |

A headless isolate that answers requests:

```ts
import { defineIsolate } from '@isoloop/runtime';
import { quoteTool } from './contracts';

export default defineIsolate({
  start(ctx) {
    ctx.bus.subscribe(quoteTool, async (r) => {
      if (r.req === undefined) return; // a plain record, not a request
      await ctx.bus.reply(r, { symbol: r.value.symbol, vwap: null });
    });
    ctx.onShutdown(async (reason) => {
      console.log(`stopping: ${reason}`);
    });
  },
});
```

A crash after a handler's side effect but before its reply delivers the request again, so make handlers idempotent by the request's id, as the [agents guide](agents.md) shows.

### Host calls

The worker has no layout, so sizes, focus and scrolling go through the host, which answers once the DOM changes made before the call have applied. `measure(node)` resolves with `{ x, y, width, height }` relative to the surface. A failed call rejects with a `HostCallError` whose `code` you can branch on. `navigate(href)` needs the `navigate` grant; the app's `onNavigate` in its kernel config decides each navigation and gets a request with `href`, `replace`, `state` and the isolate's id as `from`. The calls and their errors are in [What Isoloop can't hide](limits.md#layout-focus-and-scrolling-are-asynchronous).

### Shutdown

`onShutdown` handlers run when the isolate is stopped, restarted, moved or suspended, with the reason (`'stop'`, `'restart'` or `'suspend'`). They get the host's stop grace, 1 s: a worker that outlives it is terminated. After the handlers, the bus client sends its last commits, so a graceful stop loses none. A crash runs no handlers, which is why handlers that matter should be idempotent rather than rely on cleanup.

## The worker DOM

In an isolate with a surface, `document`, `window` and the DOM classes (`Node`, `Element`, `HTMLElement`, `Text` and the rest) are Isoloop's DOM subset from `@isoloop/dom`. It records each change and sends it to the host, which applies it inside the surface's shadow root on the next frame.

- **Building and changing nodes works as in the DOM:** creating elements, text and comments, attributes, classes, `style`, events on the elements you created, inputs and selects.
- **Events are the host's, forwarded:** a listener runs a moment after the user acted, so `preventDefault` comes too late for some of them.
- **Layout isn't there.** `getBoundingClientRect`, `offsetWidth`, `animate`, `getComputedStyle` and the other layout members throw `NotSupportedError`, with a message naming what to use instead, usually `ctx.host.measure(node)`.

The full list of what the subset can't do is in [What Isoloop can't hide](limits.md).

## Preact

`@isoloop/preact`'s `defineIsolate(Component)` renders `Component` into `ctx.root` with Preact, under the isolate's context, and unmounts it on shutdown, so effects clean up and subscriptions end. It needs a surface: a headless isolate throws at start. Preact 10 and 11 are supported.

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

`useTopic` reads from mount to unmount; a different `topic` or `from` reads again.

## React

`@isoloop/react`'s `defineIsolate(Component)` renders `Component` with `createRoot` into `ctx.root`, and unmounts the root on shutdown. React 18 and 19 are supported. The component is the same as for Preact:

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

`useTopic` reads the topic through `useSyncExternalStore`, so concurrent renders never tear, and StrictMode's extra subscribe and unsubscribe leave one subscription.

## The hooks

Both adapters have the same hooks, with the same signatures:

| Hook | Returns |
| --- | --- |
| `useTopic(topic, { from? })` | The latest value on `topic`, or `undefined` until one arrives. `from` is `'latest'` by default; `'earliest'` replays the topic, so a compacted one gives its current value at once. A bus restart that lost a memory topic clears it. |
| `usePublish(topic)` | A function `(value, { key? }) => Promise<void>` that publishes to `topic`. |
| `useRequest(topic)` | A function `(value, { key?, timeoutMs? }) => Promise<reply>` for topics with a `reply` schema (`@experimental`; see [request and reply](bus.md#request-and-reply)). |
| `useHost()` | `ctx.host`: `measure`, `focus`, `scrollIntoView`, `navigate` and `requestCanvas`. Pass the elements a ref holds. |
| `useRoute()` | The host's current location (`href`, `pathname`, `path` relative to the base path, `search`, `hash`, `state`), or `undefined` until the first record or with routing off. The route topic is read only while a component uses the hook. |
| `useIsolate()` | The isolate's context. Throws outside a component that `defineIsolate` rendered. |
| `usePortalRoot()` | `ctx.portalRoot`, for `createPortal` or a library's container option. Throws when headless. |

**Several components on one topic.** Any number of components can `useTopic` the same topic, and they all update. In one isolate they share one bus subscription: the first to mount subscribes, the last to unmount unsubscribes, and a component that mounts later gets the current value at once. `useRoute` reads the route topic through `useTopic`, so it shares the same way. The first `useTopic` on a topic sets its `from`; a later one with a different `from` gets the same value as the others, and the console warns once.

```tsx
import { defineIsolate, useTopic } from '@isoloop/react';
import { count } from './topics';

function Badge() {
  const n = useTopic(count);
  return <span>{n ?? 0}</span>;
}

function Panel() {
  const n = useTopic(count);
  return (
    <div>
      <p>Count: {n ?? 0}</p>
      <Badge />
    </div>
  );
}

export default defineIsolate(Panel);
```

Every component also gets `config` as a prop (`IsolateProps`): `manifest.config`, as passed to `spawn`.

```tsx
import { defineIsolate, useRequest, useRoute, type IsolateProps } from '@isoloop/react';
import { quoteTool } from './contracts';

function Quote({ config }: IsolateProps) {
  const route = useRoute();
  const ask = useRequest(quoteTool);
  const symbol = typeof config === 'string' ? config : 'BTC';
  return (
    <button onClick={() => void ask({ symbol }, { timeoutMs: 5_000 }).then(console.log)}>
      Quote {symbol} on {route?.path ?? '/'}
    </button>
  );
}

export default defineIsolate(Quote);
```

A render error is caught at the isolate's root and reported with `ctx.reportError`, so in a pool it crashes only that member, not the whole worker ([pools](pools.md)).

## Isolates built apart

An isolate module can come from another build, another repository or a CDN: the host's bootstrap holds the runtime and the DOM subset, and the module is loaded by URL. It depends only on the topics in the contracts module, never on another isolate's code. What it needs is the `requires` stamp from `defineIsolate`, a version the host runs, and, when it's cross-origin, the headers in the [hosting guide](hosting.md#cors-for-cross-origin-isolates).

The stamp also decides which shape of a changed `ctx` member an isolate gets while the old shape is deprecated. An isolate stamped below 0.2 gets 0.1's `ctx.bus.publish(topic, { value, key? })` from a 0.2 host, so it keeps working until its own project upgrades. With the kernel's `dev: true`, its first call logs a deprecation warning in the console. 0.3 removes the old shape, and a 0.3 host then refuses isolates built before 0.2 with `isolate_too_old`. An isolate without a stamp (a plain `{ start }` object) gets the current shape.

## Limits

- **No synchronous layout, no `localStorage`, no drag and drop:** see [What Isoloop can't hide](limits.md).
- **Preact and React need a surface.** For headless work, use `@isoloop/runtime`'s `defineIsolate` with `start(ctx)`.
- **Delivery is at least once.** A crash, or a handler that throws, delivers records again, so handlers that change something should be idempotent.
- **Shutdown handlers don't run on a crash,** and get 1 s on a stop.
- **Isolates in a pool share one worker:** an event loop, globals and fate. See [pools](pools.md#what-members-share).

## See also

- [Pools](pools.md) and the [balancer](balancer.md): where isolates run.
- [What Isoloop can't hide](limits.md): the worker DOM's limits and the host calls.
- [Hosting](hosting.md): how an isolate's module loads.
- [Agents](agents.md): exposing request topics as tools.
