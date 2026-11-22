# @isoloop/vite

The Vite plugin for [Isoloop](https://isoloop.dev): one line in your config wires up the workers, the isolate builds and the development headers.

## What you get

- **The workers:** `virtual:isoloop/workers` gives `createKernel` the URLs of the isolate bootstrap and the bus worker.
- **Isolates by import:** `import url from './cart?isolate'` gives a URL to spawn, and a build emits that module on its own.
- **Isolates built apart:** build named isolates, or a repository of nothing else, for another team's host, with a manifest of the files.
- **Headers in development:** dev and preview send the Content-Security-Policy Isoloop needs, and cross-origin isolation when you ask.
- **A guard for production:** a build fails if the development-only MCP connection is still in it.

## Install

```sh
npm install -D @isoloop/vite@next vite
```

## Example

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { isoloop } from '@isoloop/vite';

export default defineConfig({ plugins: [isoloop()] });
```

Add `/// <reference types="@isoloop/vite/client" />` to a `.d.ts` file in your app, for the types of those imports.

## Learn more

- [Getting started](https://isoloop.dev/docs/getting-started/#the-vite-plugin)
- [Hosting](https://isoloop.dev/docs/hosting/)
- [API reference](https://isoloop.dev/docs/api/vite/)
