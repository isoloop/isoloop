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
| `pnpm docs:check` | The docs rules `docs/writing.md` marks (checked), and `docs/guide/map.json`'s coverage of the built `.d.ts` (run `pnpm build` first). `--guides` checks only the guides (their Markdown and their type-checked fences), as the PR hook does. A guide naming a removed export fails the API check instead. |
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

## Repo layout

Plain pnpm workspaces: `protocol`, `dom`, `host`, `runtime`, `bus`, `codec`, `react`, `preact`, `vite`, `cli` (published as `isoloop`), and the experimental `balancer`, `devtools` and `webmcp`. A package arrives with its milestone ([plans](docs/plans/README.md)).

```text
packages/  protocol · dom · host · runtime · bus · codec · react · preact · vite · balancer · cli · webmcp · devtools
e2e/       Playwright suites, their harness page and the isolates they spawn
docs/      rfcs · design · adr · plans · guide · diagrams · investigations · posts · history
bench/     click-to-paint, throughput, memory, pools, visual pools, codec, freeze
```

The examples (basic and the dashboards) and the website live in [isoloop/web](https://github.com/isoloop/web), served at [isoloop.dev](https://isoloop.dev/).

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
- **Source layout** ([ADR 0021](docs/adr/0021-source-layout-and-entry-points.md)):
  - **The top of a package's `src/`** holds only its entries (what `exports`, `bin` and the build point at) and tests named after them.
  - **Everything else** lives in one level of folders named for a concept from the system design, never by kind (`utils`, `types`).
  - **`index.ts`** is only ever an entry.
  - **Tests** sit next to the code they test. `src/__fixtures__/` holds the files they load by URL, and `test/` the helpers they import.
  - **Checks:** `pnpm test` checks the layout (`scripts/layout/`). oxlint fails import cycles and file names that aren't kebab-case.
- **New web APIs:** a PR that starts using one links its [Baseline](https://web.dev/baseline) status. The target is Baseline "widely available" ([ADR 0009](docs/adr/0009-toolchain.md#rules), rule 7).
- **Versions are pinned exactly** in the `catalog:` of `pnpm-workspace.yaml`, and pnpm refuses releases younger than 3 days. Dependabot sends one grouped PR a week.

## Branches, PRs and changesets

- **Branches** are `<type>/<slug>`: `feature/`, `fix/`, `chore/` or `docs/`. Milestone tasks lead with the milestone, e.g. `feature/m1-supervisor`.
- **Every change reaches `main` through a PR**, docs included, squash-merged on GitHub once CI is green (`gh pr merge --squash`). A ruleset on `main` enforces it. The PR title becomes the commit title, so it carries the matching conventional prefix: `feat:`, `fix:`, `chore:` or `docs:`.
- **Changesets** record every change to a published package: run `pnpm changeset` and pick the packages and the bump. CI fails a PR that changes `packages/*` without one; an internal-only change (tests, CI, refactors that leave the published `.d.ts` alone) takes the `no-changeset` label instead. Every `@isoloop/*` package is in one fixed group, so they share a version ([ADR 0011](docs/adr/0011-dom-package.md)).
- **Site impact** closes every PR description: `Site impact: none`, `update needed` or `done in web#N` (the template has it). CI checks the line. "Update needed" means the change is user-visible, so the website follows ([`AGENTS.md`](AGENTS.md), definition of done).
- **The API check** builds the packages on the PR and on its base and compares their published `.d.ts`. A public change needs a changeset of at least `minor`, TSDoc or `docs/guide` updated, and a Site impact other than `none`. Mark an export `@internal` to keep it out.
- **Docs** change in the same PR as the code. How to write them is [`docs/writing.md`](docs/writing.md); which guide covers which code is [`docs/guide/map.json`](docs/guide/map.json); the steps for a change, and for adding or removing a guide, are in the `docs` skill (`.claude/skills/docs/SKILL.md`). `pnpm docs:check` checks both in CI.
- **The steward check (`.github/workflows/steward.yml`)** runs the site steward (`isoloop/web` `.claude/agents/steward.md`, [ADR 0004](https://github.com/isoloop/web/blob/main/docs/adr/0004-publishing-and-governance.md) decision 6) on every PR: it reviews the change against the code and the rules, posts one comment that it updates on each push, and fails on must-fix findings. The rules it applies come from the base branch, never from the PR. Drafts, Dependabot and PRs from forks are skipped. The maintainer can set the `steward-override` label to skip it. It needs one Actions secret, added in the repository under **Settings → Secrets and variables → Actions → New repository secret**: `ANTHROPIC_API_KEY` (an API key from the Anthropic Console) or `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`, using a Claude subscription). Until one is set, the check passes with a "steward not configured" notice.

### Releases

The packages are in Changesets' pre mode `next`, so versions are `0.1.0-next.N` until 0.1.0. A prerelease takes two steps:

1. **Version, as a PR.** On a branch, run `pnpm release:version`. It bumps every package to the next `0.1.0-next.N`, writes each package's `CHANGELOG.md` section from the pending changesets, and records them under `.changeset/pre/` so the next run doesn't repeat them. Open a PR (`chore: version 0.1.0-next.N`) and merge it on green. It needs no `no-changeset` label: the changeset check sees from the diff that it only consumes changesets (added or deleted `.changeset/*.md`, `.changeset/pre/`, `.changeset/pre.json`, `version` in `packages/*/package.json`, `packages/*/CHANGELOG.md`). Anything else in the diff, and the normal check runs.
2. **Publish.** Run the *Prerelease* workflow by hand on `main`. It publishes the versions in each `package.json` under the `next` dist-tag through npm trusted publishing (no token), and skips any version already on npm. It refuses to publish unless every package shares one `-next.N` version. Once every package is on npm, it tags the commit it built with an annotated `v<version>` (`v0.1.0-next.N`), so there's no tag to push by hand. A re-run passes when the tag is already on that commit, and fails when it's on another.

`pnpm release:status` shows what the next version step would do.

**No majors before 1.0.** While the packages are below 1.0.0, the changeset check fails a PR whose changesets ask for a `major` bump: on 0.x a breaking change is a minor. 1.0 starts only on a PR labelled `release-1.0`, which lets the major through.
- **Decisions** made along the way become [ADRs](docs/adr/README.md). [Would like](docs/would-like.md) holds ideas deferred or to explore, not planned; [Should do](docs/should-do.md) holds committed work waiting on a package or milestone.

The full conventions are in the [plans index](docs/plans/README.md#conventions).
