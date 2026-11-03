# Isoloop

**A threaded runtime for isolated front-end code.** Isoloop runs each *isolate* (a micro-frontend, a widget, or headless logic such as a state store or a sync engine) in its own Web Worker, so no isolate can freeze, crash or read another. Isolates with a *surface* describe UI that the main thread draws; headless isolates only talk to the bus. Isolates talk only through a Kafka-style message bus with typed topics and replay, so an isolate that restarts rebuilds its state from the log.

Status: **design stage, no code in this repo yet.** The design is written: [RFC 0001](docs/rfcs/0001-threaded-runtime.md), the [system design](docs/design/system-design.md), [ADRs](docs/adr/README.md) (6 accepted, 2 under review) and [milestone plans](docs/plans/README.md). A single-file proof of concept works and gets ported in M0 (repo foundations), which is next.

## Why

Today every micro-frontend shares one main thread, one heap and one event loop. One slow or broken isolate makes the whole page janky or blank. Existing sandboxes (JS proxies, Shadow DOM) isolate globals and styles, not CPU time or crashes.

Isoloop is built first for **heavy dashboards**: widgets that share data (filters, entities, lookups) but shouldn't share an event loop. It also fits any UI you don't fully control, such as third-party extensions or AI-generated widgets.

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
- **Single-writer rendering:** isolates render into a remote tree (built on Shopify Remote DOM); the host mirrors it to the DOM, batched once per frame.
- **Messages as the only contract:** isolates never import each other; they depend on versioned topic schemas.
- **Log-based bus:** append-only topics with retention, consumer offsets, replay, schema validation and backpressure, running in a dedicated bus worker.
- **Pluggable log engine:** a TypeScript engine in v1; an opt-in Rust/WASM engine on `SharedArrayBuffer` later, for zero-copy reads on cross-origin-isolated pages, shipped only if benchmarks justify it.
- **Parallel charts:** canvas widgets draw with `OffscreenCanvas` inside their own worker, never touching the main thread.
- **Supervision:** heartbeats detect blocked isolates; crashed isolates restart one-for-one and replay their topics.
- **Framework-agnostic:** adapters for Preact and React first; plain JS always works.

## API sketch

```ts
import { createKernel, topic } from '@isoloop/host';

const cartItems = topic('cart.items.v1', { schema, retention: { kind: 'compacted' } });

const kernel = createKernel({
  topics: [cartItems],
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

1. **M0 Foundations:** pnpm workspaces, TypeScript, Vite, Vitest, Playwright, GitHub Actions; protocol types; proof of concept ported to TypeScript.
2. **M1 Kernel:** loader, supervisor, heartbeats, frame-batched compositor on Remote DOM.
3. **M2 Bus:** topics, schemas, retention, offsets, replay, backpressure; bus worker with the TS log engine; opt-in suspension of idle isolates.
4. **M2b Durable log:** persistent topics in OPFS that survive a bus crash or a page reload. Required for 0.1.
5. **M2c Worker pools:** opt-in named pools for small headless isolates, if a benchmark shows they pay off.
6. **M3 Adapters and dashboard sandbox:** Preact and React adapters; a sales dashboard that runs single-threaded or on Isoloop at the flip of a toggle, with live metrics (main-thread fps, long tasks, input latency, loop lag per worker, memory, bus throughput).
7. **M4 Devtools and 0.1:** health and bus overlay, docs site, npm release.
8. **M5 Shared-memory engine:** opt-in Rust/WASM `SharedArrayBuffer` log engine, benchmarked against the TS engine.

## Planned repo layout

Plain pnpm workspaces.

```text
packages/  protocol · host · runtime · bus · codec (M2b) · bus-wasm (M5) · react · preact · devtools
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
- Prior art: [Shopify Remote DOM](https://github.com/Shopify/remote-dom), [Neo.mjs](https://github.com/neomjs/neo), [Web Fragments](https://github.com/IgorMinar/reframed), [Aiga](https://aiga.js.org/), [Garfish](https://github.com/web-infra-dev/garfish)

## License

MIT. See [LICENSE](LICENSE).
