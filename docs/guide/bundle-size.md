# Bundle size

What each Isoloop import adds to your app's JavaScript, and what tree-shaking removes.

## When to use it

Read this when you're checking what Isoloop costs in bytes, or keeping an isolate's module small. What it costs in CPU, memory and start-up time is in [Pools](pools.md) and [Limits](limits.md).

## What your app loads

- **The page:** the code that creates the kernel, from `@isoloop/host`. Devtools and the balancer are added only if you connect them.
- **The contracts module:** your topics, built with `topic` and `contracts` from `@isoloop/bus`. The page and the isolates share it.
- **Each isolate's module:** your isolate code and its adapter, `@isoloop/react`, `@isoloop/preact` or `@isoloop/runtime`.
- **The scripts:** the bus worker and the isolate worker, plus the devtools panel if you connect it. The browser loads each one by URL, as a file of its own, when the kernel starts it. They're the same for every app.

## What each import costs

| What you import | Minified | Gzipped |
| --- | --- | --- |
| A page with `createKernel` | 70.8 KB | 24.8 KB |
| The same page with `connectDevtools` | 72.4 KB | 25.5 KB |
| The same page with `createBalancer` | 85.4 KB | 29.7 KB |
| A contracts module (`topic`, `contracts`) | 4.0 KB | 1.7 KB |
| A React isolate (`defineIsolate`, `useTopic`) | 3.2 KB | 1.6 KB |
| A Preact isolate (`defineIsolate`, `useTopic`) | 3.5 KB | 1.8 KB |
| A vanilla isolate (`defineIsolate`) | 1.5 KB | 836 B |

| Script, loaded by URL | Minified | Gzipped |
| --- | --- | --- |
| The bus worker | 64.4 KB | 22.1 KB |
| The isolate worker | 47.1 KB | 16.5 KB |
| The devtools panel | 13.1 KB | 5.5 KB |

These are Isoloop `0.1.0-next.11` built with Vite 8.3.7 (Rolldown 1.2.18), minified, with React and Preact left out, on 2026-11-21, and the React and Preact isolates on `main` at `0.1.0` with Vite 8.3.8 on 2026-11-26, and the bus worker and the isolate worker the same way on 2026-11-27 ([bench/bundle-size](../../bench/bundle-size/README.md)). Sizes don't depend on the machine. CI checks each one against a budget, so a change that grows one says why.

## Keep your bundles small

- **Isolate code imports its adapter, never `@isoloop/host`.** The kernel belongs to the page. An isolate's module carries only its adapter, under 3 KB minified.
- **Import what you use.** Every package is ESM and declares its side effects, so your bundler drops the exports you don't import. A contracts module keeps `topic` and `contracts`, and leaves the rest of `@isoloop/bus` out.
- **Connect devtools and the balancer only where you need them.** On the page above, devtools adds 1.6 KB and the balancer 14.6 KB, minified.
- **Keep the `/testing` entries in tests.** `@isoloop/runtime/testing`, `@isoloop/bus/testing` and `@isoloop/dom/testing` are for test code, and an app never imports them.

## Check your own build

Run `vite build`. It prints each file's size, minified and gzipped: your page, each isolate module, and the workers as files of their own. With `@isoloop/vite`, the workers are emitted for you, so they never land in your page's bundle.

## Limits

- **`createKernel` brings every kernel feature.** Inspection, agent tools, pools and the router are part of the kernel, so a page that uses none of them still ships them.
- **The scripts are fixed downloads.** The bus worker and the isolate worker are the same size in every app.
- **Only Vite 8 is measured.** Other bundlers tree-shake differently, so webpack and esbuild may give other sizes.
- **Gzipped sizes depend on your server.** Brotli, or no compression, changes what crosses the network.

## See also

- [Getting started](getting-started.md)
- [Hosting](hosting.md): serving the workers and the headers they need
- [Pools](pools.md)
- [Limits](limits.md)
