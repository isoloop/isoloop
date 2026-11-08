# Hosting

What the page that runs Isoloop, and the servers that serve isolates, need to send. The loader behind these rules is in [design §4.2](../design/system-design.md#42-loader).

## How an isolate loads

1. The kernel starts a module worker from the **isolate bootstrap** (`workers.isolateBootstrap`). Browsers only start workers from the page's own origin, so the bootstrap is served by the host app.
2. The bootstrap `import()`s the isolate module at `manifest.src`. That URL can be on another origin, such as a CDN.
3. The isolate replies `ready` within `heartbeat.readyTimeoutMs` (10 s by default), or it crashes with reason `ready-timeout`.

## The bus worker and the contracts module

The bus runs in its own worker, which the kernel starts before any isolate ([ADR 0005](../adr/0005-bus-topology-message-channels.md)). It needs two URLs, given together:

- **`workers.bus`:** the bus worker bundle, `bus-worker.js` from `@isoloop/bus/worker`. Like the bootstrap, it's a module worker, so the host app serves it from its own origin.
- **`contracts.url`:** the contracts module ([ADR 0003](../adr/0003-schema-format-standard-schema.md)). The bus worker `import()`s it to get the topic schemas. The host imports the same module for `contracts.list`. It can be on another origin, with the same CORS headers as an isolate module.

Give both or neither. One without the other makes `createKernel` throw `invalid_config`. With neither there is no bus: isolates still run, but `kernel.publish` rejects with `bus_unavailable`.

With Vite, `@isoloop/vite` provides both URLs as `virtual:isoloop/workers`, as in [four-loops](../../examples/four-loops/src/main.ts). The contracts module comes in through the example's `?isolate` plugin, so it's emitted as its own chunk:

```ts
// vite.config.ts: plugins: [isoloop()]
import workers from 'virtual:isoloop/workers'; // types: /// <reference types="@isoloop/vite/client" />
import list from './contracts';
import contractsUrl from './contracts?isolate';

const kernel = createKernel({
  contracts: { url: contractsUrl, list },
  workers,
});
```

`isoloop()` also sends the Content-Security-Policy below on every dev and preview response, with Vite's HMR socket and injected styles allowed. Pass `isolateOrigins` for isolates on other origins, `csp` for a policy of your own (`false` for none), and `crossOriginIsolated: true` for COOP and COEP. Production responses come from your own server, which has to send the headers itself. Without Vite, `?worker&url` or your bundler's equivalent gives the two URLs.

If the contracts module fails to load or is invalid (`contracts_failed`, `contracts_invalid`, `contracts_mismatch`, `reserved_topic`), it isn't retried. The kernel emits `bus:failed { code }`, every isolate fails with reason `bus-failed`, and later `spawn` calls throw `bus_failed`.

## Persistent topics and a discarded tab

Topics with `durability: 'persistent'` live in the origin's private file system, so they survive a reload, a closed tab and a bus worker crash ([ADR 0007](../adr/0007-bus-worker-supervision.md)). A publish to one is acknowledged once its batch is on disk; batches are written every 5 ms. When the page freezes or goes away (the Page Lifecycle `freeze` event, or `pagehide`), the kernel asks the bus to write what it has pending at once.

Memory topics don't survive a discarded tab. A browser may freeze a hidden tab and later discard it to save memory ([ADR 0001](../adr/0001-one-worker-per-isolate.md#what-the-browser-still-controls)); when the user comes back, the page loads afresh, and only persistent topics still hold their records. Make a topic persistent if losing it on a discard would be a problem.

Only one tab's bus owns the files. In a second tab, and where the browser has no sync access handles or the files can't be opened (some private windows), persistent topics run in memory and the kernel emits `bus:durability-degraded { reason }`.

## Content Security Policy

| Directive | Needs | Why |
| --- | --- | --- |
| `worker-src` | `'self'` | The bootstrap and the bus worker are same-origin module workers. No `blob:` is needed. |
| `script-src` | `'self'` plus every origin that serves isolates or the contracts module | The bootstrap `import()`s isolate modules; the bus worker `import()`s the contracts. |
| `connect-src` | The same origins as `script-src`, plus any API the isolates call | `fetch` from inside a worker. |
| `style-src` | `'self'` | Stylesheets are adopted as `CSSStyleSheet` objects, so `'unsafe-inline'` isn't needed. |

A worker isn't governed by the page's policy. It gets the policy sent with its own script, so the responses for the bootstrap and the bus worker must carry these directives too. Sending one policy on every response from the host app covers all of them.

For example, with isolates on `https://cdn.example.com`:

```http
Content-Security-Policy: default-src 'self'; worker-src 'self'; script-src 'self' https://cdn.example.com; connect-src 'self' https://cdn.example.com
```

## CORS for cross-origin isolates

An isolate module on another origin is fetched in CORS mode, like any cross-origin module script. Its server must answer with:

```http
Access-Control-Allow-Origin: https://app.example.com
Content-Type: text/javascript
```

`*` also works for public modules. The isolate's own static imports need the same headers.

Without them the import fails and the isolate crashes with reason `error` and a message that starts `Could not import <src>` and points back here. The supervisor retries with backoff and then shows the fallback. Other isolates aren't affected.

## Placement rules

- **One worker per isolate by default** ([ADR 0001](../adr/0001-one-worker-per-isolate.md)). A headless isolate can name a pool (`manifest.pool`) and share a worker with the other isolates naming it; pool members share an event loop, globals and fate: if one stops responding or takes the worker down, the whole pool restarts (each member's `isolate:crash` names the `pool`); a member's own fatal error restarts only that member. A visual isolate with `pool` is rejected with `pools_headless_only` (visual pools are M2d).
- **Suspension is opt-in.** `manifest.suspend: 'when-idle'` (60 s) or `{ whenIdle: { afterMs } }` lets an idle isolate's worker be shut down and woken later (ADR 0001); the default `'never'` keeps it running, in a hidden tab too.
- **Worker budget.** Passing `workers.budget` live workers (32 by default) logs one warning and emits `workers:budget`. It never blocks a spawn. Each worker has its own heap, so the right number depends on the device.
- **Spawn failures.** If `new Worker` throws (say, the browser is out of memory), the isolate crashes with reason `spawn-failed`, then gets the normal backoff and restart limit.

## Stopping

`kernel.stop(id)` sends `shutdown` with a 1 s grace period. The isolate answers `bye` when its shutdown handlers are done, and the kernel terminates it then, or when the grace period runs out.
