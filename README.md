# Isoloop

[![CI](https://github.com/isoloop/isoloop/actions/workflows/ci.yml/badge.svg)](https://github.com/isoloop/isoloop/actions/workflows/ci.yml)

**A threaded runtime for isolated front-end code.** Isoloop runs each *isolate* (a micro-frontend, a widget, or headless logic such as a state store or a sync engine) in its own Web Worker, so no isolate can freeze, crash or read another. Isolates with a *surface* describe UI that the main thread draws; headless isolates only talk to the bus. Isolates talk only through a Kafka-style message bus with typed topics and replay, so an isolate that restarts rebuilds its state from the log.

Status: **M0 done, pre-release.** The proof of concept runs from the repo on a thin first host and runtime, with CI on Chromium, Firefox and WebKit; nothing is on npm yet. M1 (the real kernel) is next. The design: [RFC 0001](docs/rfcs/0001-threaded-runtime.md), the [system design](docs/design/system-design.md), [ADRs](docs/adr/README.md) and [milestone plans](docs/plans/README.md).

## Run the demo

**Live:** [isoloop.github.io/isoloop](https://isoloop.github.io/isoloop/). Four isolates, four event loops: block one, crash one, or block the main thread, and watch what keeps running.

Locally, with Node 26 and pnpm 12 ([setup](CONTRIBUTING.md#setup)):

```sh
pnpm install
pnpm dev
```

The source is in [`examples/four-loops`](examples/four-loops): each pane is an isolate module in `src/isolates/`, spawned by [`@isoloop/host`](packages/host) into a shadow-DOM surface.

## Why

Today all the front-end code on a page shares one main thread, one heap and one event loop: every micro-frontend, every widget, and every headless engine such as a state store, a sync engine or a search index. One slow or broken piece makes the whole page janky or blank. Existing sandboxes (JS proxies, Shadow DOM) isolate globals and styles, not CPU time or crashes. A plain Web Worker isolates CPU time, but it leaves you to wire up how independent pieces share data.

Isoloop is built on one principle: **code that shares data shouldn't have to share an event loop.** Each isolate gets its own thread, and the only thing isolates share is a log of typed messages.

### Where it fits

Isoloop pays off when several independent pieces of code need the same data, and any one of them might be slow or might crash:

- **Heavy dashboards:** widgets that share filters, entities and lookups, where one expensive chart shouldn't stall the rest.
- **Plugin and extension hosts:** editors and design tools that run code from other teams or vendors against a shared document model.
- **AI-generated or user-authored widgets:** code you've reviewed but don't fully trust to be fast or bug-free.
- **Headless engines in heavy apps:** a sync engine, a search index and a state store working on the same entities, where a large merge or reindex shouldn't block input.
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
┌──────────────── Main thread: host kernel (only DOM writer) ────────────────┐
│  Loader          Compositor          Bus bridge          Supervisor       │
│  starts workers  patches per frame   routes records to   heartbeats,      │
│                                      the bus worker      restarts         │
└──────────────▲──────────────────────▲──────────────────────▲───────────────┘
               │ messages only        │                      │
        ┌──────┴──────┐        ┌──────┴──────┐        ┌──────┴──────┐
        │ Isolate A   │        │ Isolate B   │        │ Isolate C   │
        │ own worker  │        │ own worker  │        │ own worker  │
        │ React UI    │        │ Preact UI   │        │ headless    │
        └─────────────┘        └─────────────┘        └─────────────┘
```

- **Thread isolation:** one dedicated worker per isolate, with its own heap and event loop.
- **Single-writer rendering:** isolates render into a small DOM subset of our own in their worker; the host mirrors it to the real DOM, batched once per frame.
- **Messages as the only contract:** isolates never import each other; they depend on versioned topic schemas.
- **Log-based bus:** append-only topics with retention, consumer offsets, replay, schema validation and backpressure, running in a dedicated bus worker.
- **Pluggable log engine:** a TypeScript engine in v1; an opt-in Rust/WASM engine on `SharedArrayBuffer` later, for zero-copy reads on cross-origin-isolated pages, shipped only if benchmarks justify it.
- **Parallel charts:** canvas widgets draw with `OffscreenCanvas` inside their own worker, never touching the main thread.
- **Supervision:** heartbeats detect blocked isolates; crashed isolates restart one-for-one and replay their topics.
- **Framework-agnostic:** adapters for Preact and React first; plain JS always works.

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
  contracts: { url: '/contracts.js', list },   // the bus worker imports the same module from url
  supervisor: { strategy: 'one-for-one', maxRestarts: 3, withinMs: 60_000 },
});

// A visual isolate: renders into #cart
kernel.spawn({
  id: 'cart',
  src: 'https://cdn.example.com/cart/isolate.js',
  surface: '#cart',
  topics: { publish: ['cart.items.v1'], subscribe: ['catalog.selected.v1'] },
});

// A headless isolate: no surface, only bus traffic
kernel.spawn({
  id: 'pricing',
  src: 'https://cdn.example.com/pricing/isolate.js',
  topics: { publish: ['cart.totals.v1'], subscribe: ['cart.items.v1'] },
});
```

```tsx
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

1. **M0 Foundations:** pnpm workspaces, TypeScript 7, OXC (oxlint, oxfmt, tsdown), Vite 8, Vitest, Playwright, GitHub Actions; protocol types; proof of concept ported to TypeScript.
2. **M1 Kernel** (done; write-up: [Crashing an isolate on purpose](docs/posts/m1-crashing-an-isolate.md)): loader, supervisor, heartbeats, frame-batched compositor on our own render bridge.
3. **M2 Bus:** topics, schemas, retention, offsets, replay, backpressure; bus worker with the TS log engine; opt-in suspension of idle isolates.
4. **M2b Durable log:** persistent topics in OPFS that survive a bus crash or a page reload. Required for 0.1.
5. **M2c Worker pools:** opt-in named pools for small headless isolates, if a benchmark shows they pay off.
6. **M3 Adapters and dashboard sandbox:** Preact and React adapters; a markets dashboard (live public exchange feeds, cross-market aggregates and alerts) that runs single-threaded or on Isoloop at the flip of a toggle, with live metrics (main-thread fps, long tasks, input latency, loop lag per worker, memory, bus throughput).
7. **M4 Devtools and 0.1:** health and bus overlay, docs site, npm release.
8. **M5 Shared-memory engine:** opt-in Rust/WASM `SharedArrayBuffer` log engine, benchmarked against the TS engine.

## Repo layout

Plain pnpm workspaces. M0 has `protocol`, `host`, `runtime`, `bus` (empty until M2) and `four-loops`; the rest arrives with its milestone.

```text
packages/  protocol · dom (M1) · host · runtime · bus · codec (M2b) · bus-wasm (M5) · react · preact · devtools
examples/  four-loops (minimal) · dashboard (flagship sandbox)
docs/      site + rfcs/
bench/     click-to-paint, throughput, memory per isolate
```

## Non-goals (v1)

Parallel painting of DOM surfaces (canvas isolates painting through `OffscreenCanvas` are the exception), replacing Module Federation for trusted code sharing, Angular support, SSR, and acting as a security boundary for hostile code (that needs an iframe tier).

## Resources

- [RFC 0001: a threaded runtime for isolated front-end code](docs/rfcs/0001-threaded-runtime.md), the motivation and public shape
- [System design](docs/design/system-design.md): packages, interfaces, sequences and invariants
- [Architecture decision records](docs/adr/README.md)
- [Implementation plans](docs/plans/README.md), one per milestone
- [Contributing](CONTRIBUTING.md): setup, scripts, editors and conventions
- [Would like](docs/would-like.md): ideas deferred or to explore, not planned
- Prior art: [Shopify Remote DOM](https://github.com/Shopify/remote-dom), [Neo.mjs](https://github.com/neomjs/neo), [Web Fragments](https://github.com/IgorMinar/reframed), [Aiga](https://aiga.js.org/), [Garfish](https://github.com/web-infra-dev/garfish)

## License

MIT. See [LICENSE](LICENSE).
