---
'@isoloop/runtime': patch
'@isoloop/vite': patch
---

The isolate worker's bootstrap runs once per worker. WebKit evaluates a module worker's entry a second time when one of its modules imports it by URL, and the second copy booted restarted pool members twice and closed the pool worker when its copy left, which restarted the whole pool. The bootstrap now starts under a once-per-worker marker (`Symbol.for('isoloop.bootstrap')`), and a second copy stays inert (with a warning in Vite dev). `@isoloop/vite` loads the new `@isoloop/runtime/worker` entry, a tiny module that holds the host's messages, loads the bootstrap and replays them, so no other chunk imports the worker's entry.
