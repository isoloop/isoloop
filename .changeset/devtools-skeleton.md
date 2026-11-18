---
'@isoloop/devtools': minor
---

New package (`@experimental`): `mountDevtools(kernel, { position })` mounts the devtools panel, a visual isolate in its own worker with the `inspect` grant. Closed, it shows a floating button with a health dot (amber while an isolate is `restarting`, `crashed` or `blocked`, red once one has `failed`); open, a panel docked in a corner, resizable, toggled with Alt+Shift+D. Guide: `docs/guide/devtools.md`. Open state, size and corner persist in IndexedDB (a worker has no `localStorage`).
