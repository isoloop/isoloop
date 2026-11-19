# @isoloop/devtools

A devtools panel for Isoloop, drawn by a visual isolate in its own worker, so a crash or hang in the panel never touches the app. It reads the inspection feed (ADR 0020) through the `inspect` grant. `@experimental`.

```ts
import { connectDevtools } from '@isoloop/devtools';
// With @isoloop/vite, emit the panel like your own isolates:
import panel from '@isoloop/devtools/panel?isolate';

const disconnect = connectDevtools(kernel, { src: panel, position: 'bottom-right' });
```

Alt+Shift+D opens and closes it. Its open state, size and corner are kept in IndexedDB.
