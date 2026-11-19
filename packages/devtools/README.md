# @isoloop/devtools

A devtools panel for Isoloop, drawn by a visual isolate in its own worker, so a crash or hang in the panel never touches the app. It reads the inspection feed (ADR 0020) through the `inspect` grant. `@experimental`.

```ts
import { connectDevtools } from '@isoloop/devtools';

const disconnect = connectDevtools(kernel, { position: 'bottom-right' });
```

With `@isoloop/vite` the default panel URL works in dev and in a build. With another bundler, pass `src`: the URL it serves `@isoloop/devtools/panel` at. See `docs/guide/devtools.md`.

Alt+Shift+D opens and closes it. Its open state, size and corner are kept in IndexedDB.
