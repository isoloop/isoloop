# Memory ladder (plant memory investigation)

A minimal page, with no plant code, for [the plant memory investigation](../../docs/investigations/plant-memory.md). Each rung starts one setup (plain workers, headless or visual isolates in own workers or one pool, React widgets in a pool, own workers or on the main thread) and idles, so a script can read renderer PSS after a forced GC against the same page with nothing started.

```bash
pnpm exec vite build --config bench/memory-ladder/vite.config.ts
pnpm exec vite preview --config bench/memory-ladder/vite.config.ts --port 4795
node docs/investigations/assets/plant-memory/ladder.mjs '{"kind":"react","n":8,"pooled":true}'
```

Chromium on Linux only (the script reads `/proc`). Not part of CI or `pnpm bench:*`.
