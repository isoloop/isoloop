# @isoloop/vite

## 0.1.0-next.4

No changes in this release.

## 0.1.0-next.3

### Minor Changes

- c2ad524: New, `@experimental`: `connectDevMCP(kernel, { token, url?, title? })` from the new entry `@isoloop/host/dev-mcp`, the page side of the dev MCP ([ADR 0018](https://github.com/isoloop/isoloop/blob/main/docs/adr/0018-tools-for-agents.md), decision 8). It dials `isoloop mcp`'s WebSocket (`ws://127.0.0.1:4317` by default) and sends the kernel's exposed tools (`kernel.tools()`). It answers each call with `kernel.request(tool.topic, input, { timeoutMs: tool.timeoutMs, via: 'mcp' })`, aborts the request when the agent cancels, and sends a failure's `BusError` code and message. It keeps retrying while the CLI isn't running, backing off to one try every 30 s, and stops on a wrong token or a bad hello. The returned function disconnects it. Import it behind `if (import.meta.env.DEV)`.
  
  `@isoloop/vite` fails a production build whose output still contains `@isoloop/host/dev-mcp`, unless you pass `isoloop({ allowDevMcp: true })`. An import that is tree-shaken away, or dropped behind `import.meta.env.DEV`, passes.
- 12e43d0: `kernel.inspect()` now shows each isolate's memory, in Chromium on a cross-origin isolated page (ADR 0020, decision 4). The host measures with `performance.measureUserAgentSpecificMemory()` while a reader listens, at most every 5 s, and gives each isolate its worker's bytes as `memory: { bytes, at }`; a pool's members share their worker's figure (`shared: true`). The snapshot carries it and a new `memory` feed message sends it, to `ctx.inspector` too. Chromium answers at its next garbage collection, so a figure is coarse and can be many seconds old. Without cross-origin isolation, and in Firefox and Safari, there is no figure. `@isoloop/vite`'s existing `crossOriginIsolated: true` makes the dev and preview servers send the headers this needs. To tell workers apart, each one starts from `@isoloop/runtime/worker` with a fragment of its own. `virtual:isoloop/workers` now marks that entry's URL with `#isoloop-entry` for this, and the worker's `ready` reports that it started from it. Workers started from `@isoloop/runtime/bootstrap` directly keep one shared URL and get no memory figure. `@experimental`.

## 0.1.0-next.2

No changes in this release.

## 0.1.0-next.1

No changes in this release.

## 0.1.0-next.0

### Minor Changes

- 0e0ca1c: The `isoloop()` Vite plugin: the bootstrap and bus worker URLs (`virtual:isoloop/workers`), the dev server's CSP and headers, and isolate builds with a manifest, including isolates built apart from the host ([ADR 0012](https://github.com/isoloop/isoloop/blob/main/docs/adr/0012-isolates-built-apart.md)).
  
  This entry replaces the interim notes written during development with the package as it stands before its first versioned prerelease.
  
  The working notes written before this release are kept as history in [`docs/history/interim-changesets.md`](https://github.com/isoloop/isoloop/blob/main/docs/history/interim-changesets.md).
