# isoloop/isoloop

The Isoloop library: the `@isoloop/*` packages, their tests and benches, and the docs that change with the code (`docs/guide`, `docs/adr`, `docs/design`, `docs/diagrams`). Setup, scripts, branches and code rules are in [`CONTRIBUTING.md`](CONTRIBUTING.md). How changes get published and checked across both repos: [`isoloop/web` ADR 0004](https://github.com/isoloop/web/blob/main/docs/adr/0004-publishing-and-governance.md).

## Definition of done

A change is done when all six hold:

1. **Tests** cover it, and `pnpm check` plus CI are green.
2. **A changeset** describes it for the package changelogs (`pnpm changeset`), as it is at this commit. It never says what comes later ("in a later task", "nothing uses it yet"): changesets ship together at the next version, so the follow-up may land first and the sentence is then false. An internal-only change (tests, CI, benches, refactors that leave the published `.d.ts` alone) takes the `no-changeset` label instead.
3. **Docs** match it, written with the `docs` skill: TSDoc for every public export it touches, and `docs/guide` when behaviour users rely on changes. The API check fails a PR whose published types changed without docs.
4. **Site impact** closes the PR description: `none`, `update needed`, or `done in web#N`. Site-worthy means a new capability or a behaviour change users see, new or changed measurements, site copy the change makes wrong, or a newly found limitation.
5. **When Site impact is `update needed`,** open the follow-up in `isoloop/web` in the same session, using its `publish` skill, while the context is fresh.
6. **A breaking change to a stable API** ships with a codemod in the same PR: a `breaking:` changeset, and before/after fixtures under `packages/cli/src/migrate/<version>/` ([ADR 0019](docs/adr/0019-versioning-and-releases.md), decision 10).

## Claims and wording

- **Positioning:** Isoloop lets you separate the UI from the work behind it, with the bus as the model the parts share (optional in the browser). Docs show ways to split an app, such as moving state and heavy work into headless isolates, as patterns, not rules: how an app is split is the developer's call. It's a complete toolchain: containment, restart and catch-up, a bus with retention, replay and durable history, placement as a switch, with React, Preact or plain DOM. It costs CPU, memory and start-up time, and the docs say so plainly.
- **Performance is a measurement:** device, build, version, and the numbers. Compare Isoloop with native as measured results, in both directions. CI asserts Isoloop's own budgets and reports native ratios.
- **Docs describe the code as it is.** Check a claim against the implementation before writing it; when they disagree, fix whichever is wrong in the same PR.

## Decisions and review

- **One PR per task** from a plan's task table.
- **ADRs** record decisions; the maintainer reviews each one on its own, and it's committed once the review ends.
- **The maintainer reviews** ADRs, docs-only PRs in this repo, and new public API. Forks merge their own code PRs on green.
- **Releases:** each stage and finish run of `release.yml` needs the maintainer's explicit word for that release, and only the maintainer approves what's staged on npm. The finish run creates the tag; nobody pushes `v*` tags by hand ([`CONTRIBUTING.md`](CONTRIBUTING.md#releases)).

## Delegating work

When a session hands a task to a subagent:

- **A fork of the session** (same model, the whole conversation) for work that needs judgement: ADRs and other decisions, design, public API, generators and checks, changes across several packages, and anything that may contradict an ADR or a plan.
- **A fresh agent on a smaller model** (Sonnet today) for a well-specified task with checks behind it: a guide from a plan's task row, site plumbing, a mechanical fix. It sees none of the conversation, so its brief names the task, the plan row, the files to read (this file, the docs rules, the skill it needs), its worktree, and what it may merge.
- **Either way,** one PR per task, and the rest of this file applies as written.
