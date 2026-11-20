---
name: docs
description: Write or update Isoloop's docs (the guides in docs/guide, TSDoc, docs/guide/map.json). Use when a change adds, changes, renames or removes public API or behaviour users rely on; when adding, renaming or removing a guide; or when reviewing a PR's docs.
---

# Write the docs for a change

The docs change in the same PR as the code, written by whoever makes the change ([M4c](../../../docs/plans/m4c-docs.md), decision 17). How to write them is [`docs/writing.md`](../../../docs/writing.md): read it before writing, and follow every rule in it.

There are two kinds of page:

- **Guides** (`docs/guide/*.md`), written by hand, one per feature or task, in the skeleton `docs/writing.md` gives.
- **The API reference** (`docs/api/`), generated from the TSDoc of the published `.d.ts`. You change it by changing the TSDoc, never by editing the page.

## 1. List what the change touches

Write down two lists from the diff:

- **Exports:** every public export added, changed, renamed or removed, per entry point (`@isoloop/host`, `@isoloop/host/dev-mcp`, …). The API check's report on the PR lists them. Leave out declarations marked `@internal`.
- **Behaviour:** everything a user relies on that now works differently, even where no type changed: a default, an error code, a timing, a limit.

For each item, find the guides that cover it in [`docs/guide/map.json`](../../../docs/guide/map.json): the guides whose `paths` contain a file you changed, and the guides whose `exports` name the export.

Done when every item on both lists has its guides named, or is marked "reference only" (no guide describes it).

## 2. Change the docs

| The change | What to update |
| --- | --- |
| A new feature | A section in the guide that covers its area. If no guide fits, a new guide (step 4). TSDoc on every new export. |
| Changed behaviour | Every section, in every guide found in step 1, that describes the old behaviour. The TSDoc of the exports involved. |
| A renamed export | Every page that names it, in prose and in code. |
| A new name for something users see or type (an option value, a CLI flag, an error code, a tab, button or column in the panel), or a changed limit | Every place that states it: the guides, the package README, the changeset, the TSDoc, and the site's feature entries (through Site impact). Search for the old name or figure; don't rely on the map. |
| A removed export or feature | Rewrite or delete every section that names it. If a whole guide goes, step 4. |
| A new limit found | The guide's `## Limits`, and "What Isoloop can't hide" if it applies to Isoloop as a whole. |
| A new or changed measurement | The figure, with its device, build, version and date, and its link to the results. |

TSDoc follows the bar in `docs/writing.md` § TSDoc.

**The changeset** says what changed, as shipped. It gives a limit, a default or a count only with the exact figure the guide gives; otherwise it leaves it to the guide.

**An ADR the change makes stale** is fixed in its own PR, since ADR changes go to the maintainer. Open it as a draft that says "after #N" (the code PR), with no date, and rebase it once #N merges: only then does the ADR describe code that exists.

Done when every item from step 1 has its docs change, or the PR description gives the reason it needs none.

## 3. Keep the map current

In `docs/guide/map.json`:

- **A new export** goes in the `exports` of the guide that documents it, or in `referenceOnly` under its entry point when no guide describes it.
- **A renamed or removed export** is renamed or removed there too.
- **A new source file** that a guide describes goes in that guide's `paths`. A directory path ending in `/` covers every file under it.

Every public export is covered: in a guide's `exports`, in `referenceOnly`, or (for an interface or type alias) reached from a covered export's signature. Re-exports count as the declaration they point at.

**`pending`** lists the exports no guide covers yet, grouped by the M4c task that will cover them (or `freeze`, decided at the API freeze). It only shrinks: CI fails when a PR adds a name to it, so a new export goes straight into a guide or `referenceOnly`. When your guide covers a pending name, move it into the guide's `exports` and delete it from `pending`; the check fails while a name is in both, or is pending but already reached.

## 4. Add, rename or remove a guide

A page change spans both repos:

1. **Here:** add, rename or delete `docs/guide/<slug>.md`, and its entry in `map.json`. Fix every relative link that pointed at the old name.
2. **In `isoloop/web`, in the same session:** add, rename or remove the page's entry in `apps/site/content/docs.json`. The PR here says `Site impact: update needed`. The site's build fails while a fetched guide is missing from `docs.json`, or a listed one is missing from the fetch.
3. **The page goes live** when `apps/site/library.lock` is bumped to a published version that has it, and the maintainer tags a `site-v*` release.

There are no redirects before 1.0: a removed page's URL returns the 404 page.

## 5. Check

Run `pnpm build`, then `pnpm docs:check` and `pnpm format:check`. `docs:check` checks the rules `docs/writing.md` marks **(checked)**: the skeleton and lead sentence, the links, the banned phrases and em dashes, the type-checked fences, and the map's coverage. The PR hook runs `pnpm docs:check --guides` (everything but coverage), and CI runs all of it.

- **Fences** compile next to a small example app, `scripts/docs/fence-app/`. A fence may use `kernel`, `contracts` and `workers` without declaring them, and import `./contracts`, `./schemas`, `./alerts` and `./topics` (a `count` topic). Everything else it imports. `virtual:isoloop/*`, `*?isolate` and `import.meta.env` have their types. Add to the fence app only what several guides build on.
- **A guide naming a removed export** fails the API check job, which builds the PR's base: rename or remove the mention.

The steward reviews the rest on the PR: whether each claim matches the code, the voice, and whether a guide the map flagged needed a change.

## Who approves

- **Edits to existing pages inside a feature PR** merge with the PR, on green CI and a steward pass. The maintainer reads them after.
- **The maintainer approves before merging:** a new page, a removed page, a restructure (moving sections between pages, splitting or merging pages), `docs/writing.md`, this skill, and the "build with Isoloop" skill.
- **A docs-only PR** in this repo goes to the maintainer, as `AGENTS.md` says.
