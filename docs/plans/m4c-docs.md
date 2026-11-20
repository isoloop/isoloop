# M4c: Docs (epic of [M4](m4-devtools-release.md))

**Goal:** the docs on isoloop.dev, readable by people and by agents, and a pipeline that keeps them matching the code as features are added, changed and removed.

**Status:** grilled 2026-11-20 (Q1–Q31, yes to all). Phase A (tasks 1–20) doesn't wait for the API freeze. Phase B (tasks 21–27) starts after the freeze ([M4d](m4d-release.md) task 1), which starts on the maintainer's word.

**Done when:**

- The docs are live on isoloop.dev under `/docs/`: the guides, the API reference and the CLI reference, built from a published version of the library.
- `llms.txt`, `llms-full.txt` and a Markdown copy of each docs page are served next to them.
- `pnpm docs:check` runs in the library's CI and its PR hook, the `docs` skill and `docs/writing.md` are merged, and the steward reviews docs against them.
- Every public export has TSDoc at decision 30's bar.

**Depends on:** [M4a](m4a-agents.md) and [M4b](m4b-devtools.md)'s public API (merged). The API reference waits for M4d's freeze. The skill link in `llms.txt` waits for M4a task 12.

## Decisions (2026-11-20)

### Order

1. **Two phases.** Phase A, now: the docs section of the site, its ADR, the docs pipeline and the guides. Phase B, after the freeze: the TSDoc pass, the API and CLI reference, search, and the API in `llms-full.txt`. The freeze starts on the maintainer's word, since small tasks are still in flight.

### Where the docs live and what they show

2. **The guides stay in this repo,** in `docs/guide/`, and still read well on GitHub. The site fetches them at the sha in `apps/site/library.lock`, as it does the diagrams.
3. **The pin is a published version.** Until 0.1 it's the commit of a `chore: version 0.1.0-next.N` PR, from 0.1 on a `v*` tag. The site's CI checks that the package versions at the pin are on npm. So the site never describes an API that `@next` doesn't have yet. Bumping the pin stays a mechanical steward PR after each publish ([`isoloop/web` ADR 0004](https://github.com/isoloop/web/blob/main/docs/adr/0004-publishing-and-governance.md), decision 6), and the docs go live only with a `site-v*` tag, on the maintainer's word.
4. **One version.** No versioned docs before 1.0, and no redirects for removed pages.

### The site

5. **URLs and navigation.** The docs are at `/docs/`, one page per `/docs/<slug>/`, with an index at `/docs/`. The header nav gets "Docs" between Examples and GitHub, which amends `isoloop/web` ADR 0005. Each page has a section sidebar (a `<details>` on phones) and a table of contents from its h2s. All of it works without JS (`isoloop/web` ADR 0002, decision 8).
6. **The layout is mocked first:** one docs page (sidebar, TOC, code block, table, callout) in both themes and at phone width, approved by the maintainer before the build. One direction, not alternatives.
7. **The Markdown engine is `markdown-it`,** the only dependency, behind our own `renderMarkdown(src) → { html, title, description, headings, links }` with a conformance suite. Its token stream gives heading ids, the TOC and link rewriting without plugins.
8. **Code highlighting is our own:** the site's build-time tokenizer (`apps/site/src/pages/code.tsx`, ts and shell today) is extended to tsx, json and html. No highlighting dependency, so `isoloop/web` ADR 0002 decision 12 ("one dependency at most") holds. Shiki's inline `style` attributes wouldn't pass the CSP anyway.
9. **No front matter.** The title is the `# h1`. The description (for `llms.txt` and the link preview) is the first paragraph, one sentence of at most 200 characters. Order and sections come from a `docs.json` manifest in `isoloop/web`. The build fails if a fetched guide isn't listed or a listed one is missing.
10. **Links are rewritten at build.** Relative links to other guides become `/docs/…` URLs. Links to ADRs, plans, investigations or source become GitHub links at the pinned sha. A relative link that resolves to nothing fails the build.

### Pages

11. **The page list:**
    - **Start:** Getting started (with an `AGENTS.md` snippet for users' apps, [M4a](m4a-agents.md) decision 16), What Isoloop can't hide.
    - **Build:** Writing isolates, Contracts and grants, The bus, Supervision and restarts, Pools, Balancer, Hosting.
    - **Agents and tooling:** Agents, Inspection feed, Devtools panel, Build a dev tool as an isolate.
    - **Reference:** the API (one page per package), the CLI, and Kernel config as a link to the generated `KernelConfig` section (decision 29).

    There's no `npm create isoloop` scaffolder in 0.1 ([would-like](../would-like.md)).
12. **Writing isolates is one page,** with a section each for vanilla (`@isoloop/dom`), Preact and React, and the shared parts (lifecycle, `ctx`, surfaces) written once. No code tabs, so the page reads the same as `.md` and in `llms-full.txt`.
13. **"Build a dev tool as an isolate"** uses `@isoloop/devtools` as the worked example: tools that read only the app's own topics need no grant, and tools that read the kernel's feed need `inspect`. It builds on the agents and inspection guides.
14. **"What Isoloop can't hide"** is up front, as RFC 0001 asks: sync layout, the `window` and `document` globals, drag and drop and pointer timing, and the engine limits in [`docs/investigations/engine-constraints.md`](../investigations/engine-constraints.md), with the async `HostApi` workarounds (`measure`, `focus`, `scrollIntoView`).
15. **No search in phase A.** Phase B adds our own (decision 31).

### For agents

16. **The site's build writes, at every `site-v*` deploy:**
    - **`/llms.txt`** in the llmstxt.org format: an H1, a one-line summary, then a section per docs section with each page's `.md` link and description. An "Optional" section links the examples hub and the README. The "build with Isoloop" skill is linked once M4a task 12 lands.
    - **`/llms-full.txt`:** every guide in nav order, plus the API and CLI reference once phase B lands.
    - **`/docs/<slug>.md`:** the fetched source, with its links made absolute.

    CI checks that every page appears in `llms.txt` and has its `.md`.

### The docs pipeline

17. **The agent that makes a change writes its docs, in the same PR,** following the `docs` skill. The steward reviews them against the skill's rules. There's no separate docs-writer agent, for the reason ADR 0004 gives for publishing: it would have to rediscover the context from the diff, and copy written from diffs drifts. The steward's weekly routine adds a docs drift pass: every guide read against the code on `main`, with at most a few fix PRs.
18. **The `docs` skill** is `.claude/skills/docs/SKILL.md` in this repo, committed. It holds:
    1. the page types (guide, generated reference) and the guide skeleton (decision 19);
    2. what each kind of change means for the docs:
       - **new feature:** a section in an existing guide, or a new guide;
       - **changed behaviour:** the sections that describe it;
       - **renamed or removed export:** every page that names it;
       - **new limit found:** "What Isoloop can't hide";
    3. the docs map (decision 21), and how to add, rename or remove a page (the guide here, `docs.json` in `isoloop/web`, the pin);
    4. the TSDoc rules (decision 30), since the reference is generated from TSDoc;
    5. the checks to run before a PR (decision 22).
19. **One guide skeleton:**
    - `# Title`
    - a one-sentence lead (decision 9's description)
    - `## When to use it`
    - the body, in task order
    - `## Limits`
    - `## See also`

    The six guides drafted before this plan (agents, balancer, devtools, hosting, inspection, pools) get one pass to match. Reference pages are generated and never hand-edited.
20. **The writing rules have one home, `docs/writing.md` (task 2):** plain English, short sentences, bold lead-ins on bullets, British spelling, and neutral language (measurements with device, build and tag; never "faster than native"). It also lists the banned phrases ("simply", "just", "blazing", "faster than native"). The `docs` skill, the steward and the user-facing skill all point to it. `isoloop/web`'s `docs/brand.md` keeps the messaging for marketing copy.
21. **The docs map,** `docs/guide/map.json`, lists for each guide the source paths and exports it covers (for example `bus.md`: `packages/bus/src/topic.ts`, `topic`, `contracts`).
    - **A notice:** a PR that changes a mapped path without touching that guide gets a CI notice naming it, and the steward judges whether it needed a change.
    - **Coverage, which fails:** every user-facing package and every public export appears in at least one guide's map, or is listed as reference only.
22. **`pnpm docs:check`,** our own script, runs in CI and in the pre-`gh pr create` hook ([ADR 0004](https://github.com/isoloop/web/blob/main/docs/adr/0004-publishing-and-governance.md), decision 4). It fails on:
    1. a lead sentence that's missing or over 200 characters, or a skeleton section that's missing;
    2. a `ts` or `tsx` fence in `docs/guide/` that doesn't type-check against the workspace packages (` ```ts nocheck ` opts a fragment out);
    3. a relative link that resolves to nothing;
    4. a banned phrase from `docs/writing.md`;
    5. a guide that names an export the API check reports as removed or renamed;
    6. a gap in the map's coverage;
    7. an export without TSDoc at decision 30's bar (from the freeze on).

    The fence check (2) lands in phase A, so the freeze's renames break the guides where they can be seen.
23. **Removing a feature:** the API check flags the removal, `docs:check` (item 5) fails while any guide still names it, and the author rewrites or deletes those sections. If a whole page goes, its `docs.json` entry is removed in `isoloop/web` in the same session (Site impact: `update needed`).
24. **Who approves docs.** Edits to existing pages inside a feature PR merge on green CI and a steward pass; the maintainer reviews after, as for forks' code. New pages, removed pages, restructures, `docs/writing.md`, the `docs` skill and the user-facing skill go to the maintainer before merging. Docs-only PRs in this repo still go to the maintainer, as `AGENTS.md` says.
25. **The user-facing skill and the `AGENTS.md` snippet are docs too:** the "build with Isoloop" skill (M4a task 12) and getting started's snippet are in the map, their fences are type-checked, they follow `docs/writing.md`, and the steward reviews them.
26. **Recorded as `isoloop/web` ADR 0006, "Docs",** covering both repos, as ADR 0004 does. It amends `isoloop/web` ADR 0002 decision 12 and ADR 0005 (the nav), and extends ADR 0004 decisions 2, 4 and 6. Each repo's `AGENTS.md` gets one line pointing to the `docs` skill, and this repo's `CONTRIBUTING.md` says how `docs:check` runs.

### The API reference (phase B)

27. **Our own generator** reads each package's published `.d.ts` rollup with the TypeScript compiler API (tsdown keeps the TSDoc), so it documents exactly what ships. It writes `docs/api/<package>.md` here, committed, and CI fails on drift, as the diagrams' test does. The site renders those pages like any guide, at `/docs/api/<package>/`, and `llms-full.txt` takes them as they are. TypeDoc was the alternative: many dependencies and a theme to fight.
28. **The user-facing packages get a page each,** with a section per entry point: host (with `./dev-mcp`), runtime, bus, dom, react, preact, vite, balancer, devtools and webmcp. protocol and codec are left out; the protocol types host re-exports are documented under host.
29. **Reference details:**
    - Symbols tagged `@experimental` get the site's Experimental pill (`isoloop/web` ADR 0005).
    - The kernel config reference is the generated `KernelConfig` section of the host page.
    - The CLI page is generated from `packages/cli/src/args.ts` by the same script, so a new flag can't be missing from it.
    - Each symbol links to the guides that list it in `map.json`. There's no hand-written `@see` to guides, so the link has one source.
30. **Complete TSDoc,** filled in by the freeze PR (M4d task 1), with `docs:check` item 7 landing in it:
    1. every exported function, class and const has a lead sentence, `@param` for each parameter, `@returns` when it returns something, and `@throws` naming its error codes (for example `not_exposable`, `no_responder`);
    2. every field of an exported options or config type (`KernelConfig`, `TopicOptions`, `connectDevtools`' options …) has its own comment, with its default;
    3. `@example` on the main entry points: `createKernel`, `defineIsolate` (react, preact, dom), `topic`, `contracts`, `isoloop()`, `kernel.request`, `connectDevtools`, `connectWebMCP` and the balancer's entry. These examples are type-checked like the guides' fences.

    The check enforces 1 and 2 everywhere, and 3 on the listed entry points. As of `0.1.0-next.7`, `createKernel`, `Kernel`, `KernelConfig`, `IsolateHandle`, `defineIsolate`, `isoloop()` and `createTestContext` have no top-level TSDoc, and nothing has `@example`.
31. **Search is our own,** with no dependency. A build plugin writes `/docs/search.json` (titles, headings, section text, API symbols, about 40–90 KB gzip), loaded only when the search box gets focus. A module of about 200 lines ranks title over heading over body, with the keyboard and a `/` shortcut. Without JS the box is hidden. Pagefind was ruled out: its WebAssembly needs `'wasm-unsafe-eval'`, which `default-src 'self'` doesn't allow.

## Tasks

About one evening each ([conventions](README.md#conventions)). One PR per task. Forks merge code PRs on green CI. Tasks marked "maintainer" go to the maintainer and aren't merged by the fork. `isoloop/web` tasks 7–12 can be drafted before ADR 0006 is accepted, but merge only after it is.

### Phase A

| # | Task | Repo | Files | Tests | Needs |
| --- | --- | --- | --- | --- | --- |
| 1 | ADR 0006 "Docs" (decisions 2–26 for the site and the pipeline) | web | `docs/adr/0006-docs.md`, `docs/adr/README.md` | — (maintainer) | — |
| 2 | `docs/writing.md`, the `docs` skill, `docs/guide/map.json`, the `AGENTS.md` and `CONTRIBUTING.md` lines | library | `docs/writing.md`, `.claude/skills/docs/SKILL.md`, `docs/guide/map.json`, `AGENTS.md`, `CONTRIBUTING.md` | — (maintainer) | — |
| 3 | `docs:check` items 1, 3, 4 and 6 (skeleton and lead, links, banned phrases, map coverage) and the map notice, in CI and the PR hook | library | `scripts/docs/check.ts`, `package.json`, `.github/workflows/ci.yml`, `.claude/settings.json` | unit: a fixture guide failing each item; the notice on a mapped path | 2 |
| 4 | `docs:check` items 2 and 5: fences type-checked, removed exports named in guides | library | `scripts/docs/fences.ts`, `scripts/ci/api-check.ts` (shared diff) | unit: a fence that fails, `nocheck`, a removed name in a guide | 3 |
| 5 | The six drafted guides brought to the skeleton | library | `docs/guide/{agents,balancer,devtools,hosting,inspection,pools}.md` | `docs:check` | 3 (maintainer) |
| 6 | The docs page mock | web | an artifact | — (maintainer) | — |
| 7 | `renderMarkdown` on `markdown-it` and its conformance suite | web | `apps/site/build/docs/render.ts` | unit: the conformance suite (headings and ids, TOC, tables, fences, links, title and description) | 1 to merge |
| 8 | The tokenizer gets tsx, json and html | web | `apps/site/src/pages/code.tsx` | unit: a sample of each language | 1 to merge |
| 9 | Guides fetched at the pin; the pin checked against npm | web | `apps/site/build/library.ts`, `apps/site/library.lock`, `.github/workflows/site.yml` | unit: the sparse paths; CI: a pin whose versions aren't on npm fails | 1 to merge |
| 10 | `docs.json`, a page per guide, metadata, link rewriting | web | `apps/site/content/docs.json`, `apps/site/build/docs/pages.ts`, `apps/site/pages/doc.tsx` | unit: a missing and an unlisted guide fail; each link kind rewritten; a dead link fails | 7, 9 |
| 11 | The layout from the mock: sidebar, TOC, the `/docs/` index, "Docs" in the nav | web | `packages/ui`, `apps/site/pages/{doc,docs-index}.tsx` | smoke: every docs page loads with no console errors, `expectAccessible`, the link check; phone width | 6, 10 |
| 12 | `llms.txt`, the `.md` copies, `llms-full.txt` (guides) | web | `apps/site/build/docs/llms.ts` | unit: every page listed, with its `.md`; links absolute | 10 |
| 13 | Guide: Getting started, with the `AGENTS.md` snippet | library | `docs/guide/getting-started.md`, `docs/guide/map.json` | `docs:check` | 4 (maintainer) |
| 14 | Guide: What Isoloop can't hide | library | `docs/guide/limits.md` | `docs:check` | 3 (maintainer) |
| 15 | Guide: Writing isolates (vanilla, Preact, React) | library | `docs/guide/isolates.md` | `docs:check` | 4 (maintainer) |
| 16 | Guide: Contracts and grants | library | `docs/guide/contracts.md` | `docs:check` | 4 (maintainer) |
| 17 | Guide: The bus (semantics, durability, retention, groups, request and reply, idempotent handlers) | library | `docs/guide/bus.md` | `docs:check` | 4 (maintainer) |
| 18 | Guide: Supervision and restarts | library | `docs/guide/supervision.md` | `docs:check` | 4 (maintainer) |
| 19 | Guide: Build a dev tool as an isolate | library | `docs/guide/dev-tools.md` | `docs:check` | 5 (maintainer) |
| 20 | The steward reads `docs/writing.md` and the `docs` skill; the weekly docs drift pass | web | `.claude/agents/steward.md`, the weekly routine | — (maintainer) | 2 |

### Phase B (after the freeze)

| # | Task | Repo | Files | Tests | Needs |
| --- | --- | --- | --- | --- | --- |
| 21 | The TSDoc pass at decision 30's bar and `docs:check` item 7, inside M4d task 1 | library | `packages/*/src`, `scripts/docs/tsdoc.ts` | unit: an export without a comment fails, an `@example` that doesn't type-check fails | the freeze (maintainer) |
| 22 | The API generator: `docs/api/<package>.md` from the published `.d.ts`, with the drift test | library | `scripts/docs/api.ts`, `docs/api/` | unit: a fixture `.d.ts`; CI: drift fails | 21 |
| 23 | The CLI page from `args.ts`; each symbol's links to its guides from `map.json` | library | `scripts/docs/api.ts`, `docs/api/cli.md` | unit: every command and flag listed; a symbol's guide links | 22 |
| 24 | The API pages on the site, Experimental pills, the API in `llms-full.txt` | web | `apps/site/build/docs/`, `apps/site/content/docs.json` | unit: an `@experimental` symbol gets the pill; smoke and axe on the API pages | 11, 12, 23 |
| 25 | Search: the index plugin and the search box | web | `apps/site/build/docs/search.ts`, `apps/site/src/search.ts` | unit: ranking; E2E: type, pick a result, land on it; axe; no-JS hides the box | 24 |
| 26 | The skill link in `llms.txt` | web | `apps/site/build/docs/llms.ts` | unit | M4a task 12 |
| 27 | The M4c write-up: what the docs pipeline checks, and what it can't | library | `docs/posts/m4c-docs.md` | — (maintainer) | 25 |

## Open risks

- Docs time is easy to underestimate, which is why "What Isoloop can't hide" (task 14) can start at once.
- The fence check (task 4) type-checks fragments. Guides that show a fragment out of context need `nocheck` or a few hidden lines, and too many `nocheck`s would defeat it. The skill says which.
- The map's notice (decision 21) is judgement, not a gate. A guide can still drift where no mapped path changed; the weekly drift pass is the backstop.
- An AI review can be wrong in both directions; the maintainer's override label from ADR 0004 still applies.
