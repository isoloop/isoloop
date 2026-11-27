# Watchers

A watcher reads the current value of each key on a topic, not every record, for widgets that show the latest state.

## When to use it

Need history, sums or counts? Use `subscribe`. A sparkline draws every reading, a total adds every one up, and a counter counts every event. A watcher skips the values in between, with no error, so any of these would come out wrong.

A watcher is for code that shows the latest value: a price, a status, a gauge. It gets a snapshot when it starts, then only the keys that changed, and never more views than it can draw. When values arrive faster than a component paints, it skips the ones nobody would see.

| You want to | Use |
| --- | --- |
| Show the latest value, per key or for the whole topic | `useWatch`, or `ctx.bus.watch` outside a component |
| React to every record: history, sums, counts, side effects | `ctx.bus.subscribe`, or `kernel.subscribe` on the page |
| Show one topic's latest value in one component | `useWatch` or `useTopic`. Both draw only the newest value; `useWatch` also skips sending the ones in between |

Watchers are `@experimental` in 0.2.

```ts
import { defineIsolate } from '@isoloop/runtime';
import { count } from './topics';

export default defineIsolate({
  start(ctx) {
    // Every value, in order: a watcher would skip some and draw gaps.
    const points: number[] = [];
    const stop = ctx.bus.subscribe(count, (r) => {
      points.push(r.value);
      if (points.length > 50) points.shift();
      if (ctx.root) ctx.root.textContent = points.join(' ');
    });
    ctx.onShutdown(stop);
  },
});
```

## Watching in a component

`useWatch` is in `@isoloop/react` and `@isoloop/preact`, with the same signature in both. It needs the isolate's subscribe grant for the topic.

- **`useWatch(topic)`:** a `ReadonlyMap` from each key to its current value. It's empty until the first view arrives.
- **`useWatch(topic, { key })`:** that key's value, or `undefined` while it has none.

Records published with no key share the key `null`, so `useWatch(topic, { key: null })` reads them.

```tsx
import { defineIsolate, useWatch } from '@isoloop/react';
import { topic } from '@isoloop/bus';
import { z } from 'zod';

const prices = topic('market.prices.v1', {
  schema: z.object({ price: z.number() }),
  retention: { kind: 'last-n', n: 10_000 },
});

function Price({ symbol }: { symbol: string }) {
  const quote = useWatch(prices, { key: symbol });
  return <span>{quote ? quote.price.toFixed(2) : '–'}</span>;
}

function Board() {
  const all = useWatch(prices);
  return <p>{all.size} symbols</p>;
}

export default defineIsolate(() => (
  <>
    <Board />
    <Price symbol="ACME" />
  </>
));
```

- **Many components, one watch.** Every `useWatch` on a topic in one isolate shares one watch on the bus. A component that mounts later shows the current value at once.
- **One view per render.** The bus sends the next view only after the render that shows this one has committed. In a burst, a component gets about one view per frame.
- **A render that never commits** never confirms its view, so the bus sends no more to it until it does.
- **StrictMode's** extra mount leaves one watch.
- **Treat the map and its values as read-only.** They aren't frozen, to save the time freezing would cost.

## Watching from code

In an isolate, `ctx.bus.watch(topic, onView, { keys? })` does the same outside a component. On the page, `kernel.watch` takes the same arguments.

```ts
import { defineIsolate } from '@isoloop/runtime';
import { count } from './topics';

export default defineIsolate({
  start(ctx) {
    const stop = ctx.bus.watch(count, (view, changed) => {
      for (const key of changed) console.log(key, view.get(key));
    });
    ctx.onShutdown(stop);
  },
});
```

- **`onView(view, changed)`:** `view` holds the current value of every key the watch reads, and `changed` the keys added, updated or cleared since the last call. The first call lists every key it holds.
- **`keys`:** watch only these keys. Default: every key the topic retains.
- **Pacing:** the next view waits until `onView` returns, or until its promise settles. An async `onView` that takes a second gets a view at most once a second, with only the newest value of each key.
- **The return value** ends the watch.
- **A refused watch,** without the subscribe grant, is reported to the host as a non-fatal error, as a refused `subscribe` is.

## Keys that go away

A key leaves the view when retention removes its newest record: on a `last-n` topic once enough newer records push it out, on a `time` topic once it's older than the limit, with or without new records. A compacted topic keeps each key's newest record, so its keys stay.

## After a bus restart

A watch carries on through a bus restart with no code of yours. It tells the new bus which values it already holds, and gets only what's different.

- **A persistent topic** comes back from disk, so usually little changes.
- **A memory topic** is lost in the restart. Its view comes back empty, and `onView` gets a call with every key it had in `changed`.

A woken isolate starts in a new worker, so its watches start again from a snapshot.

## Limits

- **Values in between are skipped.** A watcher shows the newest value per key. Code that needs every record uses `subscribe`.
- **The second value after a quiet spell can be late,** by up to one commit interval (`bus.commitIntervalMs`, 100 ms by default). From the third value of a burst on, views follow the paint rate.
- **An unfiltered watch holds every retained key,** in the bus worker and in the isolate. With the kernel's `dev: true`, the bus warns once in the console when one holds more than 1,000. Pass `keys` to watch only the ones you show.
- **It needs a 0.2 host.** An isolate built with 0.2 doesn't start on a 0.1 host: it fails with `runtime_too_old`, naming both versions.
- **The host page is bigger.** The watch code is in the page's bundle whether or not it calls `kernel.watch` ([bundle size](bundle-size.md)).
- **Watchers are `@experimental`** and may change before 1.0.

## See also

- [The bus](bus.md): topics, retention and subscriptions.
- [Isolates](isolates.md): the React and Preact hooks.
- [What Isoloop can't hide](limits.md): the costs that apply to every app.
