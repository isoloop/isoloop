# M4d: The 0.1 release (epic of [M4](m4-devtools-release.md))

**Goal:** `0.1.0` on npm with a launch post.

**Done when** (RFC 0001): `0.1.0` is published with provenance, and the launch post is out.

**Status (2026-11-20):** the API freeze started on the maintainer's word ("there is nothing else pending"). The API review was read at `538d688` (`0.1.0-next.8`) and the maintainer said yes to all its decisions (below). Tasks 1–11 are done (2026-11-20 and 21): the API review's decisions (#333–#335), the freeze declared in `0.1.0-next.9` (#336), the TSDoc pass and its check, the API and CLI reference, and `0.1.0-next.10` (#344), with the docs and the API reference live on isoloop.dev as `site-v0.6.0`. Tasks 12–14 wait for the maintainer's last pass over the landing page, and task 14 also waits for [M4e](m4e-source-layout.md) (the source layout, added 2026-11-21). Done ahead: the Changesets pipeline and ADR 0019 (below), and every package, the new `@isoloop/devtools`, `@isoloop/webmcp` and the `isoloop` CLI included, on npm under `next` (latest `0.1.0-next.10`), published by `prerelease.yml` through trusted publishing (with provenance).

## Decisions (2026-11-20, the API review; maintainer, yes to all)

The review counted 209 public exports in 17 typed entry points (231 with re-exports). Most names were already consistent: `create*` returns an object you own, `define*` declares, `connect*` attaches and returns the function that undoes it, hooks are `use*`, errors are `*Error`, and error codes are snake_case. These decisions fix the rest before the names freeze.

1. **N1. Codes, reasons and event names are snake_case; values you write in config stay kebab-case.** Apps `switch` on these strings, so changing one after 0.1 breaks them silently.
   - `CrashReason`: `'worker_error'`, `'ready_timeout'`, `'spawn_failed'`, `'render_format_mismatch'` (was `'render-fmt-mismatch'`), `'bus_failed'`.
   - `DurabilityDegraded`: `'another_tab'`, `'no_sync_access'`, `'open_failed'`.
   - The kernel event `'bus:durability_degraded'`.
   - Option values stay kebab-case: `'last-n'`, `'when-idle'`, `'bottom-right'`.
2. **N2. `@isoloop/vite`'s `IsolateManifest` is renamed `BuildManifest`.** Host has a different public `IsolateManifest`, the spawn manifest. `BuildManifest` is `referenceOnly`.
3. **N3. The `freeze` group in `docs/guide/map.json` `pending` (44 names) becomes `@internal`, except vite's `IsolateManifest`, the 44th, which N2 renames:**
   - host `HostRenderBridge`;
   - runtime `REQUIRES`;
   - bus's engine and storage (`Broker`, `TsEngine`, `LogStorage`, `MemoryStorage`, … 15 names), its helpers (`effectiveDurability`, `estimateSize`, `publishId`, `toIssues`, `topicConfig`, `isUnchecked`) and `isContracts`;
   - `dom/worker`'s and `dom/host`'s exports;
   - vite's `ISOLATES_ID`, `MANIFEST`, `WORKERS_ID`.

   Each is used only inside `@isoloop/*`. With them out, `pending` is empty, as M4c needs.
4. **N4. The balancer takes host's `Kernel`:** `createBalancer(kernel: Kernel)`. `KernelLike`, `ManifestLike`, `BeatLike`, `CrashLike`, `FailedLike` and `PoolLike` become `@internal`. `KernelLike` exposed a test-only `claimPools`, and the six types documented the balancer's insides. The tests' simulated kernel keeps working through the internal type.
5. **N5. One `RequestOptions`.**
   - It's defined once in `@isoloop/runtime`, as `{ key, timeoutMs }`. React and preact re-export it, and `BusClient.request` uses it.
   - Host's becomes `KernelRequestOptions`, since it adds `signal` and `via`.
   - Request/response stays `@experimental`. It's aligned now because the reference is being written now.
6. **D1. `@isoloop/dom/worker` and `@isoloop/dom/host` are internal entries.** Every export gets `@internal`, and only `dom/testing` and `dom/testing/worker` stay in the reference (`referenceOnly`).
7. **D2. `@isoloop/protocol` and `@isoloop/codec` are internal packages.** Each gets a README with the **Internal** line, as `@isoloop/dom` has, and no reference pages. Their types reach users through host's, bus's and runtime's re-exports, which the reference documents.
8. **D3. The test helpers stay public:** `@isoloop/runtime/testing` (`createTestContext`) and `@isoloop/bus/testing` (`testContracts`). The testing guide documents them.
9. **E1. The missing `@experimental` tags are added:**
   - groups: `SubscribeOptions.group`, `autoCommit` and `BusClient.commit`;
   - request/response: `BusClient.request`, `BusClient.reply`, `topic().reply` (`TopicDef.reply`), react's and preact's `useRequest`, and their `RequestOptions`.
10. **E2. All 21 of `@isoloop/balancer`'s exports are `@experimental`,** not only `createBalancer`, as all four of devtools' are. On the API pages each gets the pill.
11. **F1. The freeze rule.**
    - From `0.1.0-next.9` on, a library PR whose API check report lists a change to the published `.d.ts` needs `maintainer-approved`. The steward reports it as "Needs the maintainer".
    - Additions marked `@experimental` don't need it.
    - This is what makes it a freeze rather than a snapshot.

The public docs say how Isoloop works and how to use it, not why it was decided (the maintainer's review before the docs go live, 2026-11-20). So the TSDoc pass (task 7) leaves no ADR or plan references in public TSDoc. Plain `//` comments may keep them for contributors.

## Tasks

| # | Task | When | Repo | Files | Tests | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | The API review's decisions recorded (this plan), M4c tasks 21–24 cross-referenced, F1 in the steward's rules (an `isoloop/web` PR; the task is done when both have merged) | now | library + web | `docs/plans/m4d-release.md`, `docs/plans/m4c-docs.md`, web `.claude/agents/steward.md` | — (maintainer) | the review |
| 2 | N1: snake_case codes, reasons and the event, with the web follow-up for the dashboards' alerts and site copy | done (#333 `18972a8`, web follow-up web#226 after next.9) | library, web | `packages/protocol/src`, host, runtime, bus, `docs/guide/*` | existing unit and e2e tests, renamed literals | 1 |
| 3 | N3, D1 and D2: `@internal` on the freeze group and on `dom/worker` and `dom/host`; the reference's user-facing list and `map.json` updated, `pending` emptied; the protocol and codec READMEs | done (#334 `e5f3377`; the last name, `IsolateManifest`, went with N2 in #335) | library | `packages/{host,runtime,bus,dom,vite}/src`, `scripts/docs/check.ts`, `docs/guide/map.json`, protocol and codec READMEs | `docs:check` coverage passes with `pending` gone | 1 |
| 4 | N2, N4 and N5: `BuildManifest`, the balancer on `Kernel`, one `RequestOptions` | done (#335 `5793b1a`; site follow-up web#228 after next.9) | library | `packages/{vite,balancer,runtime,react,preact,host}/src`, the agents and isolates guides | unit and types | 1 |
| 5 | E1 and E2: the missing `@experimental` tags | done (#335 `5793b1a`) | library | `packages/{runtime,bus,react,preact,balancer}/src` | `docs:check` | 1 |
| 6 | The freeze, declared: `0.1.0-next.9` with tasks 2–5; F1 applies from here | done (#336, `0.1.0-next.9`, the freeze in force) | library | changesets | the API check | 2–5 |
| 7 (M4c 21) | The TSDoc pass at M4c decision 30's bar, with no ADR or plan references in public TSDoc, and `docs:check` item 7 (the TSDoc rules, the reference ban included). One PR per package group: host and runtime; bus; react and preact; vite, balancer, devtools and webmcp; `dom/testing` | done (#337–#340, #343; the check #341) | library | `packages/*/src`, `scripts/docs/tsdoc.ts` | unit: an export below the bar fails; `@example` fences type-check | 6 |
| 8 (M4c 22) | The API generator: `docs/api/<package>.md` from the published `.d.ts` through `readApi`, with the drift test | done (#342) | library | `scripts/docs/api.ts`, `docs/api/` | unit on a fixture `.d.ts`; CI: drift fails | 7 |
| 9 (M4c 23) | The CLI page from `args.ts`; each symbol links its guides from `map.json` | done (#342) | library | `scripts/docs/api.ts`, `docs/api/cli.md` | every command and flag listed; a symbol's guide links | 8 |
| 10 (M4c 24) | The API pages on the site, Experimental pills, the API in `llms-full.txt` | done (web#230) | web | `apps/site/build/docs/`, `apps/site/content/docs.json` | unit: an `@experimental` symbol gets the pill; smoke and axe on the API pages | 9, and a published pin with `docs/api` |
| 11 | `0.1.0-next.10` with the TSDoc and `docs/api`, and the site's pin bump. The docs go live on the maintainer's `site-v*` tag | done (#344 `0.1.0-next.10`; web#230 pin, web#231 release; live as `site-v0.6.0` on 2026-11-21) | both | `library.lock`, `docs.json` | `check-pin`, the site build | 10 |
| 12 | The release pipeline: the `v*` tag workflow (CI, publish, Pages), a trust entry on every package, and the stage-only decision (main work item 2) | after the maintainer's landing-page pass | library | `.github/workflows/release.yml` | a dry run | 6 |
| 13 | The launch post, with "Isoloop for agents" (main work item 4) | after the maintainer's landing-page pass | library or social | `docs/posts/` | — (maintainer) | 11 |
| 14 | `0.1.0`: `changeset pre exit`, the version PR, the tag | after the maintainer's landing-page pass and M4e | library | `.changeset/` | full CI | 12, 13, and [M4e](m4e-source-layout.md)'s done-when |

M4c task 25 (search) can start once task 10 is merged, and needn't land before the docs go live. M4c task 26 (the skill link in `llms.txt`) waits for M4a task 12, and task 27 (the M4c write-up) comes after task 11.

## Main work items

1. **API review and freeze:** *started 2026-11-20; decisions and tasks above.* Freeze the public API names. Mark the experimental parts `@experimental`: groups, request/response, `kernel.request`, tools on contracts, `kernel.inspect()`, `@isoloop/webmcp`, `@isoloop/balancer`. *Added 2026-11-20:* it starts on the maintainer's word, and it includes the TSDoc pass and `docs:check` item 7 at [M4c](m4c-docs.md) decision 30's bar (M4c task 21), so the API reference is complete from its first build.
2. **Release pipeline:**
   - Changesets, with every `@isoloop/*` package in one `fixed` group ([ADR 0011](../adr/0011-dom-package.md), decision 8). *Done 2026-11-17 ([`isoloop/web` ADR 0004](https://github.com/isoloop/web/blob/main/docs/adr/0004-publishing-and-governance.md), #221): in pre mode `next`, so prereleases are `0.1.0-next.N`; leaving pre mode (`changeset pre exit`) is part of cutting 0.1.0.* *Done by 2026-11-19:* the `@isoloop/*` scope ([ADR 0004](../adr/0004-npm-name.md)) and provenance on the `next` prereleases. The semver policy for the protocol version vs package versions is decided in [ADR 0019](../adr/0019-versioning-and-releases.md) (2026-11-17). Still to build: the release workflow, which matches only `v<major>.<minor>.<patch>` tags, makes a GitHub Release from the changelogs, and the 0.1.0 cut is `changeset pre exit`, the version PR, then the tag.
   - **Decided 2026-11-07:** one repo tag per release, `v<version>`, which every package shares (the fixed group). Pushing it runs the full CI, then publishes, then deploys Pages. Changesets' per-package git tags are turned off, and the unscoped `isoloop` CLI joins the group.
   - The release workflow needs an `npm trust github` entry on every package (as `prerelease.yml` has). The new packages (`@isoloop/devtools`, `@isoloop/webmcp`, the CLI) already have their placeholder publish and a `prerelease.yml` trust entry (2026-11-19).
   - Decide whether releases are stage-only (approved by hand on npm).
3. **Trim the interim changesets.** *Done 2026-11-17 (#222):* one current-state changeset per package replaced the interim notes, which are archived unchanged in [`docs/history/interim-changesets.md`](../history/interim-changesets.md).
4. **Launch post** with the M3 dashboard recording and the bench numbers. It includes an "Isoloop for agents" section ([M4a](m4a-agents.md), decision 22) in neutral language: what agents can do, what it costs, and that WebMCP is behind a flag in Chromium and in Firefox.
