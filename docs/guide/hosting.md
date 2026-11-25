# Hosting

This page covers what the page that runs Isoloop, and the servers that serve its isolates, need to send: worker URLs, headers, the CSP and CORS.

## When to use it

Read it before deploying an app. In development, `@isoloop/vite` sends the headers for you ([below](#the-bus-worker-and-the-contracts-module)); production responses come from your own server, which has to send them itself. The loader behind these rules is in [design §4.2](../design/system-design.md#42-loader).

## How an isolate loads

1. The kernel starts a module worker from the **isolate bootstrap** (`workers.isolateBootstrap`). Browsers only start workers from the page's own origin, so the bootstrap is served by the host app.
2. The bootstrap `import()`s the isolate module at `manifest.src`. That URL can be on another origin, such as a CDN.
3. The isolate replies `ready` within `heartbeat.readyTimeoutMs` (10 s by default), or it crashes with reason `ready_timeout`.

## The bus worker and the contracts module

The bus runs in its own worker, which the kernel starts before any isolate. It needs two URLs, given together:

- **`workers.bus`:** the bus worker bundle, `bus-worker.js` from `@isoloop/bus/worker`. Like the bootstrap, it's a module worker, so the host app serves it from its own origin.
- **`contracts.url`:** the contracts module ([contracts and grants](contracts.md)). The bus worker `import()`s it to get the topic schemas. The host imports the same module for `contracts.list`. It can be on another origin, with the same CORS headers as an isolate module.

Give both or neither. One without the other makes `createKernel` throw `invalid_config`. With neither there is no bus: isolates still run, but `kernel.publish` rejects with `bus_unavailable`.

With Vite, `@isoloop/vite` provides both URLs as `virtual:isoloop/workers`, as in [basic](https://github.com/isoloop/web/blob/060c6318108d0fce4ddf319093a2e7c0cb2c3c62/apps/basic/src/app.ts), the smallest example in `isoloop/web`. The contracts module comes in through the example's `?isolate` plugin, so it's emitted as its own chunk:

```ts
// vite.config.ts: plugins: [isoloop()]
import workers from 'virtual:isoloop/workers'; // types: /// <reference types="@isoloop/vite/client" />
import list from './contracts';
import contractsUrl from './contracts?isolate';
import { createKernel } from '@isoloop/host';

const kernel = createKernel({
  contracts: { url: contractsUrl, list },
  workers,
});
```

`isoloop()` also sends the Content-Security-Policy below on every dev and preview response, with Vite's HMR socket and injected styles allowed. Pass `isolateOrigins` for isolates on other origins, `csp` for a policy of your own (`false` for none), and `crossOriginIsolated` for COOP and COEP ([Cross-origin isolation](#cross-origin-isolation)). `SharedArrayBuffer` needs those two headers, and so does the devtools' memory per isolate in Chromium: `kernel.inspect()` measures it only on a cross-origin isolated page. It also measures it only for workers started from `@isoloop/runtime/worker` as `virtual:isoloop/workers` gives it. Without Vite, pass that entry's URL with `#isoloop-entry` appended to get the figures. Production responses come from your own server, which has to send the headers itself.

`headersFor({ csp?, isolateOrigins?, crossOriginIsolated? })` from `@isoloop/vite` returns the headers `isoloop()` sends, as a plain object, and `devCsp(origins?)` returns its default policy on its own. The default policy allows Vite's HMR socket (`ws:`, `wss:`) and `style-src 'unsafe-inline'`, which Vite's dev server needs because it injects the CSS you import as `<style>` elements. A production server sends a policy built from [Content Security Policy](#content-security-policy) instead, or passes it as `csp`; its `style-src` needs only `'self'`.

Without Vite, `?worker&url` or your bundler's equivalent gives the two URLs.

If the contracts module fails to load or is invalid (`contracts_failed`, `contracts_invalid`, `contracts_mismatch`, `reserved_topic`), it isn't retried. The kernel emits `bus:failed { code }`, every isolate fails with reason `bus_failed`, and later `spawn` calls throw `bus_failed`.

## Persistent topics and a discarded tab

Topics with `durability: 'persistent'` live in the origin's private file system, so they survive a reload, a closed tab and a bus worker crash. A publish to one is acknowledged once its batch is on disk; batches are written every 5 ms. When the page freezes or goes away (the Page Lifecycle `freeze` event, or `pagehide`), the kernel asks the bus to write what it has pending at once.

Memory topics don't survive a discarded tab. A browser may freeze a hidden tab and later discard it to save memory; when the user comes back, the page loads afresh, and only persistent topics still hold their records. Make a topic persistent if losing it on a discard would be a problem.

Only one tab's bus owns the files. In a second tab, and where the browser has no sync access handles or the files can't be opened (some private windows), persistent topics run in memory and the kernel emits `bus:durability_degraded { reason }`.

## Content Security Policy

| Directive | Needs | Why |
| --- | --- | --- |
| `worker-src` | `'self'` | The bootstrap and the bus worker are same-origin module workers. No `blob:` is needed. |
| `script-src` | `'self'` plus every origin that serves isolates or the contracts module | The bootstrap `import()`s isolate modules; the bus worker `import()`s the contracts. |
| `connect-src` | The same origins as `script-src`, plus any API the isolates call | `fetch` from inside a worker. |
| `style-src` | `'self'` | Stylesheets are adopted as `CSSStyleSheet` objects, which `'self'` allows. The page writes the `style` an isolate renders through the element's `style` object, and CSP doesn't govern that, so no `'unsafe-inline'` is needed. |

That holds on a page with surfaces and with the devtools panel, which styles its own elements the same way. Styles your app's own code writes with `setAttribute('style', …)`, or in `<style>` elements, still need `'unsafe-inline'`.

A worker isn't governed by the page's policy. It gets the policy sent with its own script, so the responses for the bootstrap and the bus worker must carry these directives too. Sending one policy on every response from the host app covers all of them.

For example, with isolates on `https://cdn.example.com`:

```http
Content-Security-Policy: default-src 'self'; worker-src 'self'; script-src 'self' https://cdn.example.com; connect-src 'self' https://cdn.example.com; style-src 'self'
```

Without a `style-src` directive, `default-src 'self'` applies to styles, which is enough as well.

## CORS for cross-origin isolates

An isolate module on another origin is fetched in CORS mode, like any cross-origin module script. Its server must answer with:

```http
Access-Control-Allow-Origin: https://app.example.com
Content-Type: text/javascript
```

`*` also works for public modules. The isolate's own static imports need the same headers.

Without them the import fails and the isolate crashes with reason `error` and a message that starts `Could not import <src>` and points back here. The supervisor retries with backoff and then shows the fallback. Other isolates aren't affected.

## Cross-origin isolation

A page is cross-origin isolated when it's served with `Cross-Origin-Opener-Policy: same-origin` and a `Cross-Origin-Embedder-Policy` that makes every cross-origin resource safe to load. Isoloop runs without it. You need it for `SharedArrayBuffer` and for the devtools' memory per isolate. `@isoloop/vite`'s `crossOriginIsolated` sends both headers from the dev and preview servers, with one of two COEP values:

| `crossOriginIsolated` | COEP | Cross-origin resources | Browsers that isolate the page |
| --- | --- | --- | --- |
| `true` | `require-corp` | Each one needs a `Cross-Origin-Resource-Policy` header, or has to load in CORS mode; others are blocked | Chromium, Firefox and Safari |
| `'credentialless'` | `credentialless` | `no-cors` requests (images, plain `<script>` tags) load without cookies, so they need no extra headers | Chromium 96 and later, Firefox 119 and later on desktop |

The versions come from [MDN's browser compatibility data](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy#browser_compatibility) (2026-11-19). Safari and Firefox for Android ignore `credentialless`: the page loads, isolates run, but it isn't cross-origin isolated, so `crossOriginIsolated` is `false` there. Use `'credentialless'` when third-party assets you don't control break under `require-corp`, and check `crossOriginIsolated` at run time before you rely on `SharedArrayBuffer`. `'credentialless'` is experimental and may change before 1.0.

Isolate modules on another origin load in CORS mode under either value, so the [CORS headers](#cors-for-cross-origin-isolates) above cover them.

## Placement rules

- **One worker per isolate by default.** An isolate, headless or visual, can name a pool (`manifest.pool`) and share a worker with the other isolates naming it. Pool members share an event loop, globals and fate. If one stops responding or takes the worker down, the whole pool restarts, and each member's `isolate:crash` names the `pool`. A member's own fatal error restarts only that member. Visual members also share one document, so they can read each other's DOM and input: keep widgets that handle secrets on their own worker ([pools](pools.md)). A pool suspends only as a whole, when every member is idle and opts in, and any member's wake wakes it. See [Worker pools](pools.md) for when to pool and what members share. Pool names starting with `balancer-` are reserved for the opt-in [balancer](balancer.md), which places isolates by measured load; `kernel.spawn` rejects them with `reserved_pool`.
- **Suspension is opt-in.** `manifest.suspend: 'when-idle'` (60 s) or `{ whenIdle: { afterMs } }` lets an idle isolate's worker be shut down and woken later; the default `'never'` keeps it running, in a hidden tab too.
- **Worker budget.** Passing `workers.budget` live workers (32 by default) logs one warning and emits `workers:budget`. It never blocks a spawn. Each worker has its own heap, so the right number depends on the device.
- **Spawn failures.** If `new Worker` throws (say, the browser is out of memory), the isolate crashes with reason `spawn_failed`, then gets the normal backoff and restart limit.

## Stopping

`kernel.stop(id)` sends `shutdown` with a 1 s grace period. The isolate answers `bye` when its shutdown handlers are done, and the kernel terminates it then, or when the grace period runs out.

## Limits

- **Memory topics don't survive a discarded tab;** only persistent topics do ([above](#persistent-topics-and-a-discarded-tab)).
- **Only one tab's bus owns the files.** In other tabs, persistent topics run in memory.
- **A contracts module that fails to load isn't retried:** the bus fails and every isolate with it ([above](#the-bus-worker-and-the-contracts-module)).
- **COEP `credentialless` doesn't isolate the page in Safari or Firefox for Android** ([above](#cross-origin-isolation)).
- **The worker budget only warns.** It never blocks a spawn, and the right number depends on the device.

## See also

- [Getting started](getting-started.md) and [the bus](bus.md).
- [Worker pools](pools.md) and [the balancer](balancer.md).
