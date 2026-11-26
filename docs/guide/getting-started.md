# Getting started

This page takes you from an empty Vite app to one isolate running in its own worker, talking through the bus, and restarted when it crashes.

## When to use it

Read it first, before any other guide. It sets up the three parts every Isoloop app has: a contracts module, the kernel on the main thread, and isolates. What the page and its servers must send in production is in [Hosting](hosting.md), and what Isoloop can't do inside an isolate is in [What Isoloop can't hide](limits.md).

## Install

On 0.x a minor release (0.2, 0.3) may contain breaking changes, and a patch doesn't. Only the latest release is supported: see [Limits](limits.md#only-the-latest-release-is-supported).

```sh
npm install @isoloop/host @isoloop/runtime @isoloop/bus zod
npm install -D @isoloop/vite

# or with pnpm
pnpm add @isoloop/host @isoloop/runtime @isoloop/bus zod
pnpm add -D @isoloop/vite
```

- **`@isoloop/host`:** the kernel, on the main thread.
- **`@isoloop/runtime`:** what runs inside each isolate's worker.
- **`@isoloop/bus`:** topics, contracts and the bus worker.
- **`zod`:** any [Standard Schema](https://standardschema.dev) library works for the topic schemas. Zod is the one used here.
- **`@isoloop/vite`:** the Vite plugin, for development and the build.

For a React or Preact isolate, add `@isoloop/react` or `@isoloop/preact`. yarn works the same way (`yarn add`).

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
  supervisor: { strategy: 'one-for-one', maxRestarts: 3, withinMs: 60_000, healthyAfterMs: 60_000 },
});
```

The options you're most likely to set first:

| Option | What it does | Default |
| --- | --- | --- |
| `contracts` | The contracts module's URL, which the bus worker imports, and its default export, which the host uses | none: without it there's no bus |
| `workers` | The isolate bootstrap's URL and the bus worker's, from `virtual:isoloop/workers` | required |
| `supervisor` | How crashed isolates restart: `strategy` (`one-for-one` or `never`), `maxRestarts` within `withinMs` or in a row after runs shorter than `healthyAfterMs`, and the `backoff` between tries | one-for-one, 3 restarts in 60 s or 3 in a row after runs shorter than 60 s, 250 ms doubling up to 4 s |
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
3. **Past the restart limit** (by default, a 4th crash unless it ran 60 s or more before one of them), it stays down as `failed`, and its surface shows a fallback with a Retry button.

```ts
kernel.on('isolate:crash', (e) => console.warn(`${e.id} crashed (${e.reason}): ${e.message}`));
kernel.on('isolate:failed', (e) => console.error(`${e.id} gave up: ${e.message}`));
```

## For agents working on your app

The `isoloop` CLI carries a "build with Isoloop" skill, in the [Agent Skills](https://agentskills.io) format, that teaches a coding agent contracts, isolates, grants and the limits. Install the CLI (it needs Node 24 or later) and copy the skill into your project:

```sh
npm install -D isoloop
npx isoloop skill add
```

- **Where it goes:** `.claude/skills/build-with-isoloop/SKILL.md`. For an agent that reads skills from another folder, pass `--dir <folder>`.
- **After an upgrade:** the skill is the installed CLI's, so run the command again. It doesn't replace a copy that differs, such as one you edited, unless you pass `--force`.

For agents without skills, paste this into your app's `AGENTS.md`, so they follow the rules an isolate has to keep:

```md
## Isoloop

This app runs its parts as Isoloop isolates, each on its own worker. Docs: https://isoloop.dev/llms.txt

- Isolates talk only through bus topics declared in the contracts module, and only on the topics their `grants` allow. Never share state through globals or the page.
- A topic name ends in its version (`.v1`). A schema change that old records wouldn't pass is a new topic.
- Handlers are idempotent: after a crash the bus can deliver a record again.
- Inside an isolate there's no page DOM, no layout and no `localStorage`. Layout reads throw `NotSupportedError`; use the async `ctx.host` calls (`measure`, `focus`, `scrollIntoView`).
- An isolate can crash and restart at any time. Keep what must survive in the bus, and read it back on start.
```

## Upgrading

On 0.x a minor release can change an API. When one does, the `isoloop` CLI rewrites your code for it. Run it from the newest CLI before you upgrade the packages, because the CLI installed in your project is the old one:

```sh
# Show the changes as a diff, and change nothing
npx isoloop@latest migrate

# Make the changes
npx isoloop@latest migrate --write
```

- **Where it starts:** the `@isoloop/*` version installed in your project, found in the nearest `node_modules`. If you've already upgraded, pass the version you came from: `npx isoloop@latest migrate --from 0.1`.
- **Where it stops:** the newest release it knows, or the one you name: `npx isoloop@latest migrate 0.2`.
- **What it reads:** the `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` and `.cjs` files under the working directory, or under `--dir <folder>`, outside `node_modules` and folders whose names start with a dot. It changes only the code it rewrites, so your formatting and comments stay.
- **What it can't rewrite safely** gets a `// isoloop-migrate:` comment on the line above, and the run lists each one with its file and line. Fix those by hand and delete the comments.
- **A file that doesn't parse** is left as it is and listed, and the command exits 1.

The diff goes to stdout and everything else to stderr, so `npx isoloop@latest migrate > migrate.patch` saves a patch that `git apply` reads.

### From 0.1 to 0.2

`ctx.bus.publish` and `kernel.publish` take the value first and the key in an options object, like `request`, `reply` and `usePublish`:

```diff
- ctx.bus.publish(prices, { value: 102, key: 'AAPL' });
+ ctx.bus.publish(prices, 102, { key: 'AAPL' });
```

An isolate built in a separate project on 0.1 keeps the old `ctx.bus.publish` in a 0.2 host until that project upgrades ([isolates built apart](isolates.md#isolates-built-apart)); `kernel.publish` changes at once.

- **What it rewrites:** a `.publish(topic, { value, key })` call whose second argument is an object literal holding `value` and at most `key`, or a conditional whose two branches are such object literals with the same `value` (`k === undefined ? { value } : { key: k, value }` becomes `value, k === undefined ? {} : { key: k }`). The receiver is named `bus` or `kernel`, as a variable or the last member of a chain (`ctx.bus`, a destructured `bus`, `this.kernel`, `this.#kernel`), or is a variable the same file sets from `createKernel(…)`. The new arguments are laid out the way oxfmt and Prettier lay out such a call, at the `printWidth`, `useTabs`, `tabWidth` and `trailingComma` of the nearest JSON config (`.oxfmtrc.json`, `.oxfmtrc.jsonc`, `.prettierrc`, `.prettierrc.json`, or `prettier` in `package.json`; Prettier's defaults without one), so a file they formatted stays formatted in the shapes it knows. If your formatter still changes something, run it after the codemod. The removed object's comments are kept: a comment on `key` goes into the options, one on `value` stays beside the value, and any other goes above the call.
- **What it marks:** a record that spreads (`{ ...rec, value }`), an object with `value` and other fields, a variable the file sets to an object with `value`, a value that is itself such an object, a conditional (or `??`, `||`, `&&`) with such a branch that it can't rewrite, and spread arguments. A call on a receiver it can't name, such as `this.#k` or a kernel passed in as `app`, is marked wherever it would be rewritten or marked, and so is a call on such a receiver with a spread argument (`app.publish(...args)`). A conditional with a comment in one of its records is marked too. A receiver the file sets to `new …(…)` is left alone.
- **What it can't see:** a record passed in a variable from elsewhere, such as a function parameter, looks the same as a 0.2 value, so the call is left as it is. TypeScript reports those calls when the topic has a type, and at run time a topic whose schema doesn't accept `{ value }` rejects them with `invalid`. Code inside strings isn't rewritten either.

## Limits

- **No server-side rendering.** An isolate's content appears once its worker has started and rendered, so anything that must be there at first paint goes in the page's own HTML ([What Isoloop can't hide](limits.md#browsers-and-the-first-paint)).
- **The cost:** every isolate on its own worker adds CPU, memory and start-up time. Pools trade some of that for shared failure ([Pools](pools.md)).
- **`isoloop migrate` reads script files only:** code inside `.vue`, `.svelte`, `.html` or Markdown files isn't rewritten.

## See also

- [Hosting](hosting.md): headers, CSP and CORS for production.
- [What Isoloop can't hide](limits.md): what works differently inside an isolate.
- [Pools](pools.md): several isolates in one worker.
- [Agents](agents.md): tools for agents, the dev MCP and WebMCP.
