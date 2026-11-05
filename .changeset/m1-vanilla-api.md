---
'@isoloop/runtime': minor
---

The vanilla isolate API. A module's default export `{ start(ctx) }` gets `id`, `config`, `root` (the surface, which `undefined` means headless), `host` (`measure`, `focus`, `scrollIntoView`), `styles`, `onShutdown`, `keepAwake` (a no-op until M2) and `bus`. Until M2's log bus, `bus` is the M0 main-thread bus. `defineIsolate<Root>(def)` types the export. `onShutdown` handlers run before the worker says `bye`.
