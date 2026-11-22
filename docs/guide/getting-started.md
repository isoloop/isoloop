# Getting started

This page takes you from an empty Vite app to one isolate running in its own worker, talking through the bus, and restarted when it crashes.

## When to use it

Read it first, before any other guide. It sets up the three parts every Isoloop app has: a contracts module, the kernel on the main thread, and isolates. What the page and its servers must send in production is in [Hosting](hosting.md), and what Isoloop can't do inside an isolate is in [What Isoloop can't hide](limits.md).

## Install

Before 0.1, the packages are published under the `next` tag, and the API may change between prereleases.

```sh
npm install @isoloop/host@next @isoloop/runtime@next @isoloop/bus@next zod
npm install -D @isoloop/vite@next
```

- **`@isoloop/host`:** the kernel, on the main thread.
- **`@isoloop/runtime`:** what runs inside each isolate's worker.
- **`@isoloop/bus`:** topics, contracts and the bus worker.
- **`zod`:** any [Standard Schema](https://standardschema.dev) library works for the topic schemas. Zod is the one used here.
- **`@isoloop/vite`:** the Vite plugin, for development and the build.

For a React or Preact isolate, add `@isoloop/react@next` or `@isoloop/preact@next`. pnpm and yarn work the same way (`pnpm add`, `yarn add`).

## The Vite plugin

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { isoloop } from '@isoloop/vite';

export default defineConfig({ plugins: [isoloop()] });
```

`isoloop()` gives you three things:

- **`virtual:isoloop/workers`:** the URLs of the isolate bootstrap and the bus worker, which the kernel starts.
- **`?isolate` imports:** `import url from './cart?isolate'` gives a module's URL, to spawn it. In a build, the module is emitted as its own chunk.
- **Headers in development:** the Content-Security-Policy from [Hosting](hosting.md#content-security-policy), with Vite's own needs allowed.

Add `/// <reference types="@isoloop/vite/client" />` to a `.d.ts` file in your app, so TypeScript knows those imports.

## The contracts

The contracts module lists every topic: its name, its schema and how long the bus keeps its records. The host, the isolates and the bus worker all import it, and the bus validates every record against it.

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

A topic's name ends in its version (`.v1`). A change to its schema that old records wouldn't pass is a new topic, `cart.items.v2`.

## The kernel

`createKernel` starts the bus worker on the main thread, then starts, watches and restarts each isolate you spawn.

```ts
// main.ts
import { createKernel } from '@isoloop/host';
import workers from 'virtual:isoloop/workers';
import list from './contracts';
import contractsUrl from './contracts?isolate';

const kernel = createKernel({
  contracts: { url: contractsUrl, list },
  workers,
  supervisor: { strategy: 'one-for-one', maxRestarts: 3, withinMs: 60_000 },
});
```

The options you're most likely to set first:

| Option | What it does | Default |
| --- | --- | --- |
| `contracts` | The contracts module's URL, which the bus worker imports, and its default export, which the host uses | none: without it there's no bus |
| `workers` | The isolate bootstrap's URL and the bus worker's, from `virtual:isoloop/workers` | required |
| `supervisor` | How crashed isolates restart: `strategy` (`one-for-one` or `never`), `maxRestarts` within `withinMs`, and the `backoff` between tries | one-for-one, 3 restarts in 60 s, 250 ms doubling up to 4 s |
| `heartbeat` | When a silent isolate counts as blocked (`blockedAfterMs`) and when it's killed (`killAfterMs`) | 400 ms and 10 s |
| `styles` | `CSSStyleSheet`s adopted into every surface | none |
| `components` | Host custom elements isolates may render by name, each a `HostComponent`: `{ tag, attributes? }` | none |

`createKernel` throws a `KernelError`, whose `code` is a `KernelErrorCode`, when it can't start:

- **`unsupported_browser`:** the browser lacks something Isoloop needs. Catch it and show a plain-HTML version of the page ([What Isoloop can't hide](limits.md#browsers-and-the-first-paint)).
- **`invalid_config`:** a malformed option, such as `contracts` without `workers.bus`. The message names it.

`kernel.spawn` throws a `KernelError` too, for example `invalid_manifest`, or `bus_failed` once the contracts couldn't load.

## A first isolate

An isolate is a module whose default export defines it. This one is a React component, rendered in its own worker and drawn by the host into the element you give it.

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

The component can't touch the page's DOM or read layout. It renders into a DOM inside its worker, and the host applies the changes to the page. Layout, focus and scrolling go through the async `ctx.host` calls instead ([What Isoloop can't hide](limits.md)).

## Spawning it

```ts
import cart from './cart?isolate';

kernel.spawn({
  id: 'cart',
  src: cart,
  surface: document.querySelector('#cart')!,
  grants: { publish: ['cart.items.v1'], subscribe: ['cart.items.v1'] },
});
```

- **`surface`:** the element it draws into. Without one, the isolate is headless.
- **`grants`:** the topics it may publish and subscribe to. Anything else is refused.
- **`pool`:** a name, to share one worker with other isolates instead of having one of its own ([Pools](pools.md)).

## What a crash does

Each isolate runs on its own event loop. When one throws or hangs, the others keep running, and the supervisor handles it:

1. **A crash** (an uncaught error, or the worker dying) restarts that isolate after the backoff. Its state is gone, so it reads what it needs back from the bus: `useTopic(cartItems, { from: 'earliest' })` above gets the latest cart item again.
2. **A hang** shows "Not responding…" over its surface once it misses beats for 400 ms, and is killed and restarted after 10 s.
3. **Past the restart limit** (3 in 60 s by default), it stays down as `failed`, and its surface shows a fallback with a Retry button.

```ts
kernel.on('isolate:crash', (e) => console.warn(`${e.id} crashed (${e.reason}): ${e.message}`));
kernel.on('isolate:failed', (e) => console.error(`${e.id} gave up: ${e.message}`));
```

## For agents working on your app

The `isoloop` CLI carries a "build with Isoloop" skill, in the [Agent Skills](https://agentskills.io) format, that teaches a coding agent contracts, isolates, grants and the limits. Install the CLI (it needs Node 26 or later) and copy the skill into your project:

```sh
npm install -D isoloop@next
npx isoloop skill add
```

- **Where it goes:** `.claude/skills/build-with-isoloop/SKILL.md`. For an agent that reads skills from another folder, pass `--dir <folder>`.
- **After an upgrade:** the skill is the installed CLI's, so run the command again. It doesn't replace a copy that differs, such as one you edited, unless you pass `--force`.

For agents without skills, paste this into your app's `AGENTS.md`, so they follow the rules an isolate has to keep:

```md
## Isoloop

This app runs its parts as Isoloop isolates, each on its own worker. Docs: https://github.com/isoloop/isoloop/tree/main/docs/guide

- Isolates talk only through bus topics declared in the contracts module, and only on the topics their `grants` allow. Never share state through globals or the page.
- A topic name ends in its version (`.v1`). A schema change that old records wouldn't pass is a new topic.
- Handlers are idempotent: after a crash the bus can deliver a record again.
- Inside an isolate there's no page DOM, no layout and no `localStorage`. Layout reads throw `NotSupportedError`; use the async `ctx.host` calls (`measure`, `focus`, `scrollIntoView`).
- An isolate can crash and restart at any time. Keep what must survive in the bus, and read it back on start.
```

## Limits

- **No server-side rendering.** An isolate's content appears once its worker has started and rendered, so anything that must be there at first paint goes in the page's own HTML ([What Isoloop can't hide](limits.md#browsers-and-the-first-paint)).
- **The cost:** every isolate on its own worker adds CPU, memory and start-up time. Pools trade some of that for shared failure ([Pools](pools.md)).

## See also

- [Hosting](hosting.md): headers, CSP and CORS for production.
- [What Isoloop can't hide](limits.md): what works differently inside an isolate.
- [Pools](pools.md): several isolates in one worker.
- [Agents](agents.md): tools for agents, the dev MCP and WebMCP.
