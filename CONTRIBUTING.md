# Contributing

Isoloop is a pnpm monorepo. The tools, and the rules around them, are in [ADR 0009](docs/adr/0009-toolchain.md); this page is the practical part.

## Setup

1. **Node 26**, from `.nvmrc`. With [nvm](https://github.com/nvm-sh/nvm): `nvm install` in the repo root.
2. **pnpm 12, the standalone install.** Node 25 and later don't bundle corepack, and the repo doesn't use it. `packageManager` in `package.json` pins the version:

   ```sh
   curl -fsSL https://get.pnpm.io/install.sh | env PNPM_VERSION=12.16.1 sh -
   ```

   Later, `pnpm self-update` keeps it on the pinned version.
3. **Dependencies and browsers:**

   ```sh
   pnpm install
   pnpm test:install-browsers   # Chromium, Firefox and WebKit for Playwright
   ```

   Playwright may ask for system libraries the first time; `pnpm exec playwright install-deps` installs them (needs sudo).

4. **Run an example:** the examples live in [isoloop/web](https://github.com/isoloop/web), which installs the `@isoloop` prereleases from npm. Here, `pnpm e2e` runs the E2E suites against the harness.

Nothing has to be built first. Each package's `exports` has an `@isoloop/source` condition pointing at `src`, so type checking, lint, tests and the E2E harness all read the source.

## Scripts

Tools are only called through these root scripts, never as binaries ([ADR 0009](docs/adr/0009-toolchain.md#rules), rule 1). CI runs the same ones.

| Script | What it does |
| --- | --- |
| `pnpm check` | Format check, lint, typecheck and unit tests. Run it before pushing. |
| `pnpm format` / `pnpm format:check` | oxfmt. Markdown isn't formatted. |
| `pnpm lint` | oxlint, type-aware. Every rule is an error or off. |
| `pnpm typecheck` | TypeScript 7, `tsc --noEmit` in every package and for the root config and e2e files. |
| `pnpm test` | Vitest: `protocol` and `bus` in Node; `dom`, `host` and `runtime` in Chromium; the bus worker and its storage (`*.browser.test.ts`) in Chromium, Firefox and WebKit. `test:node` and `test:browser` run each half. |
| `pnpm e2e` | Playwright against the E2E harness and isolate servers in all three engines. `pnpm e2e --project=webkit` runs one. |
| `pnpm bench` | Node micro-benches (`bench/**/*.bench.ts`, e.g. the log engine), kept out of `pnpm test`. |
| `pnpm bench:click-to-paint` / `pnpm bench:throughput` / `pnpm bench:memory` | Playwright benches in the browser: click-to-paint latency in all three engines, bus throughput and memory per idle isolate in Chromium. Report only; results go to `bench-results/`. |
| `pnpm bench:codec` | The codec evaluation (`bench/codec`, [investigation](docs/investigations/codec.md)) in all three engines: our codec against MessagePack, CBOR and JSON. Report only, in the log. `pnpm bench` runs its Node half, with bundle sizes. |
| `pnpm test:install-browsers` | Installs Chromium, Firefox and WebKit for Playwright. |
| `pnpm build` | tsdown for the packages, Vite for the E2E harness and the bench apps. |

The runnable examples (basic, the dashboards) live in [isoloop/web](https://github.com/isoloop/web), where `pnpm --filter basic dev` starts the smallest one.

There are no git hooks. CI is the only gate.

## CI

`.github/workflows/ci.yml` runs on every PR and on `main`:

- **`check`:** format check, lint, typecheck, `test:node` and build.
- **After `check` passes, in parallel:**
  - **`browser`:** `test:browser`, in Chromium, plus Firefox and WebKit for the bus.
  - **`e2e`:** `pnpm e2e` once per engine (Chromium, Firefox, WebKit).
  - **`bench`:** both Playwright benches and the codec bench. Report only, with no threshold; the numbers are in the job log and the `bench-results` artifact.

The jobs that need browsers install them through `.github/actions/install-browsers`. It retries a stalled install (each attempt has a 5-minute limit) and caches the browser binaries per Playwright version. Each of those jobs has a 30-minute limit. If a job still hangs, cancel the run and re-run the failed jobs.

## Editors

VS Code picks up `.vscode/`: the oxc extension formats and lints, and the TypeScript 7 extension uses the workspace's TypeScript. Accept the recommended extensions when asked.

Other editors need three things:

- **TypeScript 7 from the workspace** (`node_modules/typescript`), not a bundled TypeScript 5 or 6. TS 7 ships no `tsserver.js`, so tooling that looks for it won't find it; use your editor's TypeScript 7 language-server support.
- **oxlint and oxfmt language servers:** `pnpm exec oxlint --lsp` and `pnpm exec oxfmt --lsp`, which read `.oxlintrc.json` and `.oxfmtrc.json` from the root.
- **Format on save with oxfmt**, so `pnpm format:check` stays clean.

## Rules worth knowing

- **Every export of a published package has an explicit type** (`isolatedDeclarations`), so a body change can never change the published `.d.ts` by accident. Private packages (examples, e2e) use normal inference.
- **Dependency rules are lint errors.** Each package may only import the `@isoloop/*` packages the [system design](docs/design/system-design.md#2-packages-and-dependency-rules) allows; `bus` and `protocol` compile without DOM types.
- **New web APIs:** a PR that starts using one links its [Baseline](https://web.dev/baseline) status. The target is Baseline "widely available" ([ADR 0009](docs/adr/0009-toolchain.md#rules), rule 7).
- **Versions are pinned exactly** in the `catalog:` of `pnpm-workspace.yaml`, and pnpm refuses releases younger than 3 days. Dependabot sends one grouped PR a week.

## Branches, PRs and changesets

- **Branches** are `<type>/<slug>`: `feature/`, `fix/`, `chore/` or `docs/`. Milestone tasks lead with the milestone, e.g. `feature/m1-supervisor`.
- **Every change reaches `main` through a PR**, docs included, squash-merged on GitHub once CI is green (`gh pr merge --squash`). A ruleset on `main` enforces it. The PR title becomes the commit title, so it carries the matching conventional prefix: `feat:`, `fix:`, `chore:` or `docs:`.
- **Changesets** record user-facing changes from M1 on: add a file to `.changeset/` by hand. The Changesets tooling and release pipeline arrive with M4 ([plan](docs/plans/m4-devtools-release.md)).
- **Decisions** made along the way become [ADRs](docs/adr/README.md); ideas for later go in [`docs/would-like.md`](docs/would-like.md).

The full conventions are in the [plans index](docs/plans/README.md#conventions).
