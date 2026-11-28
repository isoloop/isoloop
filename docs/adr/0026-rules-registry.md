# ADR 0026: Rules registry

- **Status:** Accepted 2026-11-27 (proposed the same day), from a grilling with the maintainer (Q1–Q31, yes to all), with a `superseded` event and `Rules:` lines required from ADR 0026 on, added in review. Amended 2026-11-27 (accepted the same day), from the four open points of the infrastructure PR (#483), grilled yes to all: every ADR ref names a heading (decision 6), rules about the repo (decisions 2, 5 and 10), when `rules:ship` is due (decision 13) and what counts as a decision (decision 9). Amended 2026-11-28 (accepted the same day), from the maintainer's review of the view prototypes: the views and their tabs, an "as of" option, derived links, keywords, a config file and one module per view (decisions 2 and 15). Amended again 2026-11-28 (accepted the same day), from a grilling on the design system (Q1–Q11 and Q15, yes to all): the tool becomes Archeion, a product-neutral tool with its own design system, Isoloop's palette as one theme, token layers, a literal ban, components, layout and type rules, a chart toolkit, a specimen page and its tests (decision 15).
- **Date:** 2026-11-27
- **Plan:** none. This is internal tooling for the repo, not a milestone, and it ships nothing to npm.
- **Touches:** every ADR (each decision gains a `Rules:` line), [ADR 0019](0019-versioning-and-releases.md) (version PRs run `rules:ship`), [ADR 0009](0009-toolchain.md) (scripts run on Node with no new dependency).

## Context

The ADRs record why each part of Isoloop works the way it does, and they read as stories. A reader who wants a fact ("what's the bus worker's restart limit, and can I change it?") has to find the ADR, read a decision, then check each amendment below it. ADR 0007's restart limit, for example, was decided on 2026-11-03, clarified on 2026-11-20 and amended on 2026-11-24, in three places in the file. The index row for ADR 0016 holds the decision, its reasons, an amendment and a deferral in one paragraph. An agent working in the repo has the same problem, at a higher cost in tokens.

The forces:

- **A fact must change in the same PR as the ADR that changes it,** or the two drift. So the facts live in this repo, next to `docs/adr/`.
- **A fact often has several sources.** `sup.worker-per-isolate` comes from ADR 0001 and is amended by ADR 0017. It can't live inside one ADR.
- **It's for the maintainer and agents.** It isn't published on isoloop.dev, so it doesn't follow the public copy rules or the site's release path. The repo is public, so the files are visible on GitHub.
- **No new dependency.** The checks are plain Node scripts, like `scripts/docs/check.ts`.

## Decision

### What a rule is

1. **A rule is one fact:** one default or one behaviour, as it holds today. "The bus worker restarts at most 3 times in 60 s" and "a crash after a short healthy run counts" are two rules. When one ADR section holds three facts, it becomes three rules, linked through `related`.

   Rules: `tool.rule-one-fact`
2. **A rule's fields:**

   | Field | Required | Holds |
   | --- | --- | --- |
   | `id` | yes | `<prefix>.<slug>`, kebab-case, never changed (decision 4) |
   | `statement` | yes | one or two sentences in the present tense: what holds, with no why |
   | `status` | yes | one of six (decision 5) |
   | `experimental` | no | `true` for an `@experimental` API; a flag, not a status |
   | `values` | no | the defaults and limits, as short strings (`3 restarts`, `60 000 ms`) |
   | `knob` | no | how an app changes it (`KernelConfig.supervisor`) |
   | `errors` | no | error codes and events it produces (`bus_unavailable`, `bus:failed`) |
   | `code` | no | repo paths where it's built |
   | `since` | for `active` | the first released version where it held |
   | `target` | for `decided` and `proposed` | the planned version |
   | `related` | no | ids of rules a reader should see next |
   | `supersededBy` | for `superseded` | the id that replaced it |
   | `aliases` | no | old ids, after a rename or a move |
   | `events` | yes | its history, oldest first (decision 6) |

   Amended 2026-11-27: a rule may also carry `repo: true` ([rules about the repo](#amended-2026-11-27-rules-about-the-repo)).

   Rules: `tool.rule-fields`

3. **The statement follows [`docs/writing.md`](../writing.md),** and gets the prose check during the backfill like other copy. The why isn't in the statement: the current why is the newest `decided`, `amended` or `clarified` event's `why`, so there's no separate field to drift from the history.

   Rules: `tool.statement-form`, `tool.current-why`
4. **Ids** are `<prefix>.<slug>`. The prefix names the concept (decision 7). An id never changes: a renamed or moved rule gets a new id and keeps the old one in `aliases`, so links from ADRs keep working. A rule that stops holding changes status. It's never deleted.

   Rules: `tool.ids-never-change`, `tool.rules-never-deleted`
5. **Six statuses:**
   - **`active`:** accepted and shipped;
   - **`decided`:** accepted, not shipped yet;
   - **`proposed`:** in a Proposed ADR or an open question;
   - **`withdrawn`:** accepted, then taken back with no replacement;
   - **`rejected`:** an alternative we said no to. Only alternatives that answer a real "why don't you just…?" become rules, and the `why` names that question. Smaller options stay in the ADR's Alternatives considered;
   - **`superseded`:** replaced by the rule in `supersededBy`.

   "Merged but not released" is a `built` event, not a status.

   Amended 2026-11-27: a repo rule is `active` from its `built` event ([rules about the repo](#amended-2026-11-27-rules-about-the-repo)).

   Rules: `tool.rule-statuses`, `tool.rejected-rules`
6. **Events.** Twelve types. Each has a `type`, a `date` (`YYYY-MM-DD`), a `ref` and a one-line `why`:

   | Type | Means | `ref` |
   | --- | --- | --- |
   | `proposed` | written in a Proposed ADR or an open question | ADR section or issue |
   | `decided` | accepted | ADR section |
   | `clarified` | the wording changed, the behaviour didn't | ADR section |
   | `amended` | the behaviour changed | ADR section |
   | `built` | merged on `main` | PR |
   | `shipped` | first in a released version | release tag, generated (decision 13) |
   | `corrected` | a record was wrong, for example it said built when it wasn't | ADR section |
   | `reopened` | the question went back to an issue | issue |
   | `removed` | taken out with no replacement | ADR section |
   | `rejected` | an alternative we said no to | ADR section |
   | `withdrawn` | an accepted rule taken back | ADR section |
| `superseded` | replaced by another rule, named in `supersededBy` | ADR section |

   `clarified` and `amended` also need `prev`: the old wording or behaviour, so the rule as it was can be read without opening the ADR. A `ref` is something a reader can open on GitHub: an ADR file and heading anchor, a PR, an issue or a release tag. Grilling notes and agent memory are never a source.

   Amended 2026-11-27: an ADR ref always names a heading ([every ADR ref names a heading](#amended-2026-11-27-every-adr-ref-names-a-heading)).

   Rules: `tool.event-types`, `tool.event-prev`, `tool.event-refs`

### Where rules live

7. **Concepts.** A fixed list in `docs/rules/concepts.json`: an id, a prefix, a name, a one-line description and an order. Each rule belongs to exactly one concept. The first list, matched to the guide pages where one exists:

   | Prefix | Concept |
   | --- | --- |
   | `iso` | Isolates |
   | `sup` | Supervision |
   | `bus` | Bus |
   | `dur` | Durability |
   | `con` | Contracts & schemas |
   | `route` | Routing |
   | `dom` | Rendering |
   | `pool` | Pools |
   | `bal` | Balancer |
   | `agent` | Agents & tools |
   | `insp` | Inspection & devtools |
   | `watch` | Watchers |
   | `ver` | Versioning & releases |
   | `tool` | Toolchain & layout |
   | `derive` | Derived topics |
   | `native` | Native runtimes |
   | `tauri` | Tauri |

   A concept is added in a normal PR.

   Rules: `tool.rule-concepts`
8. **Files.** JSON, one file per concept, so a PR's diff stays inside the concept it touches:
   ```
   docs/rules/
     concepts.json
     supervision.json     ← an array of rules
     …
     schema.json          ← JSON Schema, for editor hints only
     README.md            ← generated (decision 11)
   ```
   `scripts/rules/check.ts` does its own validation; there's no validator library.

   Rules: `tool.rules-json`
9. **The registry is the source of truth.** ADRs stay the story of why. Each decision and each amendment in an ADR ends with one line naming the rules it adds or changes:
   ```md
   Rules: `sup.restart-limit`, `sup.short-runs`
   ```
   This amends the ADR template in [the index](README.md). The `Rules:` lines are added to the existing ADRs during the backfill (decision 16), and to every new ADR from the start.

   Clarified 2026-11-27: which parts of an ADR count as decisions ([what counts as a decision](#clarified-2026-11-27-what-counts-as-a-decision)).

   Rules: `tool.registry-source`, `tool.rules-lines`

### Checks

10. **`pnpm rules:check`** runs in `ci.yml` next to `docs:check`, and fails when:
    - a field is missing or has the wrong type;
    - an id or alias is used twice, or its prefix isn't in `concepts.json`;
    - a `related` or `supersededBy` id doesn't exist;
    - an ADR `ref` names a file or heading anchor that doesn't exist;
    - a `Rules:` line in an ADR names an unknown id;
    - a `clarified` or `amended` event has no `prev`;
    - the status doesn't match the fields and events: `active` needs `since` and a `shipped` event; `decided` and `proposed` need `target`; `withdrawn`, `rejected` and `superseded` need their own event, and `superseded` also needs `supersededBy`, an id that exists;
    - a `code` path doesn't exist;
    - `docs/rules/README.md` isn't what `rules:build` would write.

    Whether each `values` entry matches the default in the code is left for after the backfill, once it's clear how many can be read from the code ([would-like](../would-like.md)).

    Amended 2026-11-27: it also checks repo rules ([rules about the repo](#amended-2026-11-27-rules-about-the-repo)).

    Rules: `tool.rules-check`
11. **`rules.yml`**, a workflow of its own like `changeset.yml`, so adding or removing its label re-runs only this check:
    - a PR that changes `docs/adr/**` must change `docs/rules/**`, unless it has the `no-rules` label. That label is for edits that change no fact (typos, links), and an agent may add it, like `no-changeset`;
    - it fails if an id or alias on `main` is missing from the PR.

    - every decision and amendment in an ADR numbered 0026 or higher has a `Rules:` line, from the start.

    Until the backfill is done, the pairing applies to older ADRs only once they have `Rules:` lines.

    Rules: `tool.adr-pairing`, `tool.rule-ids-kept`, `tool.rules-lines-from-0026`
12. **Who writes rules.** Whoever changes an ADR updates its rules in the same PR. CI catches a registry left untouched. The steward's instructions gain one line, so it catches a registry that says something different from the ADR: "rules that don't match what the ADR says are a must-fix".

    Rules: `tool.rules-same-pr`
13. **`pnpm rules:ship <version>`** runs in the version PR. Each rule whose `target` is that version becomes `active`: `since` is set, a `shipped` event is added with the tag's date, and `target` is removed. `rules:check` fails a version PR that leaves such a rule `decided`. Version PRs then carry edits beyond the changesets, so they take the `no-changeset` label. The backfill runs it for `0.1.0` and `0.1.1` to create the existing `shipped` events.

    Clarified 2026-11-27: when a version PR has to run it, and patches from a `release/0.x` branch ([when `rules:ship` is due](#clarified-2026-11-27-when-rulesship-is-due)).

    Rules: `tool.rules-ship`

### Views

14. **`pnpm rules:build`** writes `docs/rules/README.md`, which is committed: one section per concept, each with a table (id, statement, values, status, `since` or `target`) and then each rule's history as a short list (date, type, ref, why). It's the version agents and GitHub readers use.

    Rules: `tool.rules-readme`
15. **`pnpm rules:board`** writes one self-contained HTML page, with the data inlined and no server, to a gitignored path, prints the path and opens it. The template is `scripts/rules/board.html`, taken from the demo built while this ADR was grilled. It has:
    - **Board:** concepts as columns, rules as cards (id, status, statement, values, events count, `since`), with status filters and a search over ids, values, knobs and refs. Rejected, withdrawn and superseded rules are dimmed.
    - **Rule drawer:** the fields first, then the current why, then the history newest first, with `prev` as a "Before:" line, then the related rules.
    - **Agenda:** every event by day, newest first, with a "by version" toggle that groups events under the release they shipped in, or under "Unreleased". A "rules as of version X" view comes later.
    - The page fills the window's width, uses isoloop.dev's palette (`packages/ui/src/tokens.css` in `isoloop/web`) and has a System, Light and Dark switch.

    Rules: `tool.rules-board`

### Rollout

16. **The backfill.**
    1. One infrastructure PR after this ADR is accepted: the schema, `check.ts`, `build.ts`, `board.html`, `concepts.json`, an empty file per concept, `rules.yml`, the `ci.yml` step, the `AGENTS.md` line (decision 17) and the steward line.
    2. Then one PR per concept. A fork writes its rules and adds the `Rules:` lines to the ADRs. The maintainer reviews each PR on its own, and it's squash-merged.
    3. Supervision, Durability and Versioning & releases go first, then the others in the guide's order. Withdrawn ADR 0013 counts, as a withdrawn rule. This ADR's own rules go in `tool`, and its `Rules:` lines are added in the infrastructure PR, since decision 11 holds it to them.

    Rules: `tool.rules-backfill`
17. **`AGENTS.md`** gains one rule: "For what holds today, read `docs/rules/README.md`; an ADR change updates `docs/rules/` in the same PR."

    Rules: `tool.agents-md-rules`
18. **Scope.** Only this repo's ADRs. The web and social repos could get their own registry later, with the same format and tooling.

    Rules: `tool.rules-scope`
19. **No milestone.** It runs beside the milestones (now M8 Watchers W1), every PR takes `no-changeset`, and it isn't on the roadmap.

    Rules: `tool.rules-not-milestone`

### Amended 2026-11-27: every ADR ref names a heading

Open point 1 of #483, grilled 2026-11-27, yes. It amends decision 6's `ref`:

- **An ADR ref is `adr/NNNN#anchor`:** the ADR's number and the GitHub anchor of a heading in it. The anchor is required, so a ref opens at the decision it means.
- **A PR or an issue** is `#390`, or `web#285` in another isoloop repo. **A release tag** is `vX.Y.Z`.
- **Each event type takes only the ref kinds in decision 6's table.** `rules:check` fails on any other ref, on an ADR ref with no anchor, and on an anchor the ADR doesn't have.

Rules: `tool.event-refs`

### Clarified 2026-11-27: when `rules:ship` is due

Open point 4 of #483, grilled 2026-11-27, yes. It records decision 13 as built:

- **`rules:check` fails when a `decided` or `proposed` rule's `target` is at or below the packages' version.** A preview such as `0.2.0-next.3` is below `0.2.0`, so previews never trigger it. The version PR that sets `0.2.0` does.
- **A patch from a `release/0.x` branch** ([ADR 0019](0019-versioning-and-releases.md), decision 5) runs `rules:ship` in that branch's version PR, so its `shipped` event is made on the branch. The event comes to `main` with the backport.

Rules: `tool.rules-ship-due`, `tool.rules-ship-patches`

### Amended 2026-11-27: rules about the repo

Open point 8 of #483, grilled 2026-11-27, yes. It amends decisions 2, 5 and 10:

- **A rule may carry `repo: true`** when it's about how this repo works (its checks, its process, its tooling) rather than the published packages.
- **A repo rule is `active` from its `built` event,** the PR that put it in force. It has no `since`, no `target` and no `shipped` event, and `rules:ship` skips it.
- **Its card and the README show "in force since #N"** in place of a version.
- **`rules:check` fails** when a repo rule has `since`, `target` or a `shipped` event, or is `active` with no `built` event.
- **This ADR's own `tool.*` rules are repo rules,** in force since #483.

Rules: `tool.repo-rules`, `tool.rule-fields`, `tool.rule-statuses`, `tool.rules-check`

### Clarified 2026-11-27: what counts as a decision

Open point 9 of #483, grilled 2026-11-27, yes. It clarifies decision 9 and the template line in [the index](README.md). The `Rules:` line check (decision 11) reads an ADR's `## Decision` section this way:

- **A numbered `###` heading** (`### 1. …`) is a decision, when the ADR has any.
- **Otherwise a top-level numbered item** (`12. …` at the start of a line) is one, up to the next item or heading.
- **Otherwise each `###` section** is one.
- **Any heading that says "amended"** is an amendment, up to the next heading of the same or a higher level.
- **A `Rules:` line inside a code fence doesn't count.**

Rules: `tool.rules-lines-sections`

### Amended 2026-11-28: views, links, keywords and config

From the prototypes reviewed on 2026-11-28 (a hive plot, keywords, a keyword map, a timeline with churn, a version slider with a diff, and sources with code and health), approved by the maintainer. A matrix with a chord diagram and a honeycomb were built and not taken. It amends decisions 2 and 15:

- **The page has six tabs,** routed by the URL's hash. This replaces the list in decision 15:
  - **Board** and **Agenda**, as in decision 15;
  - **Hive:** a hive plot, one axis per concept and a dot per rule, with links drawn as curves between axes;
  - **Keywords:** the keyword glossary and the keyword map;
  - **Timeline:** every event in one lane per concept, with a **Churn** heatmap of `amended`, `clarified` and `corrected` events per concept and day;
  - **Sources:** where rules come from (ADRs into concepts), where they live in the code (a treemap of `code` paths) and a **Health** list of where the registry is weak.
- **An "as of" option on Board, Agenda and Hive** rebuilds each rule as it stood on a chosen date or release, and a diff lists what changed between two points. It has known limits, accepted for now: events have a date and no time, so a point includes its whole day; earlier wording comes from `prev`, which is free text; and only the statement and the status have a history.
- **Links are derived when the page is built,** in four kinds: `related` and `supersededBy`; two rules citing the same ADR section; a shared symbol; a shared `code` path. A key shared by more than 12 rules makes no links, and the page lists it instead. A link from a key shared by n rules weighs 1/(n−1), so a narrow key counts more than a broad one.
- **Keywords are a fixed vocabulary** in `docs/rules/keywords.json`: an id, a label, a one-line definition and aliases. A rule may name keywords in a new optional `keywords` field, and `rules:check` fails on an unknown one. The first vocabulary is the 42 keywords of the reviewed prototype. The maintainer reviews the keywords on each concept's rules, one concept per PR, like the backfill.
- **Symbols are derived,** from backticked names in statements, knobs and errors. They feed search and the shared-symbol links, and are never written by hand.
- **One config file** holds what's particular to a repo: the title, the rules and ADR folders, the ADR number from which `Rules:` lines are required, the GitHub owner and repo for links, and where the page is written. The scripts hold nothing about Isoloop, so the tooling can move to another repo unchanged.
- **Each view is its own module** next to a small shell that holds the tabs, the shared filters, the theme and the rule drawer. `rules:board` still writes one self-contained page.

The board's existing rules change in the PRs that build each part, so each one says what holds once it's built.

Rules: `tool.rules-tabs`, `tool.rules-hive`, `tool.rules-keywords-tab`, `tool.rules-timeline`, `tool.rules-sources`, `tool.rules-as-of`, `tool.rules-as-of-limits`, `tool.rules-links`, `tool.rules-link-cap`, `tool.rules-link-weight`, `tool.rules-keywords-file`, `tool.rules-keyword-review`, `tool.rules-symbols`, `tool.rules-config`, `tool.rules-view-modules`

### Amended 2026-11-28: design system

Grilled with the maintainer on 2026-11-28 (Q1–Q11 and Q15, yes to all) before any view is built. It amends decision 15 and the previous amendment:

- **The tool is a separate product, Archeion, with its own design system.** The rules registry is Isoloop's use of it. Archeion is product-neutral: nothing in its code, tokens or components is about Isoloop. Isoloop uses it only as dev tooling, its published packages never depend on it, and it moves to a repo of its own later.
- **Isoloop's palette is one theme,** chosen in `rules.config.json`. A theme sets only the semantic tokens and may bring a webfont.
- **Tokens come in three layers:** primitives (raw values: colours, space, radius, type), semantic tokens (what a value is for: background, text, accent, status) and component tokens (what one component uses). Components read only semantic and component tokens. There are 8 categorical chart slots.
- **Literals are banned outside the token files.** `rules:check` fails on a colour, a font size, a font family or a spacing value written in a component or a view, except in the files on one allowlist.
- **Components are plain functions** that return HTML through an `html` tagged template. It escapes every value, and `raw()` marks HTML that's already safe. There's no framework.
- **Layout uses four primitives,** Stack, Cluster, Grid and Split, spaced with `gap`. A component never sets its own outer margin.
- **Type has a 5-step scale** (xs, s, m, l, xl), with tabular numbers wherever digits line up. Data views stay at the m step or below. The default font is the system stack, and a theme may swap in a webfont.
- **Charts share one toolkit:** scales, axes, a legend, a tooltip and SVG helpers. A chart with more than 8 categories groups the rest.
- **CSS uses `@layer`** (reset, tokens, base, layout, components, views). Each class is prefixed with its owner, a component or a view. There are no utility classes.
- **The prefix comes from Archeion's name:** `--ar-` for tokens and `.ar-` for classes, used the same way everywhere so a rename stays one mechanical pass.
- **A specimen page,** written by `rules:board --specimen`, shows every token, type step, layout primitive, component and chart part.
- **Tests:**
  - contrast at WCAG AA for every text and background pair, in both themes;
  - the literal ban;
  - unit tests for each component;
  - a headless smoke test of every view and the specimen at 2 widths in both themes, checking for console errors and sideways scroll.

  There are no pixel snapshots.

Rules: `tool.rules-product-neutral`, `tool.rules-own-repo`, `tool.rules-theme`, `tool.rules-tokens`, `tool.rules-chart-slots`, `tool.rules-literal-ban`, `tool.rules-components`, `tool.rules-layout-primitives`, `tool.rules-type-scale`, `tool.rules-chart-toolkit`, `tool.rules-css-layers`, `tool.rules-css-prefix`, `tool.rules-specimen`, `tool.rules-ds-tests`

## Consequences

- **A fact has one place,** with its values, how to change it, where it's built and every decision that touched it, readable in a table or on the board.
- **ADR PRs cost a little more:** each one also edits `docs/rules/`, and the check holds it to that.
- **Version PRs gain a step** (`rules:ship`) and the `no-changeset` label.
- **The backfill is real work:** roughly 150 to 250 rules from 25 ADRs, each concept reviewed by the maintainer.
- **The registry can still be wrong** where CI can't see: a statement that misreads its ADR, or a default that differs from the code. The steward catches the first; a later conformance test may catch the second.
- **It isn't for users.** The docs stay "how to use it, not why", and don't link the registry.

## Alternatives considered

- **Markers inside the ADRs, with the registry generated from them:** a rule touched by several ADRs has no single home, and the fields an ADR doesn't have (status today, `since`, `code`) would be scattered across files.
- **A package under `packages/`:** it would join the `@isoloop/*` fixed release group and pick up the API check, the bundle guard and the layout rules, for a tool that's never published.
- **A separate repo:** CI couldn't hold an ADR PR to its rules, agents in this repo couldn't see them, and each amendment would take two PRs.
- **A page on isoloop.dev:** every rule would read as a promise to users, need the public copy rules, and need the docs and the registry to agree on every default. It can come later as a filtered view of the same data.
- **One rule per ADR section:** fewer cards, but a card would again hold a paragraph to dig a default out of.
- **A private `board/` workspace for the viewer:** the repo's scripts already run on Node with no package, so a workspace adds a `package.json` and a workspace entry for nothing.
