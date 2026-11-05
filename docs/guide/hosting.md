# Hosting

What the page that runs Isoloop, and the servers that serve isolates, need to send. The loader behind these rules is in [design §4.2](../design/system-design.md#42-loader).

## How an isolate loads

1. The kernel starts a module worker from the **isolate bootstrap** (`workers.isolateBootstrap`). Browsers only start workers from the page's own origin, so the bootstrap is served by the host app.
2. The bootstrap `import()`s the isolate module at `manifest.src`. That URL can be on another origin, such as a CDN.
3. The isolate replies `ready` within `heartbeat.readyTimeoutMs` (10 s by default), or it crashes with reason `ready-timeout`.

## Content Security Policy

| Directive | Needs | Why |
| --- | --- | --- |
| `worker-src` | `'self'` | The bootstrap is a same-origin module worker. No `blob:` is needed. |
| `script-src` | `'self'` plus every origin that serves isolates | The bootstrap `import()`s isolate modules. |
| `connect-src` | The same origins as `script-src`, plus any API the isolates call | `fetch` from inside a worker. |
| `style-src` | `'self'` | Stylesheets are adopted as `CSSStyleSheet` objects, so `'unsafe-inline'` isn't needed. |

A worker isn't governed by the page's policy. It gets the policy sent with its own script, so the bootstrap's response must carry these directives too. Sending one policy on every response from the host app covers both.

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

- **One worker per isolate** ([ADR 0001](../adr/0001-one-worker-per-isolate.md)). `manifest.pool` is typed but rejected with `pools_unsupported` until worker pools land (M2c).
- **No suspension yet.** `manifest.suspend` accepts only `'never'` until M2; anything else is rejected with `suspend_unsupported`.
- **Worker budget.** Passing `workers.budget` live workers (32 by default) logs one warning and emits `workers:budget`. It never blocks a spawn. Each worker has its own heap, so the right number depends on the device.
- **Spawn failures.** If `new Worker` throws (say, the browser is out of memory), the isolate crashes with reason `spawn-failed`, then gets the normal backoff and restart limit.

## Stopping

`kernel.stop(id)` sends `shutdown` with a 1 s grace period. The isolate answers `bye` when its shutdown handlers are done, and the kernel terminates it then, or when the grace period runs out.
