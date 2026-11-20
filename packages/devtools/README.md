# @isoloop/devtools

A devtools panel for Isoloop, drawn by a visual isolate in its own worker, so a crash or hang in the panel never touches the app. It reads the inspection feed (ADR 0020) through the `inspect` grant. `@experimental`.

```ts
import { connectDevtools } from '@isoloop/devtools';

const disconnect = connectDevtools(kernel, { position: 'bottom-right', healthStatus: 'ring' });
```

With `@isoloop/vite` the default panel URL works in dev and in a build. With another bundler, pass `src`: the URL it serves `@isoloop/devtools/panel` at. See `docs/guide/devtools.md`.

Alt+Shift+D opens and closes it. Closed, the button is ringed by twelve arcs that show the kernel's health; `healthStatus` is `'ring'` (the default), `'radar'` (the logo filled by the same colours) or `'off'` (a plain white ring). The panel has Isolates, Bus, Events (the kernel's history, kept for the whole session and the last few before it) and Messages (the records your app publishes) tabs. Its open state, size and corner, and the events history, are kept in IndexedDB.
