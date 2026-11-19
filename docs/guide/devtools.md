# Devtools panel

`@isoloop/devtools` (`@experimental`) adds a panel to the page that reads the inspection feed ([ADR 0020](../adr/0020-inspection-feed.md)). The panel is a visual isolate in its own worker, so a crash or hang in the panel doesn't reach the app, and the supervisor restarts it like any other isolate. It is never pooled. It gets the feed through the `inspect` grant, on a port of its own, not through bus topics.

```ts
import { connectDevtools } from '@isoloop/devtools';
// With @isoloop/vite, the build emits the panel like your own isolates:
import panel from '@isoloop/devtools/panel?isolate';

const disconnect = connectDevtools(kernel, { src: panel, position: 'bottom-right' });
// later: await disconnect();
```

- **Opting in:** the app opts in by importing and connecting it. Nothing stops a production build from including it.
- **`src`:** the panel isolate's module URL. Without it, `connectDevtools` uses the `panel.js` that sits next to the package's entry. That file is self-contained, with Preact 11 bundled, so the app's own framework and version don't matter.
- **`position`:** the corner where the closed button and the open panel sit: `'bottom-right'` (the default), `'bottom-left'`, `'top-right'` or `'top-left'`.
- **`id`:** the panel's id in the kernel, `'isoloop-devtools'` by default. The panel lists itself among the isolates.

## Using it

- **Closed**, it's a round button in its corner. The button shows a dot:
  - amber while an isolate is `restarting`, `crashed` or `blocked`;
  - red once one has `failed`.
- **A click, or Alt+Shift+D** (Option+Shift+D on a Mac), opens a panel docked in that corner. Escape closes it while focus is inside.
- **Resizing:** drag the panel's inner corner to resize it. The header's ⤢ button moves it to the next corner.
- **Persistence:** the open state, size and corner are kept across reloads in IndexedDB, on the page's origin. The panel runs in a worker, and workers have no `localStorage`. Without storage (a private window, blocked site data), the panel starts from its defaults.
- **While it restarts:** the panel briefly disappears. If it gives up, a small box with a Retry button takes its place in the corner.

## Isolates view

The panel opens on the isolates view. Each row is one isolate:
- **State** comes from the supervisor.
- **Lag** is from the isolate's last beat.
- **Busy** is the busy time from its last beat ([ADR 0017](../adr/0017-opt-in-balancer.md)).
- **Memory** is only measured in Chromium on a cross-origin isolated page. It shows how old the figure is, and for a pool member it's the whole pool's worker.
- **Restarts** counts crash restarts. A restart you ask for doesn't count.
- **Queue** is the patch batches waiting for the compositor.
- The **pool** is shown under the id.

The panel lists itself, marked `devtools`. A pools table below lists each pool's members, whether its worker is running, and the warning when they share a document.

Each row has three controls:
- **Restart** restarts the isolate, as `kernel.restart(id)` does.
- **Kill** ends its worker as a crash, so the supervisor restarts it. For a pool member, that ends the pool's worker, and every member restarts.
- **Block 2 s** busy-loops its worker for 2 seconds, which is enough for the supervisor to mark it `blocked` with the usual heartbeat settings.

A control that fails shows its error under the table.

## Bus view

The Bus tab shows the bus's state and how many times it has restarted. Once the first metrics have arrived (about once a second), it also shows:
- **Topics:** records and bytes a second, the head (the next offset to be written), and how many records the topic still retains.
- **Subscriptions:** each consumer's lag (head minus its cursor), and its credit (records that may still be delivered before its next commit).
- **Rejected publishes:** counts by error code, since the bus worker started. A bus restart starts them again from zero.
- **Storage:** the origin's storage use, while the bus keeps files.

The panel reads the feed on a port of its own, not through the bus, so none of these figures include it. Arrow keys move between the tabs.

## Log view

The Log tab shows records as they are appended to the bus, newest first, and keeps the last 200. Each row has:
- the time, topic, offset and key;
- the producer;
- the value's size;
- the value as a preview, cut at 2 KB.

The records come from a tap ([ADR 0020](../adr/0020-inspection-feed.md), decision 3):
- **Topics:** every topic by default. Type patterns (`orders.*`, several separated by commas or spaces) and Apply to narrow it. Rows already in the list stay; Clear removes them.
- **Rate:** at most 50 records a second reach the panel.
- **No consumer:** the tap isn't a consumer, so it isn't in the bus figures.
- **Only while open:** the tap runs only while the Log tab is open. Leaving the tab, or closing the panel, ends it and clears the list. Pause stops it, and Clear empties the list.
- **Bus restarts:** the host reopens the tap after a bus restart, so the log carries on. Memory topics start empty again, so their offsets start from 0. The panel doesn't publish to the bus ([M4b plan](../plans/m4b-devtools.md), devtools decision 7).

The panel's surface covers the viewport, but it doesn't take pointer events, so only the panel's own boxes catch clicks.
