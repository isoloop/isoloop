# M4e: Source layout (epic of [M4](m4-devtools-release.md))

**Goal:** a source tree a reader can take in at a glance, rules that keep it that way, and a published account of what each Isoloop import adds to an app.

**Done when:**
- Every package follows [ADR 0021](../adr/0021-source-layout-and-entry-points.md), and the layout test has no `pending` list.
- The three lint rules, the layout test, the bundle guard, the diagram anchors and the API check's notice all run in CI.
- `0.1.0-next.11` is on npm, and the bundle-size guide is in the site's docs at that pin. It goes live with the maintainer's next `site-v*` tag.
- No M4e PR changed the public API, as the API check reports it.

**Status (2026-11-21):** grilled (Q1–Q31, yes to all). ADR 0021 was accepted the same day (#347), so tasks 3–17 can start. `0.1.0` ([M4d](m4d-release.md), task 14) waits for this epic.

M4e has no demo or write-up of its own, unlike the other epics (plans [conventions](README.md#conventions)). It ends with the bundle-size guide, and the launch post may link that.

## Decisions (2026-11-21, grilled; maintainer, yes to all)

1. **An epic before 0.1.0.** It runs now, beside the maintainer's landing-page pass (Q1). Only work under `packages/` waits for the moves to finish (Q30). These carry on in parallel:
   - M4a's skill and real-agent run
   - M4c's tasks 25–27
   - M4d's tasks 12 and 13
2. **The rules are ADR 0021's:**
   - entries, areas, barrels, tests and fixtures, moves, the tree-shaking contract, budgets, enforcement, and the folder map (Q2, Q4–Q8, Q14–Q22, Q25)
   - accepted on 2026-11-21 (#347), before any M4e code
3. **The guide is a user guide, `docs/guide/bundle-size.md`** (Q3, Q26).
   - **Sections:**
     - When to use it
     - What your app loads
     - What each import costs
     - Keep your bundles small
     - Check your own build
     - Limits
     - See also
   - **Its table** names the Isoloop, Vite and Rolldown versions and the date, and links `bench/bundle-size`.
   - **Its `map.json` entry** is `paths: ["bench/bundle-size/"]` with no exports.
   - **On the site** it sits next to the hosting guide.
4. **Living docs** (Q3, Q12, Q27):
   - `CONTRIBUTING.md` gets a "Rules worth knowing" bullet, a `pnpm bench:bundle` row and a CI note.
   - The system design's §9 gets one line pointing at the budgets.
   - The ADR index gets a row.
   - `AGENTS.md` doesn't change, and no living doc gets a folder map.
   - ADRs, plans, posts and investigations keep their old paths.
5. **The bundle guard** (Q9, Q17, Q18, as changed in ADR 0021, decision 6) runs through Vite's own `build()`, in CI after the build. It checks:
   - each library entry's import-time code, measured with side effects assumed
   - that the four scripts are declared in `sideEffects`; today bus's worker and the devtools panel aren't
   - the budgets for seven app bundles and the four scripts

   Each budget is today's size plus 5%, rounded up to the next 0.5 KB. A PR that crosses one raises it and says why.
6. **Explicit lists and bus's internals land in M4e, after the API check learns to compare names and declarations** (Q8).
   - The bus entry exports 22 `@internal` names. Outside bus, the CLI imports `isContracts` and the throughput bench imports `TsEngine`.
   - 21 of the names go. `isContracts` stays, and the bench imports `TsEngine` from source.
7. **Not in M4e:**
   - `/* @__PURE__ */` annotations (Q10)
   - the big-file splits, which come after 0.1, one at a time (Q11)
   - a line cap (Q21)
   - a custom oxlint plugin (Q14)
8. **Execution** (Q13, Q24, Q29):
   - One Opus fork works through the tasks in order.
   - The ADR, this plan, the API check (task 5), bus's internals (task 13) and the guide (task 15) go to the maintainer.
   - The rest merge on green.
   - The move script is a one-off in the fork and stays out of the repo.
9. **The release** (Q23): `0.1.0-next.11` once the tasks are done, then the site's pin. With it, the guide joins `docs.json` and the feature proofs move to the new paths.

## Tasks

| # | Task | When | Repo | Files | Tests | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ADR 0021, to the maintainer | done (#347) | library | `docs/adr/0021-source-layout-and-entry-points.md`, `docs/adr/README.md` | — (maintainer) | the grilling |
| 2 | This plan, M4e's rows in the plans index and the M4 overview, and M4d task 14 waiting for M4e, to the maintainer | done (#348) | library | `docs/plans/m4e-source-layout.md`, `docs/plans/README.md`, `docs/plans/m4-devtools-release.md`, `docs/plans/m4d-release.md` | — (maintainer) | the grilling |
| 3 | The checks: the layout test, with `pending` listing the 11 packages to move; `import/no-cycle` and `unicorn/filename-case`; `map.json`'s paths in `docs:check`; the `./dist/` paths in `sideEffects` in `check-exports`; the `CONTRIBUTING.md` bullet | after task 1 | library | `scripts/layout/`, `.oxlintrc.json`, `scripts/docs/check.ts`, `scripts/check-exports.ts`, `CONTRIBUTING.md` | unit: each rule fails on a planted case and passes on `main` with `pending` | 1 |
| 4 | Diagram anchors: each of the 113 citations carries the text of its first cited line; the diagrams test checks it, and the anchor script finds a moved line again | after task 1 | library | `docs/diagrams/*.json`, `docs/diagrams/diagrams.test.ts`, the anchor script | the test fails on a shifted line | 1 |
| 5 | The API check compares exported names and their declarations, so a list's shape and the `@internal` names inside one don't count; a notice when a `no-changeset` PR changes the dist JS. To the maintainer | after task 1 | library | `scripts/ci/api-check.ts` | unit: protocol's and bus's `export *` rewritten as lists reads as no change; a changed declaration still counts; the notice appears | 1 |
| 6 | Explicit lists in protocol's and bus's entries; `oxc/no-barrel-file` (threshold 0) on | after task 5 | library | `packages/protocol/src/index.ts`, `packages/bus/src/index.ts`, `.oxlintrc.json` | the API check reports no change; the dist JS is identical | 5 |
| 7 | Move protocol and codec | after tasks 3 and 4 | library | `packages/{protocol,codec}/src`, the living docs that cite them | every move PR, below | 3, 4 |
| 8 | Move bus | | library | `packages/bus/src` | every move PR | 7 |
| 9 | Move runtime; `render/index.ts` becomes `render/render.ts` | | library | `packages/runtime/src` | every move PR | 8 |
| 10 | Move host; `supervisor/index.ts` goes | | library | `packages/host/src` | every move PR | 9 |
| 11 | Move react and preact | | library | `packages/{react,preact}/src` | every move PR | 10 |
| 12 | Move devtools, balancer, vite and cli; `pending` goes | | library | `packages/{devtools,balancer,vite,cli}/src`, `packages/balancer/test` | every move PR | 11 |
| 13 | The bus entry stops exporting 21 of its 22 `@internal` names (`isContracts` stays for the CLI); the throughput bench imports `TsEngine` from source; a patch changeset. To the maintainer | after task 6 | library | `packages/bus/src/index.ts`, `bench/throughput/engine.bench.ts`, `.changeset/` | typecheck; the API check reports no public change | 6 |
| 14 | The bundle guard: `bench/bundle-size`, its CI step after the build, the budgets and the recorded table; bus's worker and the devtools panel declared in `sideEffects` (a patch changeset); the `pnpm bench:bundle` row and the §9 line | after task 12 | library | `bench/bundle-size/`, `.github/workflows/ci.yml`, `packages/{bus,devtools}/package.json`, `CONTRIBUTING.md`, `docs/design/system-design.md` | it fails on a planted top-level side effect, on a script missing from `sideEffects`, and on a crossed budget | 12 |
| 15 | The bundle-size guide and its `map.json` entry, to the maintainer | after task 14 | library | `docs/guide/bundle-size.md`, `docs/guide/map.json` | `docs:check` | 14 |
| 16 | `0.1.0-next.11`: the version PR, then the Prerelease workflow | after tasks 13–15 | library | `.changeset/` | the Prerelease workflow | 13, 14, 15 |
| 17 | isoloop/web: the pin at `next.11`, the guide in `docs.json`, the feature proofs on the new paths | after task 16 | web | `apps/site/library.lock`, `apps/site/content/docs.json`, `apps/site/content/features/*.json` | `check-pin`, the site build, the proofs check | 16 |

**Every move PR (tasks 7–12)** carries:
- the moves and their import paths
- the living docs and `map.json` that cite the moved files
- the diagram citations
- the bench and e2e deep imports
- the oxlint per-file override, if its path changes
- its packages taken out of `pending`

It's done when:
- CI is green.
- Every `.d.ts` is identical, and the JS is identical apart from tsdown's `// src/<path>` comments.
- The API check reports no change.
- `vitest list --filesOnly` finds the same files in each project.

It takes the `no-changeset` label. Its "Site impact" is `update needed`, since the site's feature proofs cite the old paths. Task 17 is the follow-up, opened as a draft with the first move.

The moves run one at a time because they all edit the same files: `map.json`, the diagrams, and the lint and Vitest configs.
