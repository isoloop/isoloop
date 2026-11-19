# @isoloop/devtools

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
