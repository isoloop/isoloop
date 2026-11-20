# Devtools panel

`@isoloop/devtools` (`@experimental`) adds a panel to the page that shows its isolates, the bus, the kernel's own events and a live log of records, read from the inspection feed.

## When to use it

Use the panel to watch a page while you develop it, and to restart, kill or block an isolate by hand. It reads the inspection feed ([ADR 0020](../adr/0020-inspection-feed.md)). The panel is a visual isolate in its own worker, so a crash or hang in the panel doesn't reach the app, and the supervisor restarts it like any other isolate. It is never pooled. It gets the feed through the `inspect` grant, on a port of its own, not through bus topics.

- **To build a tool of your own** on the same feed, read [the inspection guide](inspection.md).
- **To let a coding agent read the page,** use the dev MCP ([agents guide](agents.md#in-development-the-dev-mcp)).

## Adding it

```ts
import { connectDevtools } from '@isoloop/devtools';

const disconnect = connectDevtools(kernel, { position: 'bottom-right' });
// later: await disconnect();
```

- **Opting in:** the app opts in by importing and connecting it.
- **`src`:** the panel isolate's module URL. Without it, `connectDevtools` uses the `panel.js` next to the package's entry (`new URL('./panel.js', import.meta.url)`). That file is self-contained, with Preact 11 bundled, so the app's own framework and version don't matter.
  - **With `@isoloop/vite`, leave `src` out.** In dev, the plugin keeps `@isoloop/devtools` out of Vite's dependency pre-bundling, so the server serves `panel.js` next to the entry. In a build, Vite emits `panel.js` as an asset and rewrites the URL.
  - **With another bundler,** pass `src` yourself: the URL your build serves `@isoloop/devtools/panel` (the package's `dist/panel.js`) at, copied as a file. Under `@isoloop/vite`, `import panel from '@isoloop/devtools/panel?isolate'` gives that URL as well.
- **`position`:** the corner where the closed button and the open panel sit: `'bottom-right'` (the default), `'bottom-left'`, `'top-right'` or `'top-left'`.
- **`healthStatus`:** how the closed button shows the kernel's health: `'ring'` (the default), `'radar'` or `'off'`. See [the button](#the-button).
- **`id`:** the panel's id in the kernel, `'isoloop-devtools'` by default. The panel lists itself among the isolates.

## Using it

### The button

Closed, the panel is a round 70 px button in its corner. A ring of twelve arcs runs round its edge, one stretch of isolates to an arc (in the order they were spawned, shared evenly), coloured by the worst state among them: green, amber while one is `restarting`, `crashed` or `blocked`, red once one has `failed`, and grey while loading. A wave of brightness runs round the ring, and a failing arc pulses faster. With the system's reduced-motion setting on, nothing moves. Hover an arc to see which isolates it stands for. The button's label and tooltip say how many sections need attention, and which other checks (restarts, the bus, consumer lag) do.

`healthStatus` picks the look:
- **`'ring'`** (the default): the ring, with a white logo.
- **`'radar'`:** the same ring, with the logo filled by the same twelve colours, each on its arc's side.
- **`'off'`:** a plain white ring, with no status on the button and nothing animated.

Hover the button and two small arrows appear, pointing to the free sides: they move it one corner across or up and down, never diagonally. The corner is kept across reloads.

### The panel

- **A click, or Alt+Shift+D** (Option+Shift+D on a Mac), opens a panel docked in that corner, flush against the window's edges. Escape closes it while focus is inside.
- **Resizing:** drag the two edges that face away from the corner, or the corner between them. The toolbar's ↔ button stretches it across the window's width (the top edge still sets its height), and □ fills the window. Each toggles back.
- **Tabs:** Isolates, Bus, Events and Messages. Isolates and Bus have a second row of tabs under them (Pools; Topics, Subscriptions, Rejected). Both rows stay in view while the content scrolls, and so do the tables' headers.
- **Persistence:** the open state, size, corner and whether it's stretched or filling the window are kept across reloads in IndexedDB, on the page's origin. The panel runs in a worker, and workers have no `localStorage`. Without storage (a private window, blocked site data), the panel starts from its defaults.
- **While it restarts:** the panel briefly disappears. If it gives up, a small box with a Retry button takes its place in the corner.
- **Clicks:** the panel's surface covers the viewport, but it doesn't take pointer events, so only the panel's own boxes catch clicks.

## Isolates view

The panel opens on the isolates view. Each row is one isolate:
- **State** comes from the supervisor.
- **Lag** is from the isolate's last beat.
- **Busy** is the busy time from its last beat ([ADR 0017](../adr/0017-opt-in-balancer.md)).
- **Memory** is only measured in Chromium on a cross-origin isolated page. It shows how old the figure is, and for a pool member it's the whole pool's worker.
- **Restarts** counts crash restarts. A restart you ask for doesn't count.
- **Queue** is the patch batches waiting for the compositor.
- The **pool** is shown under the id.

The panel lists itself, marked `devtools`. The Pools tab lists each pool's worker state, how many isolates it has, its members (the long lists fold to "+N more") and the warning when they share a document.

Each row has three controls:
- **Restart** restarts the isolate, as `kernel.restart(id)` does.
- **Kill** ends its worker as a crash, so the supervisor restarts it. For a pool member, that ends the pool's worker, and every member restarts.
- **Block 2 s** busy-loops its worker for 2 seconds, which is enough for the supervisor to mark it `blocked` with the usual heartbeat settings.

A control that fails shows its error under the table.

## Bus view

The Bus tab shows the bus's state and how many times it has restarted. Once the first metrics have arrived (about once a second), it also has three tabs of its own:
- **Topics:** records and bytes a second, the head (the next offset to be written), and how many records the topic still retains.
- **Subscriptions:** each consumer's lag (head minus its cursor), and its credit (records that may still be delivered before its next commit).
- **Rejected publishes:** counts by error code, since the bus worker started. A bus restart starts them again from zero.
- **Storage:** the origin's storage use, while the bus keeps files.

The panel reads the feed on a port of its own, not through the bus, so none of these figures include it. Arrow keys move between the tabs.

## Events view

The Events tab is the kernel's own history, newest first: isolates changing state, crashing or failing, the bus restarting, and warnings about the bus's storage quota and durability and about the worker budget. It says why the ring changed colour. Each row has the time since the page started, the event, the isolate (or `bus`), and one line of what happened; click a row to see its data, with a Copy button. Rows are coloured like the ring: green for ready and running, amber for a crash, a stall or a warning, red for a failure.

- **This session:** the feed itself keeps only its last 200 events, which start-up alone can use. The panel's worker records every event from the moment it connects, even with the panel closed, so the tab lists them all (up to 6,000 a session, the oldest going first), newest 500 at first with a Load older button.
- **Earlier sessions:** the last 3 sessions before this one are kept in IndexedDB, up to 6,000 events each, so a crash that ended in a reload can be read back from the session selector. Clear forgets all of them. Without storage the tab still lists this session, from memory.
- **The count:** the tab shows the problems (amber and red events) you haven't acknowledged, as `99+` past 99. Acknowledge marks them as seen; the rows that were new lose their amber edge, and only later problems count again.
- **Filter:** type to narrow by event, isolate or text, and Problems only hides the rest.
- **Only what the host has seen:** events from before the panel connected come only from the feed's last 200, so connect it early.

## Messages view

The Messages tab shows the records your app publishes, as they are appended to the bus, newest first, and keeps the last 200. Each row has:
- the time, topic, offset and key (the Time, Offset, Key and Size columns have a fixed width);
- the producer;
- the value's size;
- the value as a coloured one-line preview, cut at 2 KB.

Click a row, or its chevron, to open it into two panels: **Value** (indented and coloured) and **Record** (the exact time, topic, offset, key, producer, size and the request that produced it, if any). Each has a Copy button; the page does the copying, since the panel's worker has no clipboard.

The records come from a tap ([ADR 0020](../adr/0020-inspection-feed.md), decision 3):
- **Topics:** every topic by default. Type patterns (`orders.*`, several separated by commas or spaces) and Apply to narrow it. Rows already in the list stay; Clear removes them.
- **Rate:** at most 50 records a second reach the panel. The header shows the cap and how many records the bus left out over it since the log was opened (`50/s cap · N skipped`); it starts again from zero when the log is reopened.
- **No consumer:** the tap isn't a consumer, so it isn't in the bus figures.
- **Only while open:** the tap runs only while the Messages tab is open. Leaving the tab, or closing the panel, ends it and clears the list. Pause stops it, and Clear empties the list.
- **Bus restarts:** the host reopens the tap after a bus restart, so the log carries on. Memory topics start empty again, so their offsets start from 0. The panel doesn't publish to the bus ([M4b plan](../plans/m4b-devtools.md), devtools decision 7).

## Limits

- **It's `@experimental` in 0.1.**
- **Nothing stops a production build from including it.** Keep `connectDevtools` out of production code yourself.
- **Memory is measured only in Chromium, on a cross-origin isolated page** ([Isolates view](#isolates-view)).
- **The messages are a sample:** at most 50 records a second reach the Messages tab, and it keeps the last 200 ([Messages view](#messages-view)).
- **The events history is bounded:** this session's last 6,000 events, and the last 3 sessions before it in IndexedDB, up to 6,000 events each (at most 24,000 in all). Events from before the panel connected come only from the feed's last 200, so connect it early ([Events view](#events-view)).
- **Its settings need storage:** without IndexedDB (a private window, blocked site data), the panel starts from its defaults each time.

## See also

- [ADR 0020: the inspection feed](../adr/0020-inspection-feed.md), the decisions behind the panel.
- [The inspection feed](inspection.md), the API the panel reads.
- [Tools for agents](agents.md), whose dev MCP reads the same feed.
- [The M4b plan](../plans/m4b-devtools.md), where the panel was built.
