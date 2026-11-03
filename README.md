# Federa

> Working name; the npm package name is still to be confirmed.

**A threaded runtime for isolated UI panes.** Federa runs every micro-frontend ("pane") in its own Web Worker, so no pane can freeze, crash or read another. The main thread does one job: drawing what panes describe. Panes talk only through a Kafka-style message bus with typed topics and replay, so a pane that restarts rebuilds its state from the log.

Status: **design stage.** [RFC 0001](docs/rfcs/0001-threaded-runtime.md) is drafted and a proof of concept works; M0 (repo foundations) is next.

## Why

Today every micro-frontend shares one main thread, one heap and one event loop. One slow or broken pane makes the whole page janky or blank. Existing sandboxes (JS proxies, Shadow DOM) isolate globals and styles, not CPU time or crashes.

Federa is built first for **heavy dashboards**: widgets that share data (filters, entities, lookups) but shouldn't share an event loop. It also fits any UI you don't fully control, such as third-party extensions or AI-generated widgets.

## How it works

```
┌──────────────── Main thread: host kernel (only DOM writer) ────────────────┐
│  Loader          Compositor          Bus bridge          Supervisor       │
│  starts workers  patches per frame   routes records to   heartbeats,      │
│                                      the bus worker      restarts         │
└──────────────▲──────────────────────▲──────────────────────▲───────────────┘
               │ messages only        │                      │
        ┌──────┴──────┐        ┌──────┴──────┐        ┌──────┴──────┐
        │ Pane A      │        │ Pane B      │        │ Pane C      │
        │ own worker  │        │ own worker  │        │ own worker  │
        │ React       │        │ Preact      │        │ vanilla     │
        └─────────────┘        └─────────────┘        └─────────────┘
```

- **Thread isolation:** one dedicated worker per pane, with its own heap and event loop.
- **Single-writer rendering:** panes render into a remote tree (built on Shopify Remote DOM); the host mirrors it to the DOM, batched once per frame.
- **Messages as the only contract:** panes never import each other; they depend on versioned topic schemas.
- **Log-based bus:** append-only topics with retention, consumer offsets, replay, schema validation and backpressure, running in a dedicated bus worker.
- **Pluggable log engine:** a TypeScript engine in v1; an opt-in Rust/WASM engine on `SharedArrayBuffer` later, for zero-copy reads on cross-origin-isolated pages, shipped only if benchmarks justify it.
- **Parallel charts:** canvas widgets draw with `OffscreenCanvas` inside their own worker, never touching the main thread.
- **Supervision:** heartbeats detect blocked panes; crashed panes restart one-for-one and replay their topics.
- **Framework-agnostic:** adapters for Preact and React first; plain JS always works.

## API sketch

```ts
import { createKernel, topic } from '@federa/host';

const cartItems = topic('cart.items.v1', { schema, retention: { kind: 'compacted' } });

const kernel = createKernel({
  topics: [cartItems],
  supervisor: { strategy: 'one-for-one', maxRestarts: 3, withinMs: 60_000 },
});

kernel.mount('#cart', {
  id: 'cart',
  src: 'https://cdn.example.com/cart/pane.js',
  topics: { publish: ['cart.items.v1'], subscribe: ['catalog.selected.v1'] },
});
```

```tsx
import { definePane, useTopic, usePublish } from '@federa/react';

export default definePane(() => {
  const items = useTopic(cartItems, { from: 'earliest' }); // replayed after restart
  const add = usePublish(cartItems);
  return <fed-button onClick={() => add({ key: 'sku-1', value: { sku: 'sku-1', qty: 1 } })}>Add ({items.length})</fed-button>;
});
```

## Roadmap

1. **M0 Foundations:** pnpm workspaces, TypeScript, Vite, Vitest, Playwright, GitHub Actions; protocol types; proof of concept ported to TypeScript.
2. **M1 Kernel:** loader, supervisor, heartbeats, frame-batched compositor on Remote DOM.
3. **M2 Bus:** topics, schemas, retention, offsets, replay, backpressure; bus worker with the TS log engine.
4. **M3 Adapters and dashboard sandbox:** Preact and React adapters; a sales dashboard that runs single-threaded or on Federa at the flip of a toggle, with live metrics (main-thread fps, long tasks, input latency, loop lag per worker, memory, bus throughput).
5. **M4 Devtools and 0.1:** health and bus overlay, docs site, npm release.
6. **M5 Shared-memory engine:** opt-in Rust/WASM `SharedArrayBuffer` log engine, benchmarked against the TS engine.

## Planned repo layout

Plain pnpm workspaces.

```text
packages/  protocol · host · pane · bus · bus-wasm (M5) · react · preact · devtools
examples/  four-loops (minimal) · dashboard (flagship sandbox)
docs/      site + rfcs/
bench/     click-to-paint, throughput, memory per pane
```

## Non-goals (v1)

Parallel painting of DOM panes (canvas panes painting through `OffscreenCanvas` are the exception), replacing Module Federation for trusted code sharing, Angular support, SSR, and acting as a security boundary for hostile code (that needs an iframe tier).

## Resources

- [RFC 0001: a threaded runtime for isolated UI panes](docs/rfcs/0001-threaded-runtime.md), the full design
- Prior art: [Shopify Remote DOM](https://github.com/Shopify/remote-dom), [Neo.mjs](https://github.com/neomjs/neo), [Web Fragments](https://github.com/IgorMinar/reframed), [Aiga](https://aiga.js.org/), [Garfish](https://github.com/web-infra-dev/garfish)

## License

MIT. See [LICENSE](LICENSE).
