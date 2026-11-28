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

4. **Run an example:** the examples live in [isoloop/web](https://github.com/isoloop/web), which installs the `@isoloop` packages from npm. Here, `pnpm e2e` runs the E2E suites against the harness.

Nothing has to be built first. Each package's `exports` has an `@isoloop/source` condition pointing at `src`, so type checking, lint, tests and the E2E harness all read the source.

## Scripts

Tools are only called through these root scripts, never as binaries ([ADR 0009](docs/adr/0009-toolchain.md#rules), rule 1). CI runs the same ones.

| Script | What it does |
| --- | --- |
| `pnpm check` | Format check, lint, typecheck and unit tests. Run it before pushing. |
| `pnpm format` / `pnpm format:check` | oxfmt. Markdown isn't formatted. |
| `pnpm lint` | oxlint, type-aware. Every rule is an error or off. |
| `pnpm docs:check` | The docs rules `docs/writing.md` marks (checked), and `docs/guide/map.json`'s coverage of the built `.d.ts` (run `pnpm build` first). `--guides` checks only the guides (their Markdown and their type-checked fences), as the PR hook does. A guide naming a removed export fails the API check instead. |
| `pnpm rules:check` / `pnpm rules:build` | The rules registry in `.archeion/rules/` ([ADR 0026](docs/adr/0026-rules-registry.md)), run by [Archeion](https://github.com/sabbz-dev/archeion) (`@sabbz/archeion`, a dev tool only): `rules:check` validates it, the ADRs' `Rules:` lines and the generated `.archeion/rules/README.md`, and CI runs it; `rules:build` writes that README and the board to `.archeion/web/` (gitignored). |
| `pnpm rules:board` | Serves the rules board on localhost (port 2724, or the next free one), rebuilt when a rule or an ADR changes. The theme is `.archeion/isoloop.css`. |
| `pnpm rules:ship <version>` | Run in a version PR: each rule whose `target` is that version becomes `active`, with `since` and a `shipped` event. `pnpm rules:ship <version> --dry` lists them without writing. |
| `pnpm typecheck` | TypeScript 7, `tsc --noEmit` in every package and for the root config and e2e files. |
| `pnpm test` | Vitest: `protocol` and `bus` in Node; `dom`, `host` and `runtime` in Chromium; the bus worker and its storage (`*.browser.test.ts`) in Chromium, Firefox and WebKit. `test:node` and `test:browser` run each half. |
| `pnpm e2e` | Playwright against the E2E harness and isolate servers in all three engines. `pnpm e2e --project=webkit` runs one. |
| `pnpm bench` | Node micro-benches (`bench/**/*.bench.ts`, e.g. the log engine), kept out of `pnpm test`. |
| `pnpm bench:click-to-paint` / `pnpm bench:throughput` / `pnpm bench:memory` | Playwright benches in the browser: click-to-paint latency in all three engines, bus throughput and memory per idle isolate in Chromium. Report only; results go to `bench-results/`. |
| `pnpm bench:codec` | The codec evaluation (`bench/codec`, [investigation](docs/investigations/codec.md)) in all three engines: our codec against MessagePack, CBOR and JSON. Report only, in the log. `pnpm bench` runs its Node half, with bundle sizes. |
| `pnpm bench:bundle` | After `pnpm build`: what each import adds to an app, through Vite's own build. Each library entry's import-time code, seven app bundles and the four scripts are checked against `bench/bundle-size/budgets.json`, and every script must be in its package's `sideEffects`. `--record` measures again, resets the budgets and rewrites the [table](bench/bundle-size/README.md). CI runs it. |
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

`.github/workflows/ci.yml` runs on every PR, on pushes to `main` (`check` and `cli-node24` only there), nightly, and inside a [release](#releases)'s dry run and stage run:

- **`check`:** format check, lint, typecheck, `test:node` and build, then `check-exports`, `docs:check` and the bundle guard (`pnpm bench:bundle`) on the built packages.
- **`cli-node24`:** the CLI's tests, then the built CLI (`--version`, `contracts export`, `skill add`) on Node 24, which the `isoloop` package supports beside Node 26.
- **After `check` passes, in parallel:**
  - **`browser`:** `test:browser`, in Chromium, plus Firefox and WebKit for the bus.
  - **`e2e`:** `pnpm e2e` once per engine (Chromium, Firefox, WebKit).
  - **`bench`:** both Playwright benches and the codec bench. Report only, with no threshold; the numbers are in the job log and the `bench-results` artifact.

**A docs-only PR** changes only files under `docs/`, `.changeset/` or `.claude/`, or files ending in `.md`. It still runs `check` in full, while `cli-node24`, `browser`, `e2e` and `bench` report success without running their steps. A PR that changes any other file runs everything.

**The nightly** (`.github/workflows/nightly.yml`) runs every job on `main` at 03:00 UTC, unless `main` has no commits since the last green nightly. A failed nightly opens an issue labelled `nightly-failure`, or comments on the open one, with the failed jobs and the commits since the last green run. The next green nightly closes it.

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

Previews (`x.y.z-next.N`, dist-tag `next`) and releases (`x.y.z`, dist-tag `latest`) go out the same way, through the *Release* workflow (`.github/workflows/release.yml`). It's started by hand, and it only ever stages: nothing is on npm until the maintainer approves it there with 2FA. Each stage and finish run needs the maintainer's word for that release.

1. **Version, as a PR.** On a branch, run `pnpm release:version`; for a release, `pnpm changeset pre exit` first. It bumps every package to the shared version, writes each package's `CHANGELOG.md` section and, in pre mode, records the changesets under `.changeset/pre/` so the next run doesn't repeat them. Open a PR (`chore: version <version>`) and merge it on green. It needs no `no-changeset` label: the changeset check sees from the diff that it only consumes changesets (added or deleted `.changeset/*.md`, `.changeset/pre/`, `.changeset/pre.json`, `version` in `packages/*/package.json`, `packages/*/CHANGELOG.md`). Anything else in the diff, and the normal check runs. A hand-written text for the GitHub Release goes in `.github/releases/<version>.md`, merged before the stage; without one the notes come from the changelogs.
2. **Dry run.** Run *Release* with mode `dry-run` (the default). It reports what would stop a stage, runs the full CI, builds the tarballs, and shows their shasums and the notes. It has no npm token, so it doesn't exercise trusted publishing.
3. **Stage.** Run it on `main` (or on the release branch, below) with mode `stage`. It refuses mixed versions, a preview outside pre mode, a release in pre mode, a version already on npm and anything older than npm's `latest`. It then runs the full CI, builds without caches or a token, and stages those tarballs from the GitHub environment `npm`. Note the run's id.
   - **If it staged only some:** approve nothing, reject what was staged, then use *Re-run failed jobs*, which stages the same tarballs. Never *Re-run all jobs*, which builds new ones. Never skip an "already staged" error.
4. **Approve, on npmjs.com.** The stage job's summary is the checklist. Nothing is approved until all of it is staged, validated and matches the version and shasums. Then approve in this order: protocol, codec, dom, vite → bus, runtime → host, react, preact → balancer, devtools, webmcp, `isoloop`. A problem before the first approval means reject all. After it, finish the set and fix forward.
5. **Finish.** Run it on the stage's branch with mode `finish` and the stage run's id. It checks every package on npm (version, dist-tag, that run's shasums, and provenance naming the workflow, ref, commit and run). Then it creates the annotated tag `v<version>` on that commit and, for a release, the GitHub Release. It's safe to re-run. No workflow change merges between a stage and its finish, since the tag can't be created after one.
6. **Back to previews, after a release.** Once a release's finish is green, open a PR (`chore: enter pre mode next`) with `pnpm changeset pre enter next`, so step 1 makes previews (`x.y.z-next.N`) again until the next `pre exit`.

Don't push `v*` tags, and don't use `changeset publish` or `changeset tag`. A tag starts no workflow. A patch of an older line isn't supported: the stage refuses it. A patch to the current latest, while `main` is on the next minor, comes from a `release/<major>.<minor>` branch cut from its tag ([ADR 0019](docs/adr/0019-versioning-and-releases.md), decision 5). The workflow and `scripts/release/rules.ts` (`RELEASE_BRANCHES`) admit `main` and that one branch by exact name, never a pattern; the GitHub environment `npm` lists the same names, and the branch gets a ruleset like `main`'s. Such a branch stages `x.y.z` of its own line only. Its copy of `.github/workflows` must match `main`'s when it finishes, so a workflow change on `main` is backported before that. Pages isn't part of a release: `pages.yml` is run by hand.

`pnpm release:status` shows what the next version step would do.

**A breaking change ships with a codemod** ([ADR 0019](docs/adr/0019-versioning-and-releases.md), decision 10). A breaking change to a stable API (what the API check compares, minus `@internal`) starts its changeset summary with `breaking:`, and the changelog entry links the codemod. The same PR adds the codemod, which users run as `npx isoloop migrate`:

- **The step** is `packages/cli/src/migrate/<version>/step.ts`, for the release the change ships in (`0.2`), listed in `STEPS` in `packages/cli/src/migrate/steps.ts`. It reads each file's tree through the parser interface (`migrate/parser.ts`, never `oxc-parser` directly) and returns text edits at source positions, so a user's formatting stays. Code it can't rewrite safely, such as a variable where it expects an object literal, gets a flag: a `// isoloop-migrate:` comment above it. A behaviour change with no syntax to rewrite gets flags and a migration section in the guide.
- **The fixtures** are pairs in `packages/cli/src/migrate/<version>/fixtures/`: `<case>.before.ts` (or `.tsx`, `.js`…) and `<case>.after.ts`, byte for byte. Cover what it rewrites and what it must leave alone or flag. `steps.test.ts` runs every pair, and runs the step again on each after file, which must change nothing. Fixtures aren't compiled, linted or formatted.
- **The gate:** the changeset check fails a `breaking:` changeset unless the PR adds or changes a `*.before.*` fixture under the release's folder, with or without the `no-changeset` label. The release is the one the branch's version leads to: `0.2` from `0.1.x` or `0.2.0-next.N`.

**No majors before 1.0.** While the packages are below 1.0.0, the changeset check fails a PR whose changesets ask for a `major` bump: on 0.x a breaking change is a minor. 1.0 starts only on a PR labelled `release-1.0`, which lets the major through.
- **Decisions** made along the way become [ADRs](docs/adr/README.md). [Would like](docs/would-like.md) holds ideas deferred or to explore, not planned; [Should do](docs/should-do.md) holds committed work waiting on a package or milestone.

The full conventions are in the [plans index](docs/plans/README.md#conventions).
