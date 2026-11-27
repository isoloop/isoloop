# Bundle size

What each Isoloop import adds to an app's JavaScript, and the guard that keeps it in check ([ADR 0021](../../docs/adr/0021-source-layout-and-entry-points.md), decisions 6 and 7).

## What it measures

`bundle-size.ts` bundles the published `dist` of every package through Vite's own `build()`, minified, as a Vite 8 app gets it. Only the framework (React, Preact) is left out. Sizes are in bytes, minified; gzip is reported beside them.

- **Import-time code,** one row per library entry (an export with `types`): the code an entry runs when it's imported, measured with side effects assumed, because `sideEffects: false` would let a bundler drop it. Each entry is measured on its own, with the other packages left out.
- **App bundles:** what a host page, a contracts module and an isolate import (`APPS` in `bundle-size.ts`).
- **Scripts:** the files an app loads by URL rather than importing: the bus worker, the isolate bootstrap and worker, and the devtools panel.

It also checks that each script is named in its package's `sideEffects`, by both its `./src/` and its `./dist/` path, so no bundler drops the code it runs on load.

## Budgets

Each item has a budget in `budgets.json`: its size when it was recorded plus 5%, rounded up to the next 0.5 KB.

- **Import-time code that's 0 B** has a 0 B budget, so any code an entry starts to run on import fails the check.
- **An entry with a few bytes** has a budget of 0.5 KB, so growth smaller than that gap doesn't fail it.

## Running it

```bash
pnpm build
pnpm bench:bundle            # check, as CI does after the build
pnpm bench:bundle --record   # measure, set every budget again, rewrite the table below
```

A PR that crosses a budget runs `--record` and says in its description why the size grew.

## Recorded

<!-- table:start -->
Recorded 2026-11-21: Isoloop `0.1.0-next.11`, Vite 8.3.7 (Rolldown 1.2.18), minified, with only the framework left out.

| Item | Minified | Gzipped | Budget |
| --- | --- | --- | --- |
| import-time · @isoloop/balancer | 22 B | 42 B | 512 B |
| import-time · @isoloop/bus | 49 B | 56 B | 512 B |
| import-time · @isoloop/bus/testing | 0 B | 0 B | 0 B |
| import-time · @isoloop/codec | 1.6 KB | 798 B | 2.0 KB |
| import-time · @isoloop/devtools | 0 B | 0 B | 0 B |
| import-time · @isoloop/dom/worker | 15.4 KB | 4.9 KB | 16.5 KB |
| import-time · @isoloop/dom/host | 0 B | 0 B | 0 B |
| import-time · @isoloop/dom/testing | 15.4 KB | 4.9 KB | 16.5 KB |
| import-time · @isoloop/dom/testing/worker | 15.7 KB | 5.0 KB | 16.5 KB |
| import-time · @isoloop/host | 92 B | 101 B | 512 B |
| import-time · @isoloop/host/dev-mcp | 26 B | 46 B | 512 B |
| import-time · @isoloop/preact | 119 B | 106 B | 512 B |
| import-time · @isoloop/protocol | 1.3 KB | 732 B | 1.5 KB |
| import-time · @isoloop/react | 122 B | 109 B | 512 B |
| import-time · @isoloop/runtime | 94 B | 103 B | 512 B |
| import-time · @isoloop/runtime/testing | 26 B | 46 B | 512 B |
| import-time · @isoloop/vite | 18 B | 38 B | 512 B |
| import-time · @isoloop/webmcp | 22 B | 42 B | 512 B |
| app · host page | 64.8 KB | 22.8 KB | 68.5 KB |
| app · host page with devtools | 66.4 KB | 23.4 KB | 70.0 KB |
| app · host page with the balancer | 79.3 KB | 27.7 KB | 83.5 KB |
| app · contracts module | 4.0 KB | 1.7 KB | 4.5 KB |
| app · React isolate | 3.2 KB | 1.6 KB | 3.5 KB |
| app · Preact isolate | 3.5 KB | 1.8 KB | 4.0 KB |
| app · vanilla isolate | 1.5 KB | 843 B | 2.0 KB |
| script · @isoloop/bus/worker | 64.4 KB | 22.1 KB | 68.0 KB |
| script · @isoloop/devtools/panel | 13.1 KB | 5.5 KB | 14.0 KB |
| script · @isoloop/runtime/bootstrap | 42.3 KB | 14.7 KB | 44.5 KB |
| script · @isoloop/runtime/worker | 42.7 KB | 14.9 KB | 45.0 KB |
<!-- table:end -->

The React and Preact isolate rows and budgets were measured again on 2026-11-26, on `main` at `0.1.0` with Vite 8.3.8, when `useTopic` began sharing one subscription per topic (#410): 2.7 KB to 3.2 KB for React and 2.9 KB to 3.5 KB for Preact, minified. The bus worker row and budget were measured again on 2026-11-27, on `main` at `0.1.0` with Vite 8.3.8, when the bus worker began serving watches (M8 Watchers W1): 59.3 KB to 64.4 KB minified, 20.6 KB to 22.1 KB gzipped, against `main` measured the same day. The other rows are from 2026-11-21.
