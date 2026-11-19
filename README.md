<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://isoloop.dev/brand/expressive-dark.svg">
    <img src="https://isoloop.dev/brand/expressive.svg" alt="The Isoloop mark: a cube with a woven ribbon inside a cycle arrow" width="128">
  </picture>
</p>

# Isoloop

[![CI](https://github.com/isoloop/isoloop/actions/workflows/ci.yml/badge.svg)](https://github.com/isoloop/isoloop/actions/workflows/ci.yml)

**A threaded runtime for isolated front-end code.** Isoloop runs each *isolate* (a micro-frontend, a widget, or headless logic such as a state store or a sync engine) in its own Web Worker, so no isolate can freeze, crash or read another. Isolates with a *surface* describe UI that the main thread draws; headless isolates only talk to the bus. Isolates talk only through a Kafka-style message bus with typed topics and replay, so an isolate that restarts rebuilds its state from the log.

Status: **pre-release, on the way to 0.1.** Done: M0–M3, M2b–M2d, M3e–M3i, and M4's agents and devtools epics. That's the kernel (loader, supervisor, frame-batched compositor on our own render bridge), the log bus (its own worker, typed topics, replay, backpressure, opt-in suspension, persistent topics in OPFS), worker pools for headless and visual isolates, the Preact and React adapters, the experimental balancer, tools for agents (`kernel.request`, the `isoloop` CLI with a dev MCP server, `@isoloop/webmcp`) and the devtools panel on the inspection feed, with CI on Chromium, Firefox and WebKit. Prereleases are on npm under the `next` tag (`0.1.0-next.6`, 2026-11-19); there's no stable release yet. Next: M4c (the docs site), then M4d (the API freeze and `0.1.0`), with M3j (balancer gaps) alongside; after 0.1, the Vue, Svelte and Solid adapters (M6), WebMCP to stable once it ships (M7) and the shared-memory engine (M5). The design: [RFC 0001](docs/rfcs/0001-threaded-runtime.md), the [system design](docs/design/system-design.md), [ADRs](docs/adr/README.md) and [milestone plans](docs/plans/README.md).

## Run the demo

**Live:** [isoloop.dev/examples/basic](https://isoloop.dev/examples/basic/). Four isolates on three event loops: A and B on their own workers, C and D sharing a pool. Block one, crash one, or block the main thread, and watch what keeps running. Blocking C stalls D too, since a pool is a unit of failure; crash D and it rebuilds its log from the bus when it restarts.

The source is in [`apps/basic`](https://github.com/isoloop/web/tree/060c6318108d0fce4ddf319093a2e7c0cb2c3c62/apps/basic) in [isoloop/web](https://github.com/isoloop/web), the repo for the website and every example, which installs Isoloop from npm the way any app would. Locally, from a clone of that repo:

```sh
pnpm install
pnpm --filter basic dev
```

## Install

There's no stable release yet. The prereleases are on npm under the `next` tag (`0.1.0-next.6` as of 2026-11-19). A minimal app, like the [basic example](https://github.com/isoloop/web/tree/main/apps/basic), needs the host, the runtime and the bus, a [Standard Schema](https://standardschema.dev) library for topic schemas (basic uses Zod), and, with Vite, the plugin:

```sh
pnpm add @isoloop/host@next @isoloop/runtime@next @isoloop/bus@next zod
pnpm add -D @isoloop/vite@next
```

Add `@isoloop/react@next` or `@isoloop/preact@next` for an adapter. What the page and the servers must serve is in the [hosting guide](docs/guide/hosting.md).

## The comparison

The [markets dashboard](https://github.com/isoloop/web/tree/main/apps/dashboards/markets), built from one source as native + workers (the data engines in workers, the widgets on the main thread) and on Isoloop with `matched` placement (the same engines as their own workers, plus one pool for every widget): 6 workers against 7. Measured on a dedicated machine (AMD Ryzen 7 5825U, four cores fixed at 2.0 GHz) in Chromium, with `@isoloop/*@0.0.0-next.b8ffdcf`, 5 interleaved rounds, medians ([write-up and method](https://github.com/isoloop/web/blob/main/apps/dashboards/markets/comparison/final/README.md)). Δ is Isoloop minus native; lower is better for every row:

| Figure | Normal: native + workers | Normal: Isoloop | Δ | Heavy: native + workers | Heavy: Isoloop | Δ |
| --- | --- | --- | --- | --- | --- | --- |
| Late frames (of about 600) | 0 | 0 | 0 | 205 | 0 | −205 |
| Typing | 35 ms | 41 ms | +7 ms | 156 ms | 41 ms | −115 ms |
| Main-thread CPU | 86% | 21% | −65 points | 100% | 23% | −77 points |
| CPU, all threads | 103% | 108% | +4 points | 114% | 143% | +29 points |
| Memory after GC (16 s) | 188 MB | 222 MB | +33 MB | 246 MB | 301 MB | +52 MB |
| First data | 249 ms | 383 ms | +125 ms | 362 ms | 527 ms | +212 ms |

At Normal both builds keep every frame and Isoloop types 7 ms slower. At Heavy native + workers fills the main thread and drops about a third of its frames, and Isoloop keeps them. Either way Isoloop costs more CPU across threads, more memory and later first data. The write-up also has Firefox, the plain native build against Isoloop `one`, and `own` (a worker per widget), the most expensive placement.

The [plant dashboard](https://github.com/isoloop/web/blob/main/apps/dashboards/plant/comparison/final/README.md) (72 widgets), measured the same way: at 5 kHz on Chromium, Isoloop `one` against native types 55 ms sooner and uses 60 points less of the main thread, for 11 points more CPU across threads, 40 MB more memory and first data 187 ms later.

## Why

Today all the front-end code on a page shares one main thread, one heap and one event loop: every micro-frontend, every widget, and every headless engine such as a state store, a sync engine or a search index. One slow or broken piece makes the whole page janky or blank. Existing sandboxes (JS proxies, Shadow DOM) isolate globals and styles, not CPU time or crashes. A plain Web Worker isolates CPU time, but it leaves you to wire up how independent pieces share data.

Isoloop is built on one principle: **code that shares data shouldn't have to share an event loop.** Each isolate gets its own thread, and the only thing isolates share is a log of typed messages.

### Where it fits

Isoloop pays off when several independent pieces of code need the same data, and any one of them might be slow or might crash:

- **Heavy dashboards:** widgets that share filters, entities and lookups, where one expensive chart shouldn't stall the rest.
- **Plugin and extension hosts:** editors and design tools that run code from other teams or vendors against a shared document model.
- **AI-generated or user-authored widgets:** code you've reviewed but don't fully trust to be fast or bug-free.
- **Headless engines in heavy apps:** a sync engine, a search index and a state store working on the same entities, where a large merge or reindex shouldn't block input.
- **Dev tools and heavy development libraries:** state inspectors, query devtools and profilers that read the app's data without slowing the app they inspect. Isoloop's own devtools are an isolate.
- **Notebooks and reactive canvases:** cells that consume each other's outputs, where one runaway cell shouldn't take the session down, and a restarted cell rebuilds from the log.

### Where it doesn't

- **A single CPU-heavy task.** Use a plain worker; Isoloop adds nothing if nothing else shares the data.
- **Code that needs synchronous DOM access,** such as layout measurement or libraries that reach into `document` directly.
- **Hostile code.** Isolates run same-origin, so they share cookies and storage with the host. For code you don't trust at all, use a cross-origin iframe.
- **SSR- or SEO-first pages,** where the content has to exist before any script runs.

### Scope and focus

Isoloop runs in the browser tab, on today's browsers, with no server-side story. It is built first for heavy dashboards: they hit every part of the problem at once (shared data, expensive rendering, many independent owners), so the first adapters and the reference app target them.

## How it works

```
┌──────────────── Main thread: host kernel (only DOM writer) ─────────────────┐
│  Loader          Compositor          Bus controller         Supervisor      │
│  starts workers  patches per frame   starts and watches     heartbeats,     │
│                                      the bus worker         restarts        │
└──────▲──────────────────▲──────────────────▲─────────────────────▲──────────┘
       │ UI, events,      │                  │                     │ control
       │ heartbeats       │                  │                     │
┌──────┴──────┐    ┌──────┴──────┐    ┌──────┴──────┐    ┌─────────┴─────────┐
│ Isolate A   │    │ Isolate B   │    │ Isolate C   │    │ Bus worker        │
│ own worker  │    │ own worker  │    │ own worker  │    │ topic logs,       │
│ UI          │    │ UI          │    │ headless    │    │ schemas, offsets  │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └─────────▲─────────┘
       └──────────────────┴──────────────────┴─────────────────────┘
                 records: one MessageChannel per isolate, never via the main thread
```

- **Thread isolation:** one dedicated worker per isolate, with its own heap and event loop.
- **Single-writer rendering:** isolates render into a small DOM subset of our own in their worker; the host mirrors it to the real DOM, batched once per frame.
- **Messages as the only contract:** isolates never import each other; they depend on versioned topic schemas.
- **Log-based bus:** append-only topics with retention, consumer offsets, replay, schema validation and backpressure, running in a dedicated bus worker.
- **Pluggable log engine:** a TypeScript engine in v1; an opt-in Rust/WASM engine on `SharedArrayBuffer` later, for zero-copy reads on cross-origin-isolated pages, shipped only if benchmarks justify it.
- **Parallel charts:** canvas widgets draw with `OffscreenCanvas` inside their own worker, never touching the main thread.
- **Supervision:** heartbeats detect blocked isolates; crashed isolates restart one-for-one and replay their topics.
- **Framework-agnostic:** plain JS, Preact and React today; Vue, Svelte and Solid after 0.1 (M6).

## API sketch

```ts
// @acme/contracts: shared by host, isolates and the bus worker
import { contracts, topic } from '@isoloop/bus';
export const cartItems = topic('cart.items.v1', { schema, retention: { kind: 'compacted' } });
export default contracts(cartItems);
```

```ts
// host
import { createKernel } from '@isoloop/host';
import list from '@acme/contracts';

const kernel = createKernel({
  // Worker entry bundles from @isoloop/runtime/bootstrap and @isoloop/bus/worker, served from your origin
  workers: { isolateBootstrap: '/isoloop/bootstrap.js', bus: '/isoloop/bus-worker.js' },
  contracts: { url: '/contracts.js', list },   // the bus worker imports the same module from url
  supervisor: { strategy: 'one-for-one', maxRestarts: 3, withinMs: 60_000 },
});

// A visual isolate: renders into #cart
kernel.spawn({
  id: 'cart',
  src: 'https://cdn.example.com/cart/isolate.js',
  surface: document.querySelector('#cart')!,
  grants: { publish: ['cart.items.v1'], subscribe: ['catalog.selected.v1'] },
});

// A headless isolate: no surface, only bus traffic
kernel.spawn({
  id: 'pricing',
  src: 'https://cdn.example.com/pricing/isolate.js',
  grants: { publish: ['cart.totals.v1'], subscribe: ['cart.items.v1'] },
});
```

```tsx
// The React adapter (@isoloop/react)
import { defineIsolate, useTopic, usePublish } from '@isoloop/react';

export default defineIsolate(() => {
  const items = useTopic(cartItems, { from: 'earliest' }); // replayed after restart
  const add = usePublish(cartItems);
  return <iso-button onClick={() => add({ key: 'sku-1', value: { sku: 'sku-1', qty: 1 } })}>Add ({items.length})</iso-button>;
});
```

```ts
import { defineIsolate } from '@isoloop/runtime';

// Headless: recomputes totals whenever the cart changes
export default defineIsolate({
  start({ bus }) {
    const items = new Map();
    bus.subscribe(cartItems, (r) => {
      items.set(r.key, r.value);
      const total = [...items.values()].reduce((sum, i) => sum + i.qty * i.price, 0);
      return bus.publish(cartTotals, { key: 'current', value: { total } });
    }, { from: 'earliest' });
  },
});
```

## Roadmap

Details, dependencies and task lists are in the [plans index](docs/plans/README.md).

**Done**

1. **M0 Foundations:** pnpm workspaces, TypeScript 7, OXC (oxlint, oxfmt, tsdown), Vite 8, Vitest, Playwright, GitHub Actions; protocol types; proof of concept ported to TypeScript.
2. **M1 Kernel** (write-up: [Crashing an isolate on purpose](docs/posts/m1-crashing-an-isolate.md)): loader, supervisor, heartbeats, frame-batched compositor on our own render bridge.
3. **M2 Bus** (write-up: [A Kafka-shaped bus in a Web Worker](docs/posts/m2-bus-in-a-worker.md)): topics, schemas, retention, offsets, replay, backpressure; bus worker with the TS log engine; opt-in suspension of idle isolates.
4. **M2b Durable log:** persistent topics in OPFS that survive a bus crash or a page reload.
5. **M2c Worker pools:** opt-in named pools for headless isolates, side by side with own-worker isolates; a pool crash restarts only that pool.
6. **M2d Visual pools:** visual isolates in pools too (shipped with the plant dashboard, `plant-v0.1.0`).
7. **M3 Adapters and dashboards** (initiative): **M3a** Preact and React adapters (Preact 10 and 11, React 18 and 19); **M3b** the markets dashboard, a native app or Isoloop at the flip of a toggle, with live metrics; **M3c** Lite, Normal and Heavy sizes; **M3d** the 72-widget plant dashboard, measured against matched native builds; **M3f** markets parity, with a native + workers build and pooled placements (`markets-v0.3.0`).
8. **Website:** [isoloop.dev](https://isoloop.dev), with the landing page, how it works, the features and the live examples (in [isoloop/web](https://github.com/isoloop/web)).
9. **M3e Live widget creator:** an interactive mode for the plant and markets dashboards: add, edit and delete widgets while the page runs, each a JSON spec (a dashboard topic, fixed operators, a view) running as its own isolate. No user code. Measured both ways against native (`plant-v0.2.0`, `markets-v0.4.0`).
10. **M3g Federated comparison** ([write-up](https://github.com/isoloop/web/tree/main/apps/dashboards/markets/comparison/federated)): a native build of the markets dashboard's React + Preact version, with the Preact part shipped apart and loaded at run time the way teams combine parts today, measured against Isoloop's, with a pool per team (`markets-v0.5.0`).
11. **M3h Auto placement and M3i balancer scaling:** `@isoloop/balancer` (experimental, [guide](docs/guide/balancer.md)) places isolates by measured load, moves one out of a pool that lags, is full or has a growing backlog, packs quiet ones back, and quarantines one that blocks or crashes; shown on the processor example (`processor-v0.1.0`, `processor-v0.2.0`) and on the interactive pages.
12. **M4a Agents** (most of it): tools on contracts ([ADR 0018](docs/adr/0018-tools-for-agents.md), [guide](docs/guide/agents.md)), `kernel.request`, the `isoloop` CLI with `contracts export` and a dev MCP server (`isoloop mcp`), `@isoloop/webmcp` for Chromium's and Firefox's WebMCP (both behind a flag), tools on the markets dashboard, and the [cost per call](docs/investigations/agent-call-cost.md).
13. **M4b Devtools** ([write-up](docs/posts/m4b-devtools.md)): the inspection feed (`kernel.inspect()`, the `inspect` grant, [ADR 0020](docs/adr/0020-inspection-feed.md), [guide](docs/guide/inspection.md)) and `@isoloop/devtools`, a panel drawn by an isolate with isolates, bus and live-log views ([guide](docs/guide/devtools.md)), on plant and markets behind `?devtools=1`.

**Before 0.1**

14. **M3j Balancer gaps:** an app-reported busy time, packing and the quarantine fixed, and isolates the kernel gave up on handled, inside the balancer.
15. **M4c Docs:** the docs on isoloop.dev, with getting started, the guides, "What Isoloop can't hide", the API reference, `llms.txt` and `llms-full.txt`.
16. **M4d 0.1 release:** the API freeze, the "build with Isoloop" skill and a recorded run with a real agent (M4a), the release workflow, `0.1.0` on npm and a launch post.

**After 0.1**

17. **M6 Vue, Svelte and Solid adapters:** Vue 3 (starting with a spike), Svelte 5 and Solid 1, with the HTML parsing and `cloneNode` they need, and no change to the render format.
18. **M7 WebMCP to stable:** drop `@experimental` from `@isoloop/webmcp` once WebMCP ships in a browser.
19. **M5 Shared-memory engine:** opt-in Rust/WASM `SharedArrayBuffer` log engine, benchmarked against the TS engine.
20. **M5b Delivery batching (spike):** whether batching bus traffic across tasks gets the TS engine from 45.5k to its 50k records/s budget.

**Separately**

- **Isoloop Builder** (its own repo, a separate app): a non-technical user defines a whole page, its data sources and topics included, by asking an agent; the agent writes specs, never code, and the user previews and accepts each change.

## Repo layout

Plain pnpm workspaces. Today: `protocol`, `dom`, `host`, `runtime`, `bus`, `codec`, `react`, `preact`, `vite`, `cli` (published as `isoloop`), and the experimental `balancer`, `devtools` and `webmcp`; the rest arrives with its milestone.

```text
packages/  protocol · dom · host · runtime · bus · codec (M2b) · react, preact (M3) · vite · balancer (M3h) · cli, webmcp (M4a) · devtools (M4b) · vue, svelte, solid (M6) · bus-wasm (M5)
e2e/       Playwright suites, their harness page and the isolates they spawn (the four-loops ones included)
docs/      rfcs · design · adr · plans · guide · investigations · posts
bench/     click-to-paint, throughput
```

The examples (basic and the dashboards) and the website live in [isoloop/web](https://github.com/isoloop/web), served at [isoloop.dev](https://isoloop.dev/).

## Non-goals (v1)

Parallel painting of DOM surfaces (canvas isolates painting through `OffscreenCanvas` are the exception), replacing Module Federation for trusted code sharing, Angular support, SSR, and acting as a security boundary for hostile code (that needs an iframe tier).

## Resources

- [RFC 0001: a threaded runtime for isolated front-end code](docs/rfcs/0001-threaded-runtime.md), the motivation and public shape
- [System design](docs/design/system-design.md): packages, interfaces, sequences and invariants
- [Architecture decision records](docs/adr/README.md)
- [Implementation plans](docs/plans/README.md), one per milestone
- Guides: [hosting](docs/guide/hosting.md), [worker pools](docs/guide/pools.md), [automatic placement (balancer)](docs/guide/balancer.md), [agents](docs/guide/agents.md), [inspection feed](docs/guide/inspection.md), [devtools panel](docs/guide/devtools.md)
- [Contributing](CONTRIBUTING.md): setup, scripts, editors and conventions
- [Would like](docs/would-like.md): ideas deferred or to explore, not planned
- [Should do](docs/should-do.md): committed work waiting on a package or milestone
- Prior art: [Shopify Remote DOM](https://github.com/Shopify/remote-dom), [Neo.mjs](https://github.com/neomjs/neo), [Web Fragments](https://github.com/IgorMinar/reframed), [Aiga](https://aiga.js.org/), [Garfish](https://github.com/web-infra-dev/garfish)

## License

MIT. See [LICENSE](LICENSE).
