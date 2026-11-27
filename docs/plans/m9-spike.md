# M9 spike: Module Federation inside an Isoloop worker

The spike from [M9 Module Federation example](m9-module-federation.md#the-spike), run on 2026-11-26 on `0.1.1`, with the app's own bootstrap (decision 1a). The code is on the throwaway branch [`spike/m9-mf-worker`](https://github.com/isoloop/web/tree/e4ce24d81c836e4c4db4a8375e6a4c99c53bc3f6/spikes/m9-mf-worker) in `isoloop/web`, never merged; its README says how to run it.

**What was built:**
- one React component, exposed by two remotes as `./Hello` and as `./Hello.isolate` (`defineIsolate` around the same component)
- one remote built with the Vite plugin, one with Rsbuild
- a Vite host with `@isoloop/vite` that mounts either entry: on the main thread through the MF runtime, or in a worker through a bootstrap isolate that starts the MF runtime there
- the host and each remote on their own origin, with the host's CSP sent as a header

## What we found

Module Federation runs inside an Isoloop worker on Chromium, Firefox and WebKit, with remotes from both bundlers, under a CSP without `'unsafe-eval'` or inline scripts. React is downloaded once in both modes. It takes two settings that the plan didn't expect, and a CSP rule that Isoloop's hosting guide gets wrong for Firefox.

1. **All twelve cases pass** (3 engines × 2 bundlers × 2 modes): the component renders and answers a click. Each passes once the policy lists the remotes in `worker-src` (finding 3) and the Rsbuild remote emits an ESM entry (finding 2).
2. **Remotes must emit an ESM `remoteEntry.js`.**
   - The Vite plugin does by default.
   - Rsbuild's default is a `var` script, and in a worker it fails on all three engines with `document.getElementsByTagName is not a function`.
   - Why: the MF runtime decides it's in a browser from `typeof window` and `window.document`. Isoloop's worker has both (its DOM subset), so the runtime tries to add a `<script>` tag to the subset.
   - With `library: { type: 'module' }` in the plugin and `output.module: true`, the entry is ESM, the runtime `import()`s it, and it works.
   - A side effect of the same check: the runtime never takes its Node path (`vm`, `new Function`) in a worker, so `ENV_TARGET` doesn't need setting.
3. **Firefox checks a worker's static imports against `worker-src`.**
   - On Firefox 159, a module that a worker `import()`s is checked against `script-src`, but its static imports are checked against `worker-src`. Chromium 158 and WebKit 27.2 check both against `script-src`.
   - So under `worker-src 'self'`, the Vite remote fails on Firefox in isolate mode: its `remoteEntry.js` statically imports its own chunks, and the request for the first one is never sent.
   - The Rsbuild remote loads its chunks with `import()` and passes.
   - It isn't specific to Module Federation: a plain cross-origin isolate with one static import fails the same way, and passes once the import is dynamic. The hosting guide's example policy has the same gap, filed as isoloop#470.
   - With the remotes' origins in `worker-src` too, every case passes. Deployed on one origin, `'self'` covers it.
4. **`shared` works in both modes, once the remote shares what `@isoloop/react` imports.**
   - The host hands React, `react-dom`, `react-dom/client` and `react/jsx-runtime` to the share scope, and both remotes use them: about 219 kB of React is fetched once per page, in every mode.
   - The Vite plugin shares the subpaths without being told.
   - The Rsbuild remote at first shared only `react` and `react-dom`. Its `./Hello.isolate` then downloaded its own `react-dom/client` (208 kB), because `@isoloop/react`'s `defineIsolate` imports it. Listing `react-dom/client` and `react/jsx-runtime` in its `shared` fixed it.
5. **What a worker holds:**
   - After a GC (Chromium, 5 runs), a plain React isolate's worker held 1.31 MB of JavaScript heap, and an MF isolate's 2.09–2.18 MB: about 0.8–0.9 MB more for the MF runtime, its share scope and the remote's entry.
   - That is per worker. Two remotes in a pool share one runtime and one React; two remotes on their own workers each pay it.
   - The singleton store question (decision 11) wasn't part of this spike.
6. **Start-up costs 3–43 ms over a plain isolate:**
   - Time to first render, median of 7: 20–22 ms more on Chromium, 16–43 ms more on Firefox and 3–20 ms more on WebKit than the same component as a plain isolate.
   - In MF mode on the main thread, the component appears 25–39 ms sooner than in isolate mode.
   - These figures come from one desktop on one day. They're for orientation: the bench run (decision 15) measures it properly.
7. **The wrapper is small, and the `requires` stamp passes through.** The bootstrap isolate is 20 lines:
   - it creates an MF instance in the worker and calls `loadRemote('<remote>/Hello.isolate')` with top-level await
   - it then exports the remote's definition, copying its `requires`
   - Isoloop's runtime `import()`s it like any isolate (`packages/runtime/src/bootstrap.ts`), so no library change was needed.

## The numbers

Measured on 2026-11-26 on a desktop x64 CPU, 32 threads, 50 GB, Linux under WSL2, served from `localhost`. Browsers from Playwright 1.65: Chromium 158, Firefox 159, WebKit 27.2. Packages: `@isoloop/*` 0.1.1, `@module-federation/runtime` 2.9.3, `@module-federation/vite` 1.24.1, `@module-federation/rsbuild-plugin` 2.9.3, `@rsbuild/core` 2.3.3, Vite 8.3.8, React 19.3.1. Each was at least 3 days old, as the workspace's supply-chain rule asks.

### Does it render and answer a click?

| CSP `worker-src` | Engine | Vite, main | Vite, isolate | Rsbuild (ESM), main | Rsbuild (ESM), isolate | Rsbuild (`var`), isolate |
| --- | --- | --- | --- | --- | --- | --- |
| `'self'` | Chromium 158 | yes | yes | yes | yes | no: `getElementsByTagName` |
| `'self'` | Firefox 159 | yes | no: static import blocked | yes | yes | no: `getElementsByTagName` |
| `'self'` | WebKit 27.2 | yes | yes | yes | yes | no: `getElementsByTagName` |
| `'self'` + remotes | all three | yes | yes | yes | yes | not run |

The `var` entry works in main mode on all three engines.

### JavaScript fetched (Chromium, uncompressed)

| Case | Total | From the host | From the remote | React (once) |
| --- | --- | --- | --- | --- |
| Plain isolate, no MF | 299 kB | 299 kB | – | 219 kB |
| Vite remote, main thread | 468 kB | 362 kB | 106 kB | 219 kB |
| Vite remote, isolate | 472 kB | 363 kB | 108 kB | 219 kB |
| Rsbuild remote, main thread | 482 kB | 362 kB | 120 kB | 219 kB |
| Rsbuild remote, isolate | 485 kB | 363 kB | 122 kB | 219 kB |

The host's figure includes the MF runtime (71 kB) and the kernel in both modes, since the spike's page carries both. The shop splits them.

### JavaScript heap per worker (Chromium, `measureUserAgentSpecificMemory`, cross-origin isolated, 5 runs)

| Isolate | Median | Range |
| --- | --- | --- |
| Plain React, no MF | 1.31 MB | 1.30–1.31 MB |
| Vite remote through MF | 2.18 MB | 2.18–2.18 MB |
| Rsbuild remote through MF | 2.09 MB | 2.09–2.09 MB |

### Time to first render (median of 7, after one warm-up load)

| Engine | Plain isolate | Vite, isolate | Rsbuild, isolate | Vite, main | Rsbuild, main |
| --- | --- | --- | --- | --- | --- |
| Chromium 158 | 79 ms | 101 ms | 99 ms | 76 ms | 66 ms |
| Firefox 159 | 139 ms | 182 ms | 155 ms | 146 ms | 121 ms |
| WebKit 27.2 | 178 ms | 198 ms | 181 ms | 159 ms | 152 ms |

<details>
<summary>What the <code>resolveRemote</code> hook would need, for its ADR</summary>

What the spike showed about where `src: 'mf:<remote>/<expose>'` has to be resolved:

- **It can't be resolved to a URL on the host.** An exposed module isn't importable by URL on its own: the remote's `init` has to run with a share scope first, then `get('<expose>')` returns a factory. So the work happens in the worker, where the MF instance lives. The [system design](../design/system-design.md) §4.2 places `resolveRemote` in the host's loader, which can't do this alone.
- **The host's loader turns `src` into a URL today** (`new URL(o.src, document.baseURI)` in `packages/host/src/kernel/loader.ts`). An `mf:` value would come out as a relative path. The hook has to see `src` before that, or the loader has to pass `mf:` through untouched.
- **The worker needs a module loader it can be given.** Today the bootstrap does `import(init.src)` (`packages/runtime/src/bootstrap.ts`). An `mf:` source needs a function in the worker that turns `mf:<remote>/<expose>` into the module, and the remote's entry and type, which the host knows, sent with `init`.
- **Someone has to provide the shared modules in the worker.** In the spike, the bootstrap module bundles React and hands it to the share scope. Without that, the first remote's own copy is used, downloaded from that remote. The ADR picks one and says which list (`react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`) a React or Preact isolate needs.
- **One MF instance per worker.** Pool members share it and its React; isolates on their own workers each start one (finding 5).
- **Only ESM entries.** A `var` entry fails in the worker (finding 2). The hook should refuse it with an error that names the remote, rather than the runtime's `getElementsByTagName` message.
- **Errors should name the remote.** A failed load shows today as `Could not import <bootstrap URL>: [ Federation Runtime ]: Failed to load script resources. #RUNTIME-008`, naming the wrapper. The hook can report the remote, the expose and the entry URL.
- **`requires` passes through.** The definition comes from the remote, so its stamp is the remote's build, which is the one ADR 0012 checks.
- **After a restart,** a new worker starts a new instance and loads the entry again, from the HTTP cache.

</details>

<details>
<summary>Changes this suggests to the plan</summary>

- **Decision 4 (bundlers):** the Rsbuild remote is built with an ESM entry (`library: { type: 'module' }`, `output.module: true`), and shares `react-dom/client` and `react/jsx-runtime` as well as `react` and `react-dom`.
- **Decision 17 (CSP):** in dev and E2E, the remotes' origins go in `worker-src` too, or the Vite remotes fail on Firefox. Deployed on one origin, `'self'` covers it. The CSP is sent as a header, since a worker doesn't get the page's meta policy. For the site on GitHub Pages, which can't send headers, the shop's workers run without a policy, and the write-up says so.
- **Decisions 1b and 3 (the hook and `@isoloop/federation`):** the hook needs a part in the worker, not only in the host's loader. That belongs in their ADR.

</details>

<details>
<summary>Method</summary>

- `probe.mjs` loads each case in a new page, waits up to 15 s for the component, clicks its button and waits for the count to change.
- The JavaScript sizes are the response bodies Playwright saw on Chromium (`request.sizes()`).
- Heap figures come from `performance.measureUserAgentSpecificMemory()` on the cross-origin isolated host (`COI=1`), Chromium's full build rather than its headless shell, taking the entries attributed to the isolate's worker.
- Start-up is `performance.now()` when a `MutationObserver` first sees the component. The observer is on the document and on each shadow root, since an isolate renders into a closed one.
- The plain isolate is the same component built into the host with `defineIsolate` and no MF.

</details>
