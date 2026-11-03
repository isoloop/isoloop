# M0: Foundations

**Goal:** a working monorepo with CI, the wire-protocol types, and the proof of concept ported to TypeScript and running from the repo.

**Done when** (RFC 0001): the four-loops demo runs from the repo and CI is green.

## Scope

**In:** workspace tooling, `@isoloop/protocol` types, a minimal `host` and `runtime` that are just enough to run the PoC (the `legacy-vdom` render path, main-thread pub/sub), `examples/four-loops`, and a Playwright smoke test.

**Out:** Remote DOM, the bus worker, schemas and offsets, restart limits, adapters. The M0 host and isolate code is deliberately thin. M1 replaces most of it behind the same package names.

## Starting point

The proof of concept is a single HTML file ([artifact "Four loops"](https://claude.ai/artifact/NsiL9uTHmWRFDYqjEbkATH)). Its parts map to the repo like this:

| PoC part | Goes to |
| --- | --- |
| `fed-runtime` script (`h`, `view`, `setState`, `on`, `bus`, heartbeat) | `packages/runtime/src/legacy/runtime.ts` |
| `build` / `setProps` / `patch` diff on the host | `packages/host/src/render/legacy-vdom.ts` (implements `HostRenderBridge`) |
| `FederatedContainer` (mount, start, stop, crash, restart, route, rAF render, paintStatus) | split into `host/src/kernel.ts`, `loader.ts`, `supervisor.ts`, `compositor.ts`, `legacy-bus.ts` |
| Federates A–D | `examples/four-loops/src/isolates/{counter,ticker,heavy,messages}.ts` |
| Header (fps chip, block-main button, bus log) | `examples/four-loops/src/chrome.ts` |

Keep the PoC's behaviour exactly, including its quirks (the pub/sub doesn't echo to the sender, restart after 1.5 s), so the port can be checked side by side. Behaviour changes start in M1.

## Tasks

### 1. Workspace skeleton
- **Files:** `package.json` (private, `packageManager: pnpm@10`), `pnpm-workspace.yaml` (`packages/*`, `examples/*`, `bench`), `.nvmrc` (Node LTS), `.gitignore`, `.editorconfig`, `tsconfig.base.json` (strict, `moduleResolution: bundler`, `verbatimModuleSyntax`, ES2022 target), `tsconfig.json` with project references.
- Empty packages with `package.json` + `tsconfig.json` + `src/index.ts`: `protocol`, `host`, `runtime`, `bus`. Names follow `@isoloop/*` ([ADR 0004](../adr/0004-npm-name.md)), with `"type": "module"` and `exports` maps.
- **Test:** `pnpm -r exec tsc --noEmit` passes.

### 2. Lint, format, dependency rules
- ESLint flat config + typescript-eslint, Prettier.
- `no-restricted-imports` per package, following the [dependency rules](../design/system-design.md#2-packages-and-dependency-rules). `bus` gets `lib` without `DOM`.
- **Test:** a deliberate bad import in a scratch file fails lint (checked once by hand, then removed).

### 3. Build and unit tests
- Build each package with Vite library mode (or `tsc -b` for type-only `protocol`), emitting ESM + `.d.ts`.
- Vitest workspace config: `node` environment for `protocol` and `bus`, browser mode (Playwright provider, Chromium) for `runtime` and `host`.
- **Test:** one trivial test per package runs in `pnpm test`.

### 4. `@isoloop/protocol` v1 types
- **Files:** `packages/protocol/src/{envelope,isolate,bus,control,events,errors,grants}.ts`, following [design §3](../design/system-design.md#3-isoloopprotocol).
- Guards: `isEnvelope`, `isIsolateToHost`, …; `matchTopic(grant, topic)` with `*` globs; `PROTOCOL` constant.
- **Tests:** guard accept/reject tables; glob matching tables; `expectTypeOf` checks that every message type is in its union.

### 5. Isolate runtime, legacy flavour
- Port the PoC runtime to TypeScript as an ES module: `createLegacyIsolate(ctx)` exposes `h`, `view`, `setState`, `on`, `bus`.
- Use protocol envelopes (`patch` with `fmt: 'legacy-vdom@1'`, `beat`, `event`) instead of the PoC's ad-hoc `{type}` messages. Bus traffic still goes through the main thread in M0, using temporary envelope types `x-pub` / `x-sub` that are marked internal and removed in M2.
- Entry: `packages/runtime/src/bootstrap.ts` waits for `init`, starts the heartbeat, then `import(init.src)`. That replaces the PoC's string prepend now, so M1 doesn't have to.
- **Tests (browser):** a worker built from the bootstrap and a fixture isolate posts `ready`, then `patch`, then `beat` within 250 ms.

### 6. Host, legacy flavour
- `kernel.ts` (`createKernel`, `spawn`, `stop`, `on`), `loader.ts` (module worker from the bootstrap URL, `init`), `compositor.ts` (one rAF per frame, no budget yet), `render/legacy-vdom.ts` (the PoC diff behind `HostRenderBridge`), `legacy-bus.ts` (PoC fan-out), `supervisor.ts` (PoC rules: blocked after 400 ms of silence, restart 1.5 s after crash, no limit).
- Shadow DOM per surface from day one, with styles adopted from the example's CSS.
- **Tests (browser):** spawn a fixture isolate with a surface, a click reaches the isolate, the patch is applied, stop removes the surface.

### 7. `examples/four-loops`
- Vite app. The four isolates are separate entry files, built as worker-importable ES modules. Header chrome and styles come from the PoC.
- `pnpm --filter four-loops dev` serves it. `vite.config.ts` copies the `isolate-bootstrap.js` bundle into `public/`.
- **Check:** compare side by side with the PoC artifact: every button behaves the same.

### 8. Playwright smoke tests
- **Files:** `e2e/four-loops.spec.ts`, `playwright.config.ts` (Chromium, Firefox, WebKit, using the Vite preview server).
- Cases: (a) all four isolates reach `loop ok`; (b) "Block this loop 3s" in C → C shows `blocked`, B's seconds keep rising, A still increments; (c) "Crash" in C → overlay, then C back to `loop ok` and the restart count is 1; (d) a note typed in D appears in A.
- These become the I2/I3 regression tests in M1.

### 9. CI
- `.github/workflows/ci.yml`: pnpm cache; `lint`, `typecheck`, `test` (unit + browser), `build`, `e2e` (Playwright, with traces uploaded on failure). Runs on PRs and on `main`.
- `.github/workflows/pages.yml` (optional): deploy `examples/four-loops` to GitHub Pages so the README can link to a live demo.

### 10. Docs housekeeping
- Rename `@isoloop/*` to `@isoloop/*` in the README and RFC code samples ([ADR 0004](../adr/0004-npm-name.md)).
- `CONTRIBUTING.md`: setup, scripts, branch and changeset conventions.
- README: "Run the demo" section and CI badge.

## Risks

- **Workers in Vitest browser mode:** worker URLs under Vite's dev server can need `?worker&url` imports. If that's fiddly, test workers through Playwright only and keep Vitest browser tests to main-thread code.
- **WebKit and module workers:** supported in current Safari, but verify `import()` inside workers in Playwright's WebKit early (task 5).

## Demo / write-up

The live four-loops page on GitHub Pages, and a short post: "Four event loops on one page: porting the proof of concept."
