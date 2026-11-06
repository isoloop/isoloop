# ADR 0009: Toolchain: pnpm, TypeScript 7, OXC, Vite 8

- **Status:** Accepted
- **Date:** 2026-11-04
- **Answers:** which tools M0 sets up, and the rules around them. The plan had assumed ESLint, Prettier, Vite library mode and pnpm 10.

## Context

M0 sets up the monorepo, and every later milestone inherits the result, so the tools are chosen once here instead of task by task. The forces:

- **Own the stack.** Keep dependencies few, and keep each one behind something we control, so it can be replaced without touching the rest.
- **Fast feedback.** The repo will hold six or more packages, examples, e2e tests and benches. Lint, format and type checking should take seconds.
- **A published API.** The `@isoloop/*` packages go to npm. Their `.d.ts` files are the contract users code against.
- **No server.** The browser tab is Isoloop's boundary. Node is only used for build tools and the unit tests of the DOM-free packages.

Checked on the npm registry, 2026-11-04:

| Tool | Version | Notes |
| --- | --- | --- |
| `typescript` | 7.0.2 | The Go compiler, stable since 2026-07-08. "tsgo" was only the preview name; `@typescript/native-preview` is no longer published. A stable programmatic API is planned for 7.1. |
| `tsrs` | 0.21.0-ts7.1.0-beta | Rust port of the TS 7 checker, under `oxc-project`. Matches TypeScript's error baselines, but is pre-1.0 and follows the 7.1 beta. In the maintainer's experience it is about 2× faster than TS 7, which is not enough to justify a pre-1.0 dependency. |
| `oxlint` + `oxlint-tsgolint` | 1.91.0 + 7.0.2005 | Type-aware linting has been stable since 2026-07: 59 of 61 typescript-eslint type-aware rules, built on TS 7.0.2. |
| `oxfmt` | 0.76.0 | Prettier-compatible formatter, released alongside oxlint. |
| `tsdown` | 0.23.5 | Library bundler on Rolldown and OXC. |
| `vite` / `vitest` | 8.3.5 / 5.0.5 | Vite 8 builds with Rolldown. Vitest 5 runs on Vite 8, with browser mode through `@vitest/browser-playwright`. |
| `@playwright/test` | 1.64.1 | Ships the latest Chromium, Firefox and WebKit only. |
| `pnpm` | 12.16.1 | |
| Node | 26.13 LTS | Node 25 and later no longer bundle corepack. |

## Decision

### Tools

| Job | Tool |
| --- | --- |
| Package manager, monorepo | **pnpm 12 workspaces**, with plain `pnpm -r` (dependency order) and no task runner on top. |
| Node (development and CI only) | **26 LTS**, pinned in `.nvmrc`. |
| Language, type checking, editor | **TypeScript 7** (`typescript@7.0.2`). `typecheck` runs `tsc --noEmit` in every package, and editors use the same version's language server. Checker, editor and tsgolint are all on 7.0.2. |
| Lint | **oxlint** with `oxlint-tsgolint`, type-aware on every run. |
| Format | **oxfmt**. |
| Package builds (JS + `.d.ts`) | **tsdown**. OXC writes `.d.ts` files through `isolatedDeclarations`, with no type checker in the build. |
| Apps (examples, dashboard), dev server | **Vite 8**. |
| Unit and browser tests | **Vitest 5**: `projects` in the root config, Node for `protocol` and `bus`, browser mode (Playwright, Chromium) for `dom`, `host`, `runtime` and `bus-browser` (the bus's `*.browser.test.ts`, which run the bus worker in a real Worker). |
| E2E | **Playwright**: Chromium, Firefox and WebKit. |
| Benches | **Playwright** for browser benches (`bench/click-to-paint`, `bench/throughput`), run in Chromium, Firefox and WebKit. Node benches run with Vitest (`pnpm bench`). |

### Rules

1. **Tools are only called through root scripts.** CI, docs and contributors run `pnpm format`, `lint`, `typecheck`, `test`, `build`, `e2e` and `check`, never a tool binary directly. `pnpm check` runs the format check, lint, typecheck and unit tests, to run before pushing. Swapping a tool means editing one script, and CI is the conformance test that the swap changed nothing. No git hooks: CI is the only gate.
2. **`isolatedDeclarations: true` in every published package.** The rule follows `"private"` in `package.json`, not a list of names, so `codec`, `react`, `preact` and `devtools` get it when they arrive. Every export has an explicit type: return types on exported functions, annotated exported consts unless they are `as const` literals. A body change can then never silently change the published `.d.ts`, and API changes show up as visible diffs. Private packages (examples, e2e, bench) keep normal inference.
3. **Cross-package imports resolve to source.** Each package's `exports` has an `@isoloop/source` condition pointing at `src/index.ts`, and the shared configs for tsconfig (`customConditions`), Vite and Vitest set it. Type checking, linting and tests need no prior build. `publishConfig.exports` replaces `exports` at publish time, so npm users only see `types`/`import` → `dist`.
4. **Dependency rules are enforced** by pnpm's strict `node_modules` (a package can only import what its `package.json` lists), by oxlint `no-restricted-imports` per package, and by `bus` compiling with `lib: ["ES2022", "WebWorker"]`, with no DOM. No TypeScript project references.
5. **Lint is error-only.** The `correctness`, `suspicious` and `perf` groups are errors, and so are the type-aware TypeScript rules (`no-floating-promises`, `no-misused-promises` and the rest), which matter in a message-passing runtime. `pedantic`, `style` and `restriction` are off unless a rule is added by name. There are no warnings: every rule is either an error or off.
6. **Format:** oxfmt with `singleQuote: true`, `semi: true`, `printWidth: 100` and `trailingComma: 'all'`, otherwise defaults. This matches the code samples in the design docs.
7. **Browser baseline: Baseline "widely available"**, meaning features that have been in every major engine for 30 months or more. Packages build with `target: es2022`. For the features we rely on today, the minimums are **Chrome 108, Firefox 114 and Safari 16.4**, from MDN browser-compat-data:

   | Feature | Chrome | Firefox | Safari |
   | --- | --- | --- | --- |
   | Module workers (`new Worker(url, { type: 'module' })`) | 80 | **114** | 15 |
   | Constructable stylesheets adopted by a `ShadowRoot` | 73 | 101 | **16.4** |
   | OPFS sync access handles in workers, with synchronous `getSize`/`truncate`/`flush`/`close` | **108** | 111 | **16.4** |
   | `es2022` output (class static blocks, top-level await) | 94 | 93 | 16.4 |
   | `MessageChannel` with transferable ports | old | old | old |

   `createKernel` checks for module workers, `MessageChannel`, adopted stylesheets and OPFS, and throws `unsupported_browser` naming whatever is missing. OPFS sync access handles only exist inside workers, so the main thread checks for OPFS itself; Chrome 102–107 have the handles but with asynchronous methods, which only the bus worker (M2b) can tell apart. CI tests only the latest engines, since Playwright ships nothing else. A PR that starts using a new web API links its Baseline status.
8. **Versions are pinned exactly** (no `^`) in a pnpm `catalog:` in `pnpm-workspace.yaml`, the single place for tool versions. Dependabot opens one grouped PR a week for npm and GitHub Actions updates, with a 3-day cooldown. Majors (Vite, Vitest, TypeScript, pnpm) come as separate PRs.
9. **Supply chain.** pnpm's `minimumReleaseAge: 4320` (3 days) rejects versions younger than that. Lifecycle scripts stay blocked, which is pnpm's default, and the few packages that need one are allow-listed by name. Playwright browsers are installed by an explicit `pnpm exec playwright install`. `strictPeerDependencies: true`. GitHub Actions are pinned by commit SHA, with the tag in a comment.
10. **No corepack.** `packageManager: "pnpm@12.16.1"` pins the version. Contributors install pnpm's standalone binary, and `pnpm self-update` maintains the pin. CI uses `pnpm/action-setup`, which reads the same field.
11. **Editor config is committed for VS Code:** `.vscode/settings.json` (workspace TypeScript, oxc as the formatter, format on save, oxlint diagnostics) and `.vscode/extensions.json`. `CONTRIBUTING.md` has a short note for other editors.
12. **CI runs on Ubuntu only, in four jobs.** `check` runs the format check, lint, typecheck, unit tests and build. `browser` runs Vitest browser mode on Chromium. `e2e` runs a Chromium/Firefox/WebKit matrix against the built example and uploads traces on failure. `bench` runs the browser benches in all three engines. `browser`, `e2e` and `bench` only start after `check` passes, and install browsers through one local action (`.github/actions/install-browsers`), with time limits, retries and caches. Pages deploys from `main` only.

### Pre-agreed fallback

- **A package can't live with `isolatedDeclarations`** (a pattern that is really awkward to annotate): turn the flag off for that package only and emit its `.d.ts` files with `tsc --emitDeclarationOnly` in its build script. The same approach already works with tsgo in another project of the maintainer's.

## Consequences

**Good**

- The checker, linter, formatter, bundler and dev server all run on Go or Rust (TS 7, OXC, Rolldown), so feedback takes seconds even as the repo grows.
- One TypeScript version (7.0.2) for the checker, the editor and type-aware lint, so they can't disagree.
- Releases don't depend on any type checker: `.d.ts` output is mechanical, and the checker only gates CI.
- Each tool sits behind a root script and a pinned catalog version, so a swap or an upgrade touches one place.
- No task runner, no git hooks and no paid services: fewer moving parts to learn and keep updated.

**Bad**

- oxfmt is still 0.x. A formatting change in a release can reformat files; exact pins make each upgrade a deliberate PR.
- `isolatedDeclarations` means writing types that inference would otherwise supply, on exports only.
- Without a task runner there is no build cache. That's fine for a handful of packages; revisit if CI passes ~5 minutes.
- The `@isoloop/source` condition has to be honoured wherever code is resolved: tsconfig, Vite, Vitest and tsgolint. M0 checks all four before any real code is written.
- The browser minimums are declared, not tested. `target: es2022`, the feature check and the Baseline-link rule keep them honest. If someone reports a real breakage on an older browser, add paid old-browser runs.
- `minimumReleaseAge` means a fix released today can't be installed for 3 days without overriding the setting.

## Alternatives considered

- **ESLint + typescript-eslint + Prettier** (the earlier plan): mature, but much slower, and typescript-eslint's type-aware rules need TypeScript's JS API, which TS 7 doesn't offer as stable yet. Rejected.
- **Biome** (lint + format in Rust): good, but its type-aware rules use Biome's own type inference, not the TypeScript checker, so it covers fewer of them. OXC also gives us the bundler side (Rolldown, tsdown) from one project. Rejected.
- **tsrs as the checker:** faster and from the same project as the rest of the stack, but pre-1.0, it follows a TS beta, and is only about 2× faster than TS 7. Deferred to [would-like](../would-like.md), with a concrete trigger.
- **`oxlint --type-check` instead of `tsc`:** it reuses tsgolint's program, but its docs don't claim full equivalence with `tsc`. Not used.
- **Checker-emitted `.d.ts` without `isolatedDeclarations`:** no annotations needed, but it ties every release to the checker and lets inferred types leak into the published API. Kept as the per-package fallback.
- **`vite-plugin-dts` / Vite library mode:** the plugin depends on TypeScript's JS API, which TS 7 lacks for now, and tsdown does the same job on the same Rolldown core. Vite stays for apps.
- **TypeScript project references, or building before checking:** references need `composite` and declaration emit just to type check, which duplicates tsdown. Building first makes every check wait for a build and points errors at `dist`. The source condition avoids both.
- **A `prepack` script to strip the source condition:** our own code for what `publishConfig.exports` already does.
- **NX, turbo, Vite+:** caching and task graphs pay off in big monorepos; here they'd mostly add config, or a layer between us and each tool. Revisit if CI time becomes a problem.
- **Git hooks (husky, lefthook):** one more dependency, they slow every commit, and `--no-verify` skips them anyway. `pnpm check` plus CI cover the same ground.
- **Caret ranges and Renovate:** caret ranges let 0.x tools change behaviour without a PR. Renovate is another app to install and configure, where Dependabot is built into GitHub.
- **Testing old browser versions (BrowserStack, Sauce Labs):** a paid external service, for a risk that the build target and the feature check mostly cover.
- **`mitata` or another bench harness:** one more dependency, where `vitest bench` is already there.
