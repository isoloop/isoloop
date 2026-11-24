# @isoloop/devtools

## 0.1.1

### Patch Changes

- 164d266: The host writes the `style` an isolate renders through the element's CSSOM (`el.style.cssText`) instead of `setAttribute('style', …)`, and the devtools panel styles its own page elements the same way. A page with surfaces now works under `style-src 'self'`, with no `'unsafe-inline'`: before, the browser dropped those styles and logged a violation for each. `devCsp()` still allows `'unsafe-inline'` in `style-src`, for the `<style>` elements Vite's dev server injects; its TSDoc and the hosting guide say so.
- Updated dependencies [532c3c1]
  - @isoloop/host@0.1.1

## 0.1.0

The first release, experimental: the panel and its options may change in any minor.

- **A panel in its own worker:** drawn by a visual isolate, so a crash or hang in the panel never touches the app.
- **What it shows:** isolates, topics and live records, from the inspection feed.
- **What it does:** restart, kill and block an isolate.

The changes made during the previews are in the `0.1.0-next.N` sections below.

## 0.1.0-next.12

### Patch Changes

- 3afc5f8: Each package's homepage on npm is its page on isoloop.dev, and each has search keywords. The public packages' npm descriptions say that they're Isoloop's and what each one does.
- Updated dependencies [2788228]
- Updated dependencies [3afc5f8]
- Updated dependencies [03d13ef]
- Updated dependencies [cceac10]
  - @isoloop/host@0.1.0-next.12

## 0.1.0-next.11

### Patch Changes

- f973a86: `@isoloop/bus` and `@isoloop/devtools` name their scripts in `sideEffects`: the bus worker (`./dist/bus-worker.js`) and the devtools panel (`./dist/panel.js`) run code when they load, so a bundler that meets one in an `import` keeps it rather than dropping it. Their other files stay side-effect-free.
- @isoloop/host@0.1.0-next.11

## 0.1.0-next.10

### Patch Changes

- 23c1bb4: Every public export of `@isoloop/vite`, `@isoloop/balancer`, `@isoloop/devtools` and `@isoloop/webmcp` has its reference comment: a lead sentence, its parameters, what it returns and throws, and each option's default. `isoloop()`, `createBalancer`, `connectDevtools` and `connectWebMCP` each have an example.
- Updated dependencies [b303cb3]
  - @isoloop/host@0.1.0-next.10

## 0.1.0-next.9

### Patch Changes

- Updated dependencies [e5f3377]
- Updated dependencies [5793b1a]
- Updated dependencies [18972a8]
  - @isoloop/host@0.1.0-next.9

## 0.1.0-next.8

### Minor Changes

- 72be35b: The devtools button is bigger (70 px) and shows the Isoloop mark, by default in white, on a round dark tile. Hover it and two small chevrons appear to move it one corner across or up and down.
  
  The closed button has a ring of twelve arcs, one stretch of isolates each, coloured by their worst state (green, amber, red, or grey without data), with a wave of brightness running round it. `connectDevtools` has a new `healthStatus` option: `'ring'` (the default), `'radar'` (the logo filled by the ring's colours) or `'off'` (a plain white ring).
  
  The open panel docks flush against the window's edge, so it can be dragged to the very bottom. It resizes from either inner edge or the corner, and its toolbar has a stretch button (full width, the height still adjustable) and a maximize button, both toggling back and kept across reloads. The tab bars and the tables' headers stay in view while the rows scroll, there is a second level of tabs (Pools beside the isolates, and Topics, Subscriptions and Rejected on the Bus view), and the isolates table has an Actions header.
  
  The new Events tab lists the kernel's own history: isolates changing state, crashing or failing, and the bus restarting. It keeps up to 6,000 of this page session's events (the oldest go first), not only the feed's last 200, and the last 3 sessions before it in IndexedDB (up to 6,000 events each, 24,000 in all), to read back after a reload. Its tab counts the problems you haven't acknowledged, and an Acknowledge button marks them as seen.
  
  The tab that shows the records an app publishes is now called Messages. Its columns have a fixed width, its values are coloured, and a row opens into its value and its record, each with a Copy button.

### Patch Changes

- Updated dependencies [6fc09f6]
  - @isoloop/host@0.1.0-next.8

## 0.1.0-next.7

### Patch Changes

- Updated dependencies [3c354e8]
  - @isoloop/host@0.1.0-next.7

## 0.1.0-next.6

### Patch Changes

- Updated dependencies [8e04ddf]
  - @isoloop/host@0.1.0-next.6

## 0.1.0-next.5

### Minor Changes

- cc16cf4: The panel has a Bus tab. It shows the bus's state and restart count, and, from the latest metrics:
  - each topic's records and bytes a second, head and retained count;
  - each subscription's lag and credit;
  - rejected publishes by error code;
  - the origin's storage use.
  
  The tabs follow the WAI-ARIA tabs pattern, and each isolate's controls have an accessible name that includes its id.
- 28a075f: The panel has a Log tab: records as they're appended to the bus, newest first, with the last 200 kept. They come from a tap capped at 50 a second, which runs only while the tab is open and carries on through a bus restart. Topic patterns narrow it; Pause and Clear are in the bar. Values show as 2 KB previews with their size.
- 080059d: `tap()` on the host's `Inspector` and on `ctx.inspector` takes `onSkipped?: (count: number) => void` (`@experimental`). It gets each count of records the bus left out over `maxPerSec`, at most once a second (ADR 0020, decision 6, amended 2026-11-19). The devtools Log header shows the cap and the total skipped since the log was opened.

### Patch Changes

- 9582e91: In dev, `@isoloop/vite` keeps `@isoloop/devtools` out of dependency pre-bundling (`optimizeDeps.exclude`), so the panel's default URL (`new URL('./panel.js', import.meta.url)`) reaches the published `panel.js`. With `@isoloop/vite`, `connectDevtools` needs no `src`; with another bundler, pass the URL it serves `@isoloop/devtools/panel` at.
- Updated dependencies [080059d]
  - @isoloop/host@0.1.0-next.5

## 0.1.0-next.4

### Minor Changes

- 3d07858: The panel's isolates view lists every isolate. For each one it shows the state, lag, busy time, memory (Chromium, cross-origin isolated, with its age), crash restarts, the patch queue and the pool, and it marks the panel itself as `devtools`. A table under it lists each pool and its members. Each isolate has Restart, Kill and Block 2 s controls; Kill on a pool member ends the whole pool's worker.
- 9c9b968: New package (`@experimental`): `connectDevtools(kernel, { src, position, id })` connects the devtools panel, a visual isolate in its own worker with the `inspect` grant. Closed, it shows a floating button with a health dot (amber while an isolate is `restarting`, `crashed` or `blocked`, red once one has `failed`); open, a panel docked in a corner, resizable, toggled with Alt+Shift+D. It returns a function that disconnects. Guide: `docs/guide/devtools.md`. Open state, size and corner persist in IndexedDB (a worker has no `localStorage`).

### Patch Changes

- @isoloop/host@0.1.0-next.4
