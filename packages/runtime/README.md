# @isoloop/runtime

The [Isoloop](https://isoloop.dev) runtime inside each worker: write a part of your app as an isolate, with a UI or headless, in plain TypeScript.

## What you get

- **One way to write an isolate:** `defineIsolate` with a `start(ctx)`, for a widget, a feed, an engine or a request handler.
- **Plain DOM in a worker:** create elements, listen to input and style your surface, and the host draws it.
- **The bus:** typed publish and subscribe, straight to the bus worker, with replay after a restart.
- **The page when you need it:** async calls to measure, focus, scroll, navigate and get a canvas to draw on.
- **A lifecycle:** shutdown handlers, error reporting, and a hold against suspension.
- **Unit tests without a worker:** `createTestContext` from `@isoloop/runtime/testing`.

## Install

```sh
npm install @isoloop/runtime
```

## Example

```ts
import { defineIsolate } from '@isoloop/runtime';
import { count } from './topics'; // a topic from your contracts

export default defineIsolate<HTMLElement>({
  start(ctx) {
    const label = document.createElement('p');
    label.textContent = 'Waiting for a count';
    ctx.root?.append(label);

    ctx.bus.subscribe(
      count,
      (record) => {
        label.textContent = `Count: ${record.value}`;
      },
      { from: 'earliest' },
    );
  },
});
```

## Learn more

- [Writing isolates](https://isoloop.dev/docs/isolates/)
- [Testing isolates and contracts](https://isoloop.dev/docs/testing/)
- [What Isoloop can't hide](https://isoloop.dev/docs/limits/)
- [API reference](https://isoloop.dev/docs/api/runtime/)
