# Docs that follow the code, and where they don't

*M4c write-up, 2026-11-23*

M4c's promise: **the docs on isoloop.dev, readable by people and by agents, and a pipeline that keeps them matching the code as features are added, changed and removed.** The first half has been live since `site-v0.6.0` (2026-11-21): 15 guides, an API page for each of the 10 user-facing packages and one for the CLI, `llms.txt`, `llms-full.txt` and a Markdown copy of each page. This post is about the second half: what the pipeline checks on every pull request, what it has caught so far, and what it can't catch.

## Who writes the docs

There's no separate docs writer. The agent or person who makes a change writes its docs in the same PR, following the [`docs` skill](../../.claude/skills/docs/SKILL.md) and the rules in [`docs/writing.md`](../writing.md) ([M4c](../plans/m4c-docs.md), decisions 17 and 18). A writer working from the diff afterwards would have to rediscover what the change does, and copy written from diffs drifts.

The site doesn't read `main`. It renders the guides and the API pages at the commit in `apps/site/library.lock`, and the site's CI checks that the package versions at that commit are on npm. So the site never describes an API that `@next` doesn't have.

## What the checks catch

Five layers run on a library PR. The first three are scripts; the last two read the change.

| Check | Runs | Fails on |
| --- | --- | --- |
| `pnpm docs:check` | CI; the guide rules also in the `gh pr create` hook | a missing or long lead, a missing skeleton section, a dead relative link, a banned phrase or an em dash, an ADR or plan named in a guide or in public TSDoc, a `ts` or `tsx` fence that doesn't type-check, an export no guide covers, an export below the TSDoc bar |
| `pnpm docs:api --check` | CI | an API page that differs from a fresh run of the generator |
| The API check | CI | a changed published `.d.ts` without a minor changeset, a docs or TSDoc change and a Site impact other than `none`; a guide naming an export the PR removes |
| Changeset and Site impact | CI | a package change without a changeset (or the `no-changeset` label), a description without one valid `Site impact:` line |
| The steward | CI, an AI review posted on the PR | a false claim, a wrong Site impact, missing docs for a visible change, an approval the maintainer hasn't given |

Some figures from `main` today:

- **The fences:** the guides hold 64 `ts` and `tsx` blocks. Each becomes its own module next to a small example app, and one `tsc` run checks them all. Two are marked `nocheck`.
- **Coverage:** `docs/guide/map.json` names 99 exports in the guides' lists and 27 as reference only. The types reached from them through parameters, returns and fields count as covered. The `pending` list that held the gaps is gone, and a new export can't be added to it.
- **The cost:** `docs:check` takes about 1.3 s after a build.

### What they caught

- **A false limit, and the same claim elsewhere.** The first real test was the devtools rework ([#327](https://github.com/isoloop/isoloop/pull/327)). `docs:check` passed, and the map's notice stayed silent, correctly, since both devtools guides were edited. The steward caught the changeset's claim that the panel keeps all of a session's events; the code keeps 6,000 per session. It missed the same claim in the package README, and two lines of `devtools.md` that still called the Messages tab "the log". The fixes ([#329](https://github.com/isoloop/isoloop/pull/329), [isoloop/web#220](https://github.com/isoloop/web/pull/220)): the steward now searches the guides, READMEs, changesets and TSDoc for a false claim it finds, and a changeset gives a limit only with the guide's exact figure.
- **Changelogs that looked ahead.** Nine changeset entries in `0.1.0-next.3` ([#260](https://github.com/isoloop/isoloop/pull/260)) said what would come later, and a later PR had made each one false before they shipped. The steward found them over three rounds. Changesets now describe the change as it is at its commit ([#261](https://github.com/isoloop/isoloop/pull/261)).
- **History in the reference.** The first generated API pages carried 74 ADR and decision references from the TSDoc ([#342](https://github.com/isoloop/isoloop/pull/342)). The TSDoc pass removed them at the source, and `docs:check` now fails on any in public TSDoc or in `docs/api`.
- **Approvals.** An ADR change, a new guide, `docs/writing.md` or a skill fails the steward's verdict until the maintainer's `maintainer-approved` label is on the PR. A claim of approval in the PR's text doesn't count ([#391](https://github.com/isoloop/isoloop/pull/391) waited on it).
- **The site follow-up.** On [#392](https://github.com/isoloop/isoloop/pull/392), a new limit in the supervision guide, the steward pointed out that `Site impact: update needed` needs a web follow-up opened in the same session, and [isoloop/web#280](https://github.com/isoloop/web/issues/280) was opened.

## What they can't catch

- **What an example does.** A fence type-checks; it doesn't run. The supervision guide's configuration example (5 restarts within 30 s, a 5 s kill threshold) passed every check from [#320](https://github.com/isoloop/isoloop/pull/320) on, yet it could never fail a hung isolate: six crashes at 5 s each, plus its backoff, don't fit in 30 s. On a real kernel in Chromium the isolate crashed 17 times in 150 s and never reached `failed`. It was found by measuring, while reviewing a supervisor change, and fixed in #392; the limit itself is [#390](https://github.com/isoloop/isoloop/issues/390).
- **Behaviour without a type change.** The API check compares published types. A start-up warm-up ([#384](https://github.com/isoloop/isoloop/pull/384)) changed when the supervisor kills a worker and left every `.d.ts` unchanged, so the check passed. Its tests passed, and so did the steward. With `readyTimeoutMs` raised to 20 s, it also kept a hung isolate from ever failing. That was found by simulating the state machine and confirmed on a real kernel; the PR was closed unmerged.
- **A claim on the other repo.** On an `isoloop/web` PR the steward has no library checkout, so it can't check a sentence there against the kernel's code. It says so under Notes ([isoloop/web#279](https://github.com/isoloop/web/pull/279)).
- **Drift where nothing mapped changed.** The map's notice names a guide when a PR touches a path that guide covers and leaves the guide alone. A guide whose truth depends on code it doesn't map gets no notice. The steward's rules include a weekly drift pass that reads every guide against `main`, but no scheduled run of it exists yet (M4c task 20).
- **The steward's misses.** It's an AI review, and it can be wrong both ways: on #327 it missed two of the three places. The maintainer reviews docs-only PRs in the library before they merge, and can overrule the steward with the `steward-override` label.

## What M4c didn't do

- **The skill link in `llms.txt`** (task 26) waits for the site's next pin bump ([isoloop/web#253](https://github.com/isoloop/web/issues/253)).
- **The weekly docs drift pass** (task 20) is written into the steward's rules, but nothing runs it on a schedule.
- **Examples that run.** Fences that execute, or a test per guide example, aren't planned. The supervision case says where they would have helped.

## Next

0.1.0 ([M4d](../plans/m4d-release.md)). The docs move to its version with the site's pin bump.
