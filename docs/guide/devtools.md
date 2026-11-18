# Devtools panel

`@isoloop/devtools` (`@experimental`) adds a panel to the page that reads the inspection feed ([ADR 0020](../adr/0020-inspection-feed.md)). The panel is a visual isolate in its own worker, so a crash or hang in the panel doesn't reach the app, and the supervisor restarts it like any other isolate. It is never pooled. It gets the feed through the `inspect` grant, on a port of its own, not through bus topics.

```ts
import { mountDevtools } from '@isoloop/devtools';
// With @isoloop/vite, the build emits the panel like your own isolates:
import panel from '@isoloop/devtools/panel?isolate';

const devtools = mountDevtools(kernel, { src: panel, position: 'bottom-right' });
// later: await devtools.unmount();
```

- **Opting in:** the app opts in by importing and mounting it. Nothing stops a production build from including it.
- **`src`:** the panel isolate's module URL. Without it, `mountDevtools` uses the `panel.js` that sits next to the package's entry. That file is self-contained, with Preact 11 bundled, so the app's own framework and version don't matter.
- **`position`:** the corner where the closed button and the open panel sit: `'bottom-right'` (the default), `'bottom-left'`, `'top-right'` or `'top-left'`.
- **`id`:** the panel's id in the kernel, `'isoloop-devtools'` by default. The panel lists itself among the isolates.

## Using it

- **Closed**, it's a round button in its corner. The button shows a dot:
  - amber while an isolate is `restarting`, `crashed` or `blocked`;
  - red once one has `failed`.
- **A click, or Alt+Shift+D** (Option+Shift+D on a Mac), opens a panel docked in that corner. `devtools.toggle()` does the same from code. Escape closes it while focus is inside.
- **Resizing:** drag the panel's inner corner to resize it. The header's ⤢ button moves it to the next corner.
- **Persistence:** the open state, size and corner are kept across reloads in IndexedDB, on the page's origin. The panel runs in a worker, and workers have no `localStorage`. Without storage (a private window, blocked site data), the panel starts from its defaults.
- **While it restarts:** the panel briefly disappears. If it gives up, a small box with a Retry button takes its place in the corner.

The panel's surface covers the viewport, but it doesn't take pointer events, so only the panel's own boxes catch clicks.
