# ADR 0021: Source layout and entry points

- **Status:** Accepted (2026-11-21), after grilling (Q1–Q31, yes to all). One change since the grilling, accepted with the ADR: decision 6 budgets the code each library entry runs on import, measured with side effects assumed. It replaces Q17's check that a side-effect-only import leaves 0 B, which `sideEffects: false` makes pass whatever the code does.
- **Date:** 2026-11-21
- **Builds on:** [ADR 0009](0009-toolchain.md) rules 3 to 5 (the `@isoloop/source` condition, the dependency rules, lint rules added by name), [ADR 0011](0011-dom-package.md) decision 5 (dom's four folders), and the API freeze with its check ([M4d](../plans/m4d-release.md), decision F1).
- **Plan:** [M4e](../plans/m4e-source-layout.md).

## Context

Most packages keep every module, test and helper side by side at the top of `src/`. Counting files directly in `src/`: host has 38, bus 25, protocol 24, runtime 19 and devtools 18. Only dom has folders by role (ADR 0011).

Each package has one entry file per published subpath. Protocol's and bus's use `export *` (16 and 4 lines). Bus's also publishes the 22 names its TSDoc marks `@internal`, such as `Broker`, `TsEngine` and `MemoryStorage`, some through `export *` and some by name. Host has one folder barrel, `supervisor/index.ts`.

Tree-shaking was measured on `origin/main` `6d02ccc` (`0.1.0-next.10` plus docs), with Rolldown 1.2.18, the bundler of Vite 8.3.7, against the published `dist`, minified:

- **Apps never load a source barrel.** tsdown bundles each entry into one file.
- **Unused exports drop out.** `topic` alone keeps 269 B of the bus entry's 32.8 KB.
- **App bundles:**
  - a host page with `createKernel`: 67.4 KB (23.3 KB gzipped)
  - a contracts module: 6.0 KB
  - a React isolate: 2.7 KB
- **Code that runs on import.** Measured with side effects assumed, each library entry runs 0.2 KB or less, except protocol (1.3 KB), codec (1.7 KB) and `dom/worker` (15.9 KB, which `dom/testing` and `dom/testing/worker` include).
- **Two scripts run code on load** under `sideEffects: false`: bus's worker (61 KB) and the devtools panel (13 KB). A bundler would drop a plain `import` of either.
- Nothing checks any of this.

The freeze makes any change the API check reports go to the maintainer, so a reorganisation must leave the published `.d.ts` alone. A trial move in a scratch copy covered host, bus, runtime and protocol:
- each package's modules into folders, keeping their file names
- host's supervisor barrel removed
- runtime's `render/index.ts` renamed `render.ts`

Every `.d.ts` came out byte-identical, and the JS identical apart from tsdown's `// src/<path>` comments.

Replacing `export *` with explicit lists kept the names and the JS. But it changed the `.d.ts` shape: declarations lose `export`, and one list is added. Today's API check reads that as a change: 62 statements in protocol, 1 in bus.

Moves can also break things silently:
- A test outside a Vitest project's glob stops running.
- A fixture URL that no longer resolves can let a test that expects a failure pass.
- `docs/guide/map.json`'s paths and the diagrams' line citations aren't checked.
- Runtime's `sideEffects` list and the devtools panel's URL depend on where entry files sit.

## Decision

### 1. Entries sit at the top of `src/`

- **An entry** is a file that a package's `exports`, its `bin` or its build points at. The top of `src/` holds only entries, and tests named after one (`index.test.ts`, `worker.browser.test.ts`).
- **Entries keep their paths and their code.** Several things depend on them staying put:
  - runtime's `sideEffects`, which names its worker scripts by path
  - the `@isoloop/source` conditions and the e2e tsconfigs, which point at entries
  - the devtools entry, which finds `./panel.js` next to itself
- **dom keeps its entries in its four folders** (`src/worker/index.ts` and the rest), as ADR 0011 decided.

Rules: `tool.entries-at-top`

### 2. Everything else lives in an area

- **An area** is a folder directly under `src/`, named for a concept from the [system design](../design/system-design.md), such as `kernel`, `supervisor`, `render`, `broker` or `contracts`. Area names are kebab-case. Areas are one level deep; only `__fixtures__/` may nest.
- **Never a folder by kind:** no `utils`, `helpers`, `lib`, `common`, `misc` or `types`. dom's `shared/` names a role, the code both halves use, as ADR 0011 decided.
- **Every package follows this,** the small ones too. codec, vite, balancer and cli get one area each.

Rules: `tool.areas`

### 3. No barrels inside a package

- **`index.ts` is only ever an entry.** A module imports the file that defines what it needs. Host's `supervisor/index.ts` goes.
- **Entries name what they export.** Explicit lists replace `export *` in protocol and bus. Once the API check compares names and declarations (decision 8), the lists change nothing it reports.
- **The bus entry stops exporting the `@internal` names no other package imports.**
- **One entry per published subpath stays.** Those entries are the frozen API, and the API check, `docs:check`, `map.json` and the reference generator all read them. They cost apps nothing, because tsdown bundles each into one file.

Rules: `tool.no-barrels`

### 4. Tests and fixtures

- **A test sits next to the code it tests.** A scenario test that drives a package through its entry sits in the area it exercises. Host's kernel scenarios (pools, suspension, stop and spawn, grants and the like) live in `src/kernel/`.
- **`src/__fixtures__/`** holds the files tests load by URL: workers, isolates, contracts modules. There's one per package.
- **`test/`** at the package root holds helpers that tests import, such as fakes, shared suites and the balancer's simulated kernel. It holds no test files.
- **Tests and fixtures may use a relative path to reach another package's scripts,** to start a real worker.
- **Shipped code never uses a relative path to leave its package.** It imports other packages by name, under the dependency rules of ADR 0009 rule 4.

Rules: `tool.tests-next-to-code`, `tool.no-relative-escape`

### 5. Moving files

- **A move keeps the file's name.** tsdown names a shared declaration chunk after its first module (`kernel-<hash>.d.ts`), and the API check reads that name.
- **A move changes nothing in `dist` except tsdown's source-path comments.** The trial proved it for four packages, and each move PR proves it again:
  - every `.d.ts` is identical
  - the JS is identical apart from the `// src/<path>` comments
  - the API check reports no change
  - each Vitest project has the same test files
- **History docs keep the paths of their day:** ADRs, plans, posts and investigations.
- **Living docs follow the code:** the system design, the guides and `map.json`, the diagrams, the READMEs, `CONTRIBUTING.md` and the skills.
- **No living doc carries a folder map.** It would drift, and the tree shows the layout anyway. Decision 9 records the map as it was accepted.

Rules: `tool.moves-keep-names`, `tool.docs-paths`

### 6. The tree-shaking contract

- **ESM only,** one bundled file per entry, plus the shared chunks tsdown makes.
- **Every package declares `sideEffects: false`, except for its scripts.** A script is an export without `types`, a file that runs when it's loaded:
  - bus's worker
  - runtime's bootstrap and worker
  - the devtools panel

  Each script is listed in its package's `sideEffects`, by both its `./src/` and its `./dist/` path.
- **Each library entry has a budget for the code it runs on import.** It's measured with side effects assumed, because `sideEffects: false` would hide it. A new global side effect at the top of a module (a `customElements.define`, a patched global) shows up there.
- **An app pays for what it imports.** Unused exports drop out of every entry.
- **Everything the kernel does ships with `createKernel`,** because its features are methods of one object. That comes from the API's shape, not from a tree-shaking fault.

Rules: `tool.esm-only`, `tool.side-effects`

### 7. Bundle budgets

- **`bench/bundle-size` bundles through Vite's own `build()`,** so its numbers are what a Vite 8 app gets. It reports minified and gzipped sizes and asserts the minified ones.
- **It budgets:**
  - each library entry's import-time code (decision 6)
  - seven app bundles: a host page, with devtools, with the balancer, a contracts module, and a React, a Preact and a vanilla isolate
  - the four scripts
- **Each budget is its size at acceptance plus 5%, rounded up to the next 0.5 KB.** A PR that crosses one raises it in the same PR and says why in its description.
- **The recorded table lives in `bench/bundle-size/README.md`.** It names the Isoloop, Vite and Rolldown versions and the date, and the bundle-size guide links it.

Rules: `tool.bundle-budgets`

### 8. Enforcement

| Rule | Checked by |
| --- | --- |
| No `export *` barrels, no import cycles, kebab-case file names | oxlint, with three rules added by name, as ADR 0009 rule 5 allows: `oxc/no-barrel-file` (threshold 0), `import/no-cycle` and `unicorn/filename-case` |
| Decisions 1, 2 and 4 on the file tree | The layout test (`scripts/layout/`, run by `pnpm test`). See the list below this table |
| Decisions 6 and 7 | The bundle guard, in CI after the build |
| The `./dist/` paths in `sideEffects` | `check-exports`, after the build |
| `map.json`'s paths | `docs:check` |
| The diagrams' citations | Each citation carries the text of its first cited line. The diagrams test fails when that line moves, and the anchor script finds it again |
| The public API | The API check compares exported names and their declarations, so the shape of a list and `@internal` names inside one don't count as changes |

The layout test checks that:
- only entries and tests named after them sit at the top of `src/`
- `index.ts` appears only as an entry
- folders are one level deep, kebab-case and never a kind name
- `__fixtures__/` exists only at `src/__fixtures__/`, and `test/` holds no test files
- shipped code never uses a relative path to leave its package
- every test file is in at least one Vitest project
- every file a test or fixture loads by URL exists
- every `./src/` path in `sideEffects` exists

A `pending` list of packages not yet moved only shrinks, and the last move deletes it.

When a `no-changeset` PR changes the dist JS beyond tsdown's source-path comments, the API check says so in its job summary. It's a notice, not a failure, since a refactor may change output on purpose.

There's no custom lint rule. oxlint's JS plugins are alpha and outside semver, and oxlint is bumped every week.

Rules: `tool.layout-lint`, `tool.layout-test`

### 9. The layout at acceptance

| Package | Areas | Entries at the top of `src/` |
| --- | --- | --- |
| host | `kernel/` (kernel, loader, features, version, and the kernel scenarios), `supervisor/` (machine, timers), `bus/` (controller), `render/` (compositor, events, bridge, registry, isoloop-dom), `router/`, `inspect/` (inspect, memory), `agents/` | `index`, `dev-mcp` |
| bus | `contracts/` (topic, standard-schema, json-schema), `broker/` (broker, seed, size), `server/` (server, tap, preview), `engine/`, `storage/` | `index`, `testing`, `worker` |
| runtime | `isolate/` (vanilla, host-calls, keep-awake, inspector), `bus/` (bus-client), `pools/` (busy, freeze), `render/` (render, renamed from `index`) | `index`, `testing`, `bootstrap`, `worker` |
| protocol | `messages/` (envelope, isolate, events, bus, control, inspect, dev-mcp, version), `topics/` (topics, system-topics, route, grants, json-schema, commits), `errors/` (errors, bus-error) | `index` |
| devtools | `feed/` (feed, event-store, event-level), `views/` (views, bus-view, events-view, messages-view, record-detail, subtabs, format), `panel/` (ring, persist) | `index`, `panel` |
| react, preact | `isolate/` (define, context, and the adapter tests), `hooks/` | `index` |
| balancer | `balancer/` (balancer, claim, types), with `sim.ts` in `test/` | `index` |
| vite | `plugins/` (build, dev, guard) | `index` |
| codec | `codec/` (format, encode, decode, errors) | `index` |
| cli | `program/` (main, args, command, io, version), `commands/`, `mcp/` | `cli` |
| dom, webmcp | unchanged | unchanged |

## Consequences

- **npm users see no change from the moves:** the same declarations and the same code.
- **A reader finds a package's public surface in its entry files,** and its parts in a few named areas.
- **`@isoloop/bus` stops exporting internal names,** so apps no longer see `Broker` or `TsEngine` in autocomplete. The CLI keeps the one it imports.
- **bus and devtools declare their scripts in `sideEffects`,** so no bundler drops them.
- **Every new file needs an area.** A new area is a folder named for a concept, which review can question.
- **Bundle sizes become reviewed numbers.** A PR that grows one past its budget says why.
- **CI does more:**
  - The layout test joins `pnpm test`, and the bundle guard becomes a step after the build.
  - The API check gets stricter about what counts as a change, and adds a notice on refactors.
- **The site's feature proofs point at the old paths** until the site's library pin moves ([M4e](../plans/m4e-source-layout.md), task 17).
- **The big files stay big until after 0.1:** `kernel.ts` (2,010 lines), `broker.ts` (1,564), the worker DOM (1,428) and `balancer.ts` (1,237). Each gets split along its seams later.
- **History docs' paths go stale on purpose.**

## Alternatives considered

- **One subpath per module, or an unbundled `dist`.** A bundler could then drop whole files. But every subpath is a public promise, the freeze settled the subpaths, and bundled entries already tree-shake.
- **A custom oxlint rule for the layout.** It would give editor feedback, but its plugin API is alpha.
- **Flat small packages.** Fewer folders, but the rule would need a size threshold, and any threshold is arbitrary.
- **A package-level `test/` for scenario tests.** It would separate them from unit tests. But it moves fixtures and globs further, and puts tests away from the code they cover.
- **Entries emptied into re-export files.** That's uniform, but runtime's `sideEffects` and the panel's URL depend on where the code is, and the failure would be silent.
- **Explicit lists after 0.1.** Less work now, but 0.1 is when apps first see the bus entry.
- **`/* @__PURE__ */` on protocol's top-level calls.** It would save about 1 KB per app.
- **Splitting the big files now.** The moves would stop being provable no-ops, just before the release.
- **A folder map in the living docs.** It would drift, and the tree and the layout test already state it.
- **webpack and esbuild in the guard.** More coverage, but two new dependencies, and Vite is the build the docs describe.
- **A line cap.** Splits should follow seams, not a number.
