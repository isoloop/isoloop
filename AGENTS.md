# isoloop/isoloop

The Isoloop library: the `@isoloop/*` packages, their tests and benches, and the docs that change with the code (`docs/guide`, `docs/adr`, `docs/design`, `docs/diagrams`). Setup, scripts, branches and code rules are in [`CONTRIBUTING.md`](CONTRIBUTING.md). How changes get published and checked across both repos: [`isoloop/web` ADR 0004](https://github.com/isoloop/web/blob/main/docs/adr/0004-publishing-and-governance.md).

## Definition of done

A change is done when all five hold:

1. **Tests** cover it, and `pnpm check` plus CI are green.
2. **A changeset** describes it for the package changelogs (`pnpm changeset`), as it is at this commit. It never says what comes later ("in a later task", "nothing uses it yet"): changesets ship together at the next version, so the follow-up may land first and the sentence is then false. An internal-only change (tests, CI, benches, refactors that leave the published `.d.ts` alone) takes the `no-changeset` label instead.
3. **Docs** match it: TSDoc for every public export it touches, and `docs/guide` when behaviour users rely on changes. The API check fails a PR whose published types changed without docs.
4. **Site impact** closes the PR description: `none`, `update needed`, or `done in web#N`. Site-worthy means a new capability or a behaviour change users see, new or changed measurements, site copy the change makes wrong, or a newly found limitation.
5. **When Site impact is `update needed`,** open the follow-up in `isoloop/web` in the same session, using its `publish` skill, while the context is fresh.

## Claims and wording

- **Positioning:** Isoloop is a complete toolchain: containment, restart and catch-up, a bus with retention, replay and durable history, placement as a switch, with React, Preact or plain DOM. It costs CPU, memory and start-up time, and the docs say so plainly.
- **Performance is a measurement:** device, build, version, and the numbers. Compare Isoloop with native as measured results, in both directions. CI asserts Isoloop's own budgets and reports native ratios.
- **Docs describe the code as it is.** Check a claim against the implementation before writing it; when they disagree, fix whichever is wrong in the same PR.

## Decisions and review

- **ADRs** record decisions; the maintainer reviews each one on its own, and it's committed once the review ends.
- **The maintainer reviews** ADRs, docs-only PRs in this repo, and new public API. Forks merge their own code PRs on green.
- **Tags and releases** are pushed by the maintainer, or on the maintainer's explicit word for that release.
