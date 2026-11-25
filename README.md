<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://isoloop.dev/brand/expressive-dark.svg">
    <img src="https://isoloop.dev/brand/expressive.svg" alt="" width="160">
  </picture>
</p>

<h1 align="center">Isoloop</h1>

<h3 align="center">Event-loop isolation for JavaScript apps</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@isoloop/runtime"><img alt="npm" src="https://img.shields.io/npm/v/@isoloop/runtime?style=for-the-badge&label=npm&color=2f57cc"></a>
  <a href="https://github.com/isoloop/isoloop/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/isoloop/isoloop/ci.yml?branch=main&style=for-the-badge&label=CI"></a>
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/github/license/isoloop/isoloop?style=for-the-badge&color=6e46c2"></a>
  <img alt="Written in TypeScript" src="https://img.shields.io/badge/TypeScript-strict-0b7480?style=for-the-badge">
  <img alt="Status: early (0.x)" src="https://img.shields.io/badge/status-early%20(0.x)-b75400?style=for-the-badge">
</p>

<p align="center">
  <a href="https://isoloop.dev">Website</a> •
  <a href="https://isoloop.dev/features/">Features</a> •
  <a href="https://isoloop.dev/examples/">Examples</a> •
  <a href="https://isoloop.dev/docs/">Guide</a> •
  <a href="docs/adr/README.md">ADRs</a>
</p>

Isoloop is an open-source TypeScript library. Each part of your app (a React or Preact UI tree, plain DOM, or a headless task) runs as an *isolate*, on its own worker or in a shared pool. Isolates talk only through a message bus with typed topics, retention and replay. When one blocks or crashes, the rest of the app keeps running; the supervisor restarts it, and it rebuilds its state from the bus.

**0.1 is the first release.** The parts marked experimental may change in any minor, and only the latest release is supported ([Limits](https://isoloop.dev/docs/limits/)). What's done and what's next: [Roadmap](#roadmap).

See it run: the [basic example](https://isoloop.dev/examples/basic/), four isolates on three event loops, live.

## Why

In most apps, all the code shares one main thread, one heap and one event loop: every widget, every micro-frontend, and every headless engine such as a state store, a sync engine or a search index. One slow or broken part makes the whole app janky or blank. Sandboxes isolate globals and styles, not CPU time or crashes. A plain worker isolates CPU time, but leaves you to wire up how independent parts share data, and what happens when one of them fails.

Isoloop is built on one principle: **code that shares data shouldn't have to share an event loop.** Parts run apart, and the only thing they share is a log of typed messages.

Where it fits and what it gives: [Features](https://isoloop.dev/features/).

## Getting started

A minimal app needs the host, the runtime and the bus, a [Standard Schema](https://standardschema.dev) library for the topic schemas (Zod here), and, with Vite, the plugin:

```sh
npm install @isoloop/host @isoloop/runtime @isoloop/bus zod
npm install -D @isoloop/vite
```

For a React or Preact isolate, add `@isoloop/react` or `@isoloop/preact`. pnpm and yarn work the same way (`pnpm add`, `yarn add`).

**1. The contracts:** one module of topics, shared by the host, the isolates and the bus worker, which validates every record against it.

```ts
// contracts.ts
import { contracts, topic } from '@isoloop/bus';
import { z } from 'zod';

export const cartItems = topic('cart.items.v1', {
  schema: z.object({ sku: z.string(), qty: z.number().int().positive() }),
  retention: { kind: 'compacted' },
});

export default contracts(cartItems);
```

**2. The host:** the kernel on the main thread starts the bus and the isolates, and supervises them.

```ts
// main.ts, with isoloop() from '@isoloop/vite' in vite.config.ts
import { createKernel } from '@isoloop/host';
import workers from 'virtual:isoloop/workers';
import list from './contracts';
import contractsUrl from './contracts?isolate';
import cart from './cart?isolate';

const kernel = createKernel({
  contracts: { url: contractsUrl, list },
  workers,
  supervisor: { strategy: 'one-for-one', maxRestarts: 3, withinMs: 60_000 },
});

kernel.spawn({
  id: 'cart',
  src: cart,
  surface: document.querySelector('#cart')!,
  grants: { publish: ['cart.items.v1'], subscribe: ['cart.items.v1'] },
  // pool: 'widgets', to share one worker with other isolates instead
});
```

**3. An isolate:** here a React component, rendered in its own worker and drawn by the host.

```tsx
// cart.tsx
import { defineIsolate, usePublish, useTopic } from '@isoloop/react';
import { cartItems } from './contracts';

function Cart() {
  // The latest value. After a restart, it's read again from the log.
  const last = useTopic(cartItems, { from: 'earliest' });
  const add = usePublish(cartItems);
  return (
    <button onClick={() => void add({ sku: 'sku-1', qty: 1 }, { key: 'sku-1' })}>
      Add · last: {last ? `${last.qty} × ${last.sku}` : 'none'}
    </button>
  );
}

export default defineIsolate(Cart);
```

What the page and its servers must send is in the [hosting guide](https://isoloop.dev/docs/hosting/). The [basic example](https://github.com/isoloop/web/tree/main/apps/basic) is a complete app in plain DOM.

## How it works

```mermaid
flowchart TB
  subgraph main["Main thread: the host kernel, the only DOM writer"]
    direction LR
    loader["Loader<br/>starts workers"]
    compositor["Compositor<br/>applies patches once per frame"]
    supervisor["Supervisor<br/>heartbeats, restarts"]
  end
  subgraph own["Its own worker"]
    A["A: visual isolate"]
  end
  subgraph pool["A pool: one shared worker"]
    B["B: visual isolate"]
    C["C: headless isolate"]
  end
  bus[("Bus worker<br/>topic logs, schemas, offsets")]
  compositor <-- "UI patches, events" --> A
  compositor <-- "UI patches, events" --> B
  supervisor -. "heartbeats, restart" .-> own
  supervisor -. "heartbeats, restart" .-> pool
  A <== "records, one channel per isolate" ==> bus
  B <== "records" ==> bus
  C <== "records" ==> bus
```

Records go straight between each isolate and the bus worker, never through the main thread.

- **Placement:** each isolate runs on its own worker, with its own heap and event loop, or with others in a named [pool](https://isoloop.dev/docs/pools/), which saves memory and start-up time and shares one loop. A pool is a unit of failure: a member that blocks restarts the whole pool. The experimental [balancer](https://isoloop.dev/docs/balancer/) can place isolates by measured load.
- **Rendering:** isolates render into a small DOM subset of our own in their worker, and the host applies the changes to the real DOM, batched once per frame. Canvas isolates draw with `OffscreenCanvas` in their own worker.
- **Messages are the only contract:** isolates never import each other. They depend on versioned topics, validated in the bus worker, and each isolate's grants list the topics it may publish and subscribe to.
- **The bus is a log:** append-only topics with retention, consumer offsets, replay and backpressure. Persistent topics are kept in OPFS and survive a reload.
- **Supervision:** heartbeats find a blocked isolate. A blocked or crashed isolate restarts one-for-one, and each subscription starts again where its `from` says: `latest`, `earliest` or `committed`.
- **Frameworks:** plain DOM, Preact and React today; Vue, Svelte and Solid after 0.1 (M6).

The diagrams on [isoloop.dev/how-it-works](https://isoloop.dev/how-it-works/) and in [`docs/diagrams`](docs/diagrams/README.md) go into each step.

## Limits

- **Not a security boundary.** Isolates run same-origin, so they share cookies and storage with the host. For code you don't trust at all, use a cross-origin iframe.
- **No synchronous DOM access** from an isolate: layout measurement, or libraries that reach into `document` directly.
- **No SSR.** Content appears once the isolates have started.
- **A single CPU-heavy task** needs only a plain worker. Isoloop adds nothing when nothing else shares the data.
- **Runs in browsers today.**
- **Only the latest release is supported.** Fixes ship in `latest`; [how](docs/adr/0019-versioning-and-releases.md#9-what-is-supported-amended-2026-11-23).
- **It costs CPU, memory and start-up time** compared with native code: [the measurements](https://isoloop.dev/#costs).

More on [isoloop.dev](https://isoloop.dev/#limits).

## Roadmap

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/roadmap-dark.svg">
  <img src="docs/assets/roadmap-light.svg" alt="Releases: 0.1, the core (out): kernel, bus and durable log, worker pools, devtools and agent tools. 0.2, watchers: current values beside streams. 0.3, bus pacing: fewer messages per record, watchers in pools. 0.4, shared memory and Tauri. 0.5, WebMCP to stable, if WebMCP has shipped by then; otherwise the adapters move up one. 0.6 to 0.8, Vue, Svelte and Solid adapters. 1.0, a stable API. 2.0, beyond the browser: Node, Bun and server-side rendering." width="520">
</picture>

The order and the reasoning are in the [roadmap](docs/plans/roadmap.md), and each milestone's plan and status are in the [plans index](docs/plans/README.md).

## Docs

- **Guides:** [hosting](https://isoloop.dev/docs/hosting/), [worker pools](https://isoloop.dev/docs/pools/), [automatic placement (balancer)](https://isoloop.dev/docs/balancer/), [agents](https://isoloop.dev/docs/agents/), [inspection feed](https://isoloop.dev/docs/inspection/), [devtools panel](https://isoloop.dev/docs/devtools/)
- [RFC 0001: the threaded runtime](docs/rfcs/0001-threaded-runtime.md), the motivation and public shape
- [System design](docs/design/system-design.md): packages, interfaces, sequences and invariants
- [Architecture decision records](docs/adr/README.md)
- [Implementation plans](docs/plans/README.md), one per milestone, with the [roadmap](docs/plans/roadmap.md) and the [history](docs/plans/history.md)
- [Contributing](CONTRIBUTING.md): setup, scripts, repo layout and conventions
- Prior art: [Shopify Remote DOM](https://github.com/Shopify/remote-dom), [Neo.mjs](https://github.com/neomjs/neo), [Web Fragments](https://github.com/IgorMinar/reframed), [Aiga](https://aiga.js.org/), [Garfish](https://github.com/web-infra-dev/garfish)

## License

MIT. See [LICENSE](LICENSE).
