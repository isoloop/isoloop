# M0: Foundations

**Status:** done.

**Goal:** a working monorepo with CI, the wire-protocol types, and the proof of concept ported to TypeScript and running from the repo.

**Done when** (RFC 0001): the four-loops demo runs from the repo and CI is green.

## Scope

**In:** workspace tooling ([ADR 0009](../adr/0009-toolchain.md)), `@isoloop/protocol` types, a minimal `host` and `runtime` that are just enough to run the PoC (the `legacy-vdom` render path, main-thread pub/sub), `examples/four-loops`, and a Playwright smoke test.

**Out:** Remote DOM, the bus worker, schemas and offsets, restart limits, adapters. The M0 host and isolate code is deliberately thin. M1 replaces most of it behind the same package names.

## Starting point

The proof of concept is a single HTML file ([artifact "Four loops"](https://claude.ai/artifact/NsiL9uTHmWRFDYqjEbkATH)). Its parts map to the repo like this:

| PoC part | Goes to |
| --- | --- |
| `fed-runtime` script (`h`, `view`, `setState`, `on`, `bus`, heartbeat) | `packages/runtime/src/legacy/runtime.ts` |
| `build` / `setProps` / `patch` diff on the host | `packages/host/src/render/legacy-vdom.ts` (implements `HostRenderBridge`) |
| `FederatedContainer` (mount, start, stop, crash, restart, route, rAF render, paintStatus) | split into `host/src/kernel.ts`, `loader.ts`, `supervisor.ts`, `compositor.ts`, `legacy-bus.ts` (removed in M2 task 11, [#47](https://github.com/isoloop/isoloop/pull/47)) |
| Federates A–D | `examples/four-loops/src/isolates/{counter,ticker,heavy,messages}.ts` |
| Header (fps chip, block-main button, bus log) | `examples/four-loops/src/chrome.ts` |

Keep the PoC's behaviour exactly, including its quirks (the pub/sub doesn't echo to the sender, restart after 1.5 s), so the port can be checked side by side. Behaviour changes start in M1.

## Tasks

### 1. Workspace skeleton
- **Files:** `package.json` (private, `packageManager: pnpm@12.16.1`, root scripts `typecheck` and `check`; each later task adds the scripts for the tools it installs, so no script points at a missing binary), `pnpm-workspace.yaml` (`packages/*`, `examples/*`, `bench`; a `catalog:` with every tool version pinned exactly; `minimumReleaseAge: 4320`, `strictPeerDependencies: true`, lifecycle scripts blocked except an explicit allow-list), `.nvmrc` (`26`), `.gitignore`, `.editorconfig`, `tsconfig.base.json` (strict, `moduleResolution: bundler`, `verbatimModuleSyntax`, ES2022 target, `customConditions: ["@isoloop/source"]`), and `tsconfig.lib.json` (extends the base, adds `declaration` and `isolatedDeclarations` for published packages).
- Empty packages with `package.json` + `tsconfig.json` + `src/index.ts`: `protocol`, `host`, `runtime`, `bus`. Names follow `@isoloop/*` ([ADR 0004](../adr/0004-npm-name.md)), with `"type": "module"`. `exports` maps `@isoloop/source` → `src/index.ts` and `types`/`import` → `dist`; `publishConfig.exports` has only the `dist` entries.
- `typescript@7.0.2` from the catalog. The `typecheck` script runs `tsc --noEmit` in every package.
- **Test:** `pnpm typecheck` passes; a missing return type on an export in a published package fails it, and a package importing another resolves to its `src` (both checked once by hand).
- Follows [ADR 0009](../adr/0009-toolchain.md) throughout.

### 2. Lint, format, dependency rules
- `oxlint` + `oxlint-tsgolint` (`oxlint --type-aware` on every run) with `.oxlintrc.json`: `correctness`, `suspicious`, `perf` and the type-aware TypeScript rules as errors, no warnings ([ADR 0009 rule 5](../adr/0009-toolchain.md#rules)).
- `oxfmt` with `.oxfmtrc.json`: `singleQuote`, `semi`, `printWidth: 100`, `trailingComma: 'all'`.
- `.vscode/{settings,extensions}.json`: the oxc extension (`oxc.oxc-vscode`) as formatter and linter, format on save, and TS 7 from the workspace. VS Code's TS 7 hook-up isn't the old `typescript.tsdk` (TS 7 ships no `tsserver.js`), so confirm the current setting first.
- `no-restricted-imports` per package (oxlint `overrides`), following the [dependency rules](../design/system-design.md#2-packages-and-dependency-rules). `bus` gets `lib` without `DOM`.
- **Test:** a deliberate bad import and an un-awaited promise in a scratch file both fail lint (checked once by hand, then removed); `pnpm format:check` is clean.

### 3. Build and unit tests
- Build each package with tsdown, emitting ESM + `.d.ts`. OXC writes the `.d.ts` files through `isolatedDeclarations`, with no type checker in the build.
- Vitest 5 `projects` in the root `vitest.config.ts`, resolving the `@isoloop/source` condition: `node` environment for `protocol` and `bus`, browser mode (Playwright provider, Chromium) for `runtime` and `host`.
- **Test:** one trivial test per package runs in `pnpm test`; `pnpm build` writes `dist/index.js` and `dist/index.d.ts` for each package; `pnpm check` runs green.

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
- `kernel.ts` (`createKernel`, `spawn`, `stop`, `on`), `loader.ts` (module worker from the bootstrap URL, `init`), `compositor.ts` (one rAF per frame, no budget yet), `render/legacy-vdom.ts` (the PoC diff behind `HostRenderBridge`), `legacy-bus.ts` (PoC fan-out, removed in M2 task 11), `supervisor.ts` (PoC rules: blocked after 400 ms of silence, restart 1.5 s after crash, no limit).
- Shadow DOM per surface from day one, with styles adopted from the example's CSS.
- **Tests (browser):** spawn a fixture isolate with a surface, a click reaches the isolate, the patch is applied, stop removes the surface.

### 7. `examples/four-loops`
- Vite app. The four isolates are separate entry files, built as worker-importable ES modules. Header chrome and styles come from the PoC.
- `pnpm dev` (`pnpm --filter four-loops dev`) serves it. The bootstrap is imported with `?worker&url`, the isolates with `?isolate`, a small plugin in `vite.config.ts` that emits each isolate as its own chunk with its default export kept (Vite drops a worker entry's exports). Nothing has to be built first.
- **Check:** compare side by side with the PoC artifact: every button behaves the same.

### 8. Playwright smoke tests
- **Files:** `e2e/four-loops.spec.ts`, `playwright.config.ts` (Chromium, Firefox, WebKit, using the Vite preview server).
- Cases: (a) all four isolates reach `loop ok`; (b) "Block this loop 3s" in C → C shows `blocked`, B's seconds keep rising, A still increments; (c) "Crash" in C → overlay, then C back to `loop ok` and the restart count is 1; (d) a note typed in D appears in A.
- These become the I2/I3 regression tests in M1.

### 9. CI
- `.github/workflows/ci.yml`, Ubuntu only, on PRs and on `main`. `pnpm/action-setup` (version from `packageManager`), Node from `.nvmrc`, pnpm store cache. Jobs: `check` (format check, lint, typecheck, unit tests, build); then, once `check` passes, `browser` (Vitest browser mode, Chromium) and `e2e` (matrix over Chromium, Firefox and WebKit against the built example, traces uploaded on failure).
- Every action pinned by commit SHA, with the tag in a comment.
- `.github/dependabot.yml`: `npm` and `github-actions`, weekly, one group for minors and patches, majors separate, `cooldown` of 3 days.
- `.github/workflows/pages.yml` (optional, `main` only): deploy `examples/four-loops` to GitHub Pages so the README can link to a live demo.

### 10. Docs housekeeping
- `CONTRIBUTING.md`: setup (nvm, the standalone pnpm install, no corepack), editors other than VS Code, `pnpm check` before pushing, the Baseline-link rule for new web APIs, scripts, branch and changeset conventions.
- README: "Run the demo" section and CI badge.

## Risks

- **`@isoloop/source` resolution:** tsconfig, Vite, Vitest and tsgolint all have to honour the condition. Check all four in tasks 1–3 before writing real code.
- **`isolatedDeclarations` friction:** if a package hits a pattern that is really awkward to annotate, use the [per-package fallback](../adr/0009-toolchain.md#pre-agreed-fallback) instead of loosening the rule for everyone.
- **Workers in Vitest browser mode:** worker URLs under Vite's dev server can need `?worker&url` imports. If that's fiddly, test workers through Playwright only and keep Vitest browser tests to main-thread code.
- **WebKit and module workers:** supported in current Safari, but verify `import()` inside workers in Playwright's WebKit early (task 5).

## Demo / write-up

The live four-loops page on GitHub Pages, and a short post: "Four event loops on one page: porting the proof of concept."
