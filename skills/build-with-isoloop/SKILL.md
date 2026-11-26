---
name: build-with-isoloop
description: Build web app features with Isoloop (@isoloop/*), where each part runs as an isolate in a worker and talks over a typed bus. Use when setting up Isoloop, writing a widget or headless isolate in plain DOM, React or Preact, defining topics, contracts or grants, configuring the kernel, choosing pools or the balancer, exposing tools to agents, or fixing an isolate that renders nothing or gets no records.
license: MIT
---

# Build with Isoloop

An Isoloop app has three parts:

- **A contracts module:** every topic, with its schema and retention.
- **The kernel,** on the main thread: it starts the bus worker, and starts, watches and restarts isolates.
- **Isolates:** modules that each run in a worker, render through a worker DOM, and talk only through the bus.

This skill matches the `isoloop` CLI that installed it. When it and the installed packages disagree, trust the types in `node_modules/@isoloop/*/dist`. Run `npx isoloop skill add --force` after upgrading the CLI to replace it.

## Work in this order

1. Read the project's `package.json`, its Vite and TypeScript config, and its contracts module if it has one. Keep its framework and its package versions.
2. Add or reuse a topic in the contracts module.
3. Write the isolate.
4. Spawn it, with a surface if it draws, and only the grants it uses.
5. Type-check, build, and test it in a browser. A widget that type-checks can still draw nothing: check the text on the page.

## Set up

Skip what the project already has:

```sh
npm install @isoloop/host @isoloop/runtime @isoloop/bus zod
npm install -D @isoloop/vite vite typescript
```

For React add `@isoloop/react react react-dom`, with `@types/react` and `@types/react-dom`. For Preact add `@isoloop/preact preact`.

```ts
// vite.config.ts
import { isoloop } from '@isoloop/vite';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [isoloop()] });
```

For JSX, set the runtime in both configs, with `react` or `preact` as the source:

- **`vite.config.ts`:** `oxc: { jsx: { runtime: 'automatic', importSource: 'react' } }`.
- **`tsconfig.json`:** `"jsx": "react-jsx"` and `"jsxImportSource": "react"`.

TypeScript needs `"moduleResolution": "bundler"`, `"module": "esnext"`, the `DOM` lib, and these types in a file such as `src/env.d.ts`:

```ts nocheck
/// <reference types="vite/client" />
/// <reference types="@isoloop/vite/client" />
```

## Contracts

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

- **Every topic goes in the default export,** `contracts(...)`. The bus knows no other topics.
- **`retention` is required:** `{ kind: 'compacted' }` keeps the latest record per key (current state), `{ kind: 'last-n', n: 500 }` a window, `{ kind: 'time', ms: 60_000 }` a period.
- **`durability: 'persistent'`** keeps a topic across reloads and bus restarts where the browser allows it. The default is `'memory'`.
- **A name ends in its version** (`.v1`). Within a version, only add optional fields. Any other schema change is a new topic (`.v2`).
- **Names starting `isoloop.`** belong to the kernel.

## Kernel, spawn and grants

```ts
// main.ts
import { createKernel } from '@isoloop/host';
import workers from 'virtual:isoloop/workers';
import list, { cartItems } from './contracts';
import contractsUrl from './contracts?isolate';
import cart from './cart?isolate';

const kernel = createKernel({ contracts: { url: contractsUrl, list }, workers });

kernel.on('isolate:crash', (e) => console.warn(`${e.id}: ${e.reason} ${e.message}`));
kernel.on('isolate:error', (e) => console.error(`${e.id}: ${e.message}`));
kernel.on('isolate:failed', (e) => console.error(`${e.id} gave up: ${e.message}`));

kernel.spawn({
  id: 'cart',
  src: cart,
  surface: document.querySelector('#cart')!,
  grants: { publish: [], subscribe: ['cart.items.v1'] },
});

await kernel.publish(cartItems, { sku: 'tea', qty: 4 }, { key: 'tea' });
```

- **`contracts` takes both halves:** the URL from `?isolate`, for the bus worker, and the imported list, for the host.
- **An isolate module is spawned by URL.** In a Vite app that's a `?isolate` import; for a module built apart, it's that module's URL. Don't import the module itself on the main thread.
- **Without grants an isolate can use no app topic.** `publish` and `subscribe` take topic names or patterns: `*` matches one or more characters, dots included. A request needs a publish grant, and answering one a subscribe grant. `navigate: true` allows `ctx.host.navigate`.
- **Without `surface` an isolate is headless:** it has no DOM.
- **Defaults:** up to 3 restarts in 60 s (`supervisor`), "Not responding…" after 400 ms without a beat and a kill after 10 s (`heartbeat`).
- **`createKernel` throws `unsupported_browser`** where Isoloop can't run. A production page catches it and shows plain HTML.

## A widget in plain DOM

```ts
// cart.ts
import { defineIsolate } from '@isoloop/runtime';
import { cartItems } from './contracts';

export default defineIsolate<HTMLElement>({
  start(ctx) {
    const line = document.createElement('p');
    line.textContent = 'Cart is empty';
    ctx.root?.append(line);
    ctx.bus.subscribe(
      cartItems,
      (r) => {
        line.textContent = `${r.value.sku}: ${r.value.qty}`;
      },
      { from: 'earliest' },
    );
  },
});
```

Render into `ctx.root`. `document.body` in a worker is never on screen.

## A widget in React or Preact

```tsx
// cart.tsx
import { defineIsolate, useTopic } from '@isoloop/react';
import { cartItems } from './contracts';

function Cart() {
  const last = useTopic(cartItems, { from: 'earliest' });
  return <p>{last ? `${last.sku}: ${last.qty}` : 'Cart is empty'}</p>;
}

export default defineIsolate(Cart);
```

For Preact, import the same names from `@isoloop/preact`.

- **`useTopic` gives only the latest value** on the topic, not a list or a map by key.
- **`usePublish(topic)`** returns `(value, { key? }) => Promise<void>`. The isolate needs a publish grant.
- **`useIsolate()`** returns the context (`bus`, `host`, `styles`, `config` and the rest).
- **`defineIsolate` from an adapter needs a surface.** Write headless isolates with `@isoloop/runtime`.

To keep a value per key, or a history, subscribe yourself:

```tsx
import { defineIsolate, useIsolate } from '@isoloop/react';
import { useEffect, useState } from 'react';
import { cartItems } from './contracts';

function CartList() {
  const { bus } = useIsolate();
  const [items, setItems] = useState<Record<string, number>>({});
  useEffect(
    () =>
      bus.subscribe(cartItems, (r) => setItems((now) => ({ ...now, [r.value.sku]: r.value.qty })), {
        from: 'earliest',
        onReset: () => setItems({}),
      }),
    [bus],
  );
  return (
    <ul>
      {Object.entries(items).map(([sku, qty]) => (
        <li key={sku}>
          {sku}: {qty}
        </li>
      ))}
    </ul>
  );
}

export default defineIsolate(CartList);
```

## Rules for records

- **One `ctx.bus.subscribe` per topic in each isolate.** A second `subscribe` on the same topic replaces the first, with no error, and so does a `subscribe` beside a `useTopic` on that topic. Any number of components can `useTopic` the same topic: they share one subscription.
- **The default start is `latest`,** which is new records only. A widget that shows current state uses `from: 'earliest'`, so it also has it after a restart. A handler with side effects uses `from: 'committed'`.
- **Delivery is at least once.** Make handlers idempotent.
- **A restart loses the isolate's own state.** Keep what must survive in a topic and read it back on start.
- **Never share state through globals or imports between isolates.** Each worker has its own copy of a module.
- **`publish` rejects with a `BusError`,** whose `code` says why: `forbidden` is a missing grant, `invalid` a value the schema refused, `unknown_topic` a topic missing from the contracts.

## What Isoloop can't hide

Isolate code runs in a worker, so check it against this list:

- **No synchronous layout.** `getBoundingClientRect`, `offsetWidth`, `getComputedStyle`, `animate` and the like throw `NotSupportedError`. Use `await ctx.host.measure(node)`.
- **No `focus()`, selection or `contenteditable`.** Use `ctx.host.focus(node)` and `ctx.host.scrollIntoView(node)`.
- **No page globals:** no page `window`, `matchMedia`, `history`, `localStorage` or `sessionStorage`. `fetch` and IndexedDB work.
- **Only these HTML tags are created:** `div span p pre code strong em small br hr h1` to `h6`, `ul ol li`, `a img`, `table caption colgroup col thead tbody tfoot tr th td`, `form fieldset legend label input textarea select optgroup option button output progress meter`, `canvas`. Anything else, `section`, `header` and `time` included, becomes a `div`, so don't style or query it by that tag. The exception is a custom element the app lists in `createKernel`'s `components`. SVG has shapes, text, gradients, clips and masks.
- **Attributes are allow-listed.** `class`, `id`, `title`, `role`, `tabindex`, `hidden`, `style`, `aria-*` and `data-*` work on any element, with the usual form, link, image and table attributes on theirs. URLs are `http(s):`, `mailto:` or relative: no `data:` or `blob:` images.
- **The page's CSS doesn't reach inside a surface,** which is a shadow root. Pass `styles: [sheet]` (a `CSSStyleSheet`) to `createKernel`, or call `ctx.styles(css)` in the isolate, and style by class. A `style` attribute works under `style-src 'self'`: the page applies it through the CSSOM, which CSP doesn't govern.
- **Portals go to `ctx.portalRoot`** (`usePortalRoot()`), never to `document.body`.
- **Events arrive a moment later.** `preventDefault()` is too late (the page prevents `submit` itself), `isTrusted` is false, and drag and drop doesn't work. Only click, double click, input, change, key up and down, submit, focus in and out, pointer down, up and move, and scroll are forwarded, plus `resize` on a canvas from `requestCanvas`.
- **A focused input's value belongs to the page.** Use `ctx.setValue(node, value, { force: true })` to replace what the user is typing.
- **No server-side rendering.** What must show at first paint goes in the page's HTML.
- **It isn't a security boundary.** Isolates run on the page's origin.
- **It costs CPU, memory and start-up time,** more with each worker.

Code that needs layout on every render, or the page's DOM, stays on the main thread. Say so to the user instead of working around it.

## Tools for agents

Tools are `@experimental`. A tool is a topic with a `reply` schema and a `tool` field, which the kernel exposes and an isolate answers. The schemas must support Standard JSON Schema (Zod 4.2 or later does), so `unchecked()` can't be a tool.

```ts
// contracts.ts
import { contracts, topic } from '@isoloop/bus';
import { z } from 'zod';

export const notes = topic('notes.items.v1', {
  schema: z.object({ id: z.string(), text: z.string() }),
  retention: { kind: 'compacted' },
});

export const addNote = topic('notes.add.v1', {
  schema: z.object({ text: z.string() }),
  reply: z.object({ id: z.string() }),
  retention: { kind: 'last-n', n: 100 },
  tool: { description: 'Add a note.', readOnly: false, consequential: true },
});

export default contracts(notes, addNote);
```

```ts
// main.ts
import { createKernel } from '@isoloop/host';

createKernel({ contracts, workers, agents: { expose: ['notes.add.v1'] } });
```

```ts nocheck
// in an isolate granted subscribe on notes.add.v1 and publish on notes.items.v1
ctx.bus.subscribe(
  addNote,
  async (r) => {
    if (r.req === undefined) return; // a plain record, not a request
    const id = `note-${r.req.id}`; // the same request gives the same id
    await ctx.bus.publish(notes, { id, text: r.value.text }, { key: id });
    await ctx.bus.reply(r, { id });
  },
  { from: 'committed' },
);
```

- **Exposing is the app's choice:** a `tool` field alone exposes nothing. Expose only what the user asked for.
- **`readOnly` and `consequential` are hints.** They don't stop a call. If one needs the user's consent, the app asks in its own UI.
- **Size the topic's retention** for the largest burst of calls: calls past it get `dropped`.
- **The dev MCP** (`npx isoloop mcp`) and **WebMCP** (`connectWebMCP` from `@isoloop/webmcp`) carry the tools. Import `@isoloop/host/dev-mcp` only behind `if (import.meta.env.DEV)`.

## Placement

Each isolate gets its own worker unless told otherwise. Start there.

- **Pools:** spawn several small isolates that can fail together with the same `pool: 'name'`. They share an event loop, globals, failure and, in effect, grants. Heavy work, secrets and less trusted code keep their own worker. Read https://isoloop.dev/docs/pools.md first.
- **The balancer** (`@isoloop/balancer`, `@experimental`) is for isolates whose load you can't know ahead, such as user-added widgets. It moves them by measured load, and each move restarts the isolate. Read https://isoloop.dev/docs/balancer.md first.

## Test a widget

Use a browser test against a build (`vite build`, then `vite preview`). Surfaces are open shadow roots, so Playwright's locators find their content. Isolates start asynchronously: use retrying assertions such as `await expect(page.locator('#cart')).toContainText('tea: 4')`, never a fixed wait. Test the empty state, a record, and a record published before the widget started.

## Read more

Fetch a page when the task needs it. The index is https://isoloop.dev/llms.txt.

- **Isolates, hooks and the context:** https://isoloop.dev/docs/isolates.md
- **Topics, versions and grants:** https://isoloop.dev/docs/contracts.md
- **Subscriptions, retention, requests:** https://isoloop.dev/docs/bus.md
- **Restarts and fallbacks:** https://isoloop.dev/docs/supervision.md
- **Tools, the dev MCP and WebMCP:** https://isoloop.dev/docs/agents.md
- **Unit tests:** https://isoloop.dev/docs/testing.md
- **Production headers and workers:** https://isoloop.dev/docs/hosting.md
- **Every limit:** https://isoloop.dev/docs/limits.md
