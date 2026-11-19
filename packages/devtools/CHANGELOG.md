# @isoloop/devtools

## 0.1.0-next.4

### Minor Changes

- 3d07858: The panel's isolates view lists every isolate. For each one it shows the state, lag, busy time, memory (Chromium, cross-origin isolated, with its age), crash restarts, the patch queue and the pool, and it marks the panel itself as `devtools`. A table under it lists each pool and its members. Each isolate has Restart, Kill and Block 2 s controls; Kill on a pool member ends the whole pool's worker.
- 9c9b968: New package (`@experimental`): `connectDevtools(kernel, { src, position, id })` connects the devtools panel, a visual isolate in its own worker with the `inspect` grant. Closed, it shows a floating button with a health dot (amber while an isolate is `restarting`, `crashed` or `blocked`, red once one has `failed`); open, a panel docked in a corner, resizable, toggled with Alt+Shift+D. It returns a function that disconnects. Guide: `docs/guide/devtools.md`. Open state, size and corner persist in IndexedDB (a worker has no `localStorage`).

### Patch Changes

- @isoloop/host@0.1.0-next.4
