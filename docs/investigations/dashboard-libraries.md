# The markets dashboard's libraries (M3b task 2)

**Question:** what the dashboard uses for its framework, table, icons and charts, and what each needs from the `isoloop-dom` subset ([ADR 0010](../adr/0010-own-render-bridge.md#beyond-the-frameworks)).

**Answer:** React 19 for the widgets, Zod for the contracts, and our own code for everything else. No new library, so no new DOM usage log and no DOM group 2 work: tasks 3–5 are not needed.

## Choices

| Need | Choice | Why |
| --- | --- | --- |
| Framework | **React 19**, through `@isoloop/react` | The native build (task 15) must be the idiomatic main-thread app, and React is the most common one. The same widgets run in both builds. Its DOM usage is already logged (`packages/dom/usage/react-19.json`, M3a task 2). |
| Contracts | **Zod** | Already the example in ADR 0003 and four-loops; Standard Schema, so the bus validates it as is. |
| Charts | **Our own**, `src/charts/` in `apps/markets` | Three line and bar charts on a 2D canvas context, a few hundred lines. The same code draws on an `OffscreenCanvas` in an isolate (`requestCanvas`) and on a `<canvas>` in the native build. A DOM chart library would need the main thread's layout, and a canvas library would be a dependency for what `CanvasRenderingContext2D` already does. |
| Virtualized table | **Our own**, `src/widgets/trades-table/` | Fixed-height rows, a spacer and a window of rendered rows, driven by the scroll offset and the viewport height. In an isolate those come from `useHost` (`measure` and scroll events); in the native build from the element itself, behind the app's data interface. Libraries (TanStack Virtual, react-window) measure rows synchronously, which ADR 0010 group 3 doesn't offer in a worker. The plan's risk holds: if `measure` round trips aren't enough, rows stay fixed-height, which is the design anyway. |
| Icons | **Our own**, inline SVG components | A handful of icons (up, down, alert, crash, block). `isoloop-dom` creates SVG elements (`createElementNS`) and the host's registry allows `svg` and `path`. |
| Styling | **Plain CSS**, one sheet passed to the kernel's `styles` | No CSS-in-JS runtime: it would need `document.head` writes and `CSSStyleSheet` in each isolate. |

## What this means for the DOM subset

- **Group 2 (tasks 3–5):** nothing to add. Our widget code renders through React, whose log needs no group 2 member (`querySelector` appears in React 19's log only for `head > title`, which M3a already supports). Our own code builds no HTML strings, clones no subtrees and observes no mutations.
- **Group 3 (synchronous layout):** not used. The table and the charts get sizes from `measure` (async) or, for the charts, from the canvas they're given.
- If a later change brings in a library after all, it gets a usage log with M3a task 2's tool before it lands, and its group 2 needs come back as tasks 3–5.

## What the plan said and what changed

- The plan expected the virtualized table to be the likely library. Writing our own is smaller than wrapping one, because the libraries' synchronous measuring is what a worker can't offer.
- Tasks 3–5 are conditional on this task ("only for what it finds"); they're skipped.
