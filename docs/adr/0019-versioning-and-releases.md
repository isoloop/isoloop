# ADR 0019: Versioning and releases

- **Status:** Accepted (2026-11-17), after grilling (Q1–Q12, yes to all). Amended on 2026-11-22 for releases the maintainer approves on npm (*How a version is released* in decision 6, with the version table and decisions 5 and 7 to match); grilled the same day (Q1–Q13, yes to all). Amended on 2026-11-23 for what is supported (decision 5's branch rules and the new decision 9); grilled that day (Q1–Q13, yes to all). Its code follows each amendment's acceptance; the branch release path is built after 0.1.
- **Date:** 2026-11-17
- **Builds on:** [ADR 0011](0011-dom-package.md) decision 8 (one Changesets `fixed` group), [ADR 0012](0012-isolates-built-apart.md) (the isolate seam and its `[FLOOR, VERSION]` check), and the release steps of #221 (Changesets pre mode `next`, the version PR, the Prerelease workflow).
- **Plan:** [M4d](../plans/m4d-release.md), item 2's "semver policy for the protocol version vs package versions".

## Context

Until 2026-11-17 the packages were published as `0.0.0-next.<sha>`. That had two faults:

- **It didn't sort by time.** Semver compares an alphanumeric prerelease tag as text, so `0.0.0-next.800569e` sorts below the day before's `0.0.0-next.g3322248`. npm's version ordering and `^` ranges would pick the older build.
- **It was a prerelease of a `0.0.0` that would never ship,** so no range led from it to a real release.

#221 put the packages in Changesets' pre mode `next`, and #227 versioned them to `0.1.0-next.0`, published that day and tagged `v0.1.0-next.0`. Several questions were still open:
- how 0.x numbers are used once 0.1.0 is out;
- what may break in a patch, given that ADR 0012 checks only `major.minor`;
- how patches ship while `main` previews the next minor;
- what `@experimental` means across 1.0;
- how to stop an accidental 1.0;
- what to do with the old versions on npm.

This ADR records the whole scheme, so each release follows it rather than deciding again.

## Decision

### 1. Three kinds of version

| What | Scheme | Moved by |
| --- | --- | --- |
| **The library:** every `@isoloop/*` package, and the unscoped `isoloop` CLI once it exists | semver, one shared version for all of them (the Changesets `fixed` group) | a version PR, then a stage run, the maintainer's approval on npm and a `finish` run (decision 6, amended 2026-11-22) |
| **The isolate seam** (ADR 0012) | `major.minor` only: an isolate is stamped `requires: '0.1'`, and the host runs `[FLOOR, VERSION]` | `VERSION` follows the package version; `FLOOR` moves only through an ADR (ADR 0012, decision 5) |
| **Apps in `isoloop/web`** (`plant-v*`, `markets-v*`, `processor-v*`, `site-v*`) | each app's own version, independent of the library's | their tags, pushed by the maintainer |

The host ↔ worker protocol (`PROTOCOL { v, min }`) is none of these. Both ends ship in one build, so it may change in any release (ADR 0012, decision 2).

### 2. The road to 1.0

```
0.1.0-next.0 → .1 → .2 …   npm `next`, previews of 0.1.0
0.1.0                      npm `latest`
  ├─ 0.1.1, 0.1.2 …           patches (decision 5)
  └─ 0.2.0-next.N             previews of the next minor
0.2.0, 0.3.0 … 0.9.x
1.0.0-next.N               only with the `release-1.0` label (decision 7)
1.0.0                      plain semver from here (ADR 0012, decision 5)
```

- **Previews** are Changesets pre mode `next`: `pnpm changeset pre enter next` after a release, and `pre exit` before the next one. While in pre mode, every version PR moves only the counter (`-next.N`), whatever the changesets' bump types.
- **dist-tags:** `next` points to the latest preview, and `latest` to the latest release. `latest` stays on the `0.0.0` placeholder until 0.1.0.

### 3. What a minor and a patch may contain on 0.x

- **A minor** may contain anything: breaking changes, and anything added to the isolate seam (`IsolateContext`, `defineIsolate`, the DOM subset, the adapter hooks).
- **A patch** may contain fixes, plus compatible additions outside the seam: the host API, `KernelConfig`, new packages.
- **Why the seam needs a minor:** ADR 0012's check compares only `major.minor`. An isolate built on a 0.1.3 that used a member added in that patch would pass the check on a 0.1.0 host, then fail with a `TypeError`.
- **The seam still only grows** between floor changes, on 0.x too (ADR 0012, decision 2). "Anything breaking" in a minor means the host API and `KernelConfig`, not the seam.
- From 1.0, plain semver: a major breaks, a minor adds (the seam included, since the check then compares majors), and a patch fixes.

### 4. `@experimental`

- **An `@experimental` API may change or be removed in any minor,** before 1.0 and after it. Today that covers groups, request/response, `kernel.request`, tools on contracts, `kernel.inspect()`, `@isoloop/webmcp` and `@isoloop/balancer`.
- **It must be visible.** Each one is marked `@experimental` in its TSDoc and listed on one docs page, and a change to it is called out in the changelog.
- **Leaving `@experimental`** is a decision recorded in that API's ADR. After that it follows decision 3.

### 5. Patches during a preview cycle

Pre mode applies to the whole repo, so while `main` previews `0.2.0-next.N`, it can't release a `0.1.1`.

- **When a fix for the current release is needed,** cut `release/0.1` from the latest `v0.1.x` tag, backport the fix, and release the next patch from that branch. Its version PR and its release go through the same checks.
- **The fix goes to `main` first (amended 2026-11-23).** The backport is its own PR into the branch, a cherry-pick or a fresh fix for the older code, with its own regression test. CI and the steward run on it like on any PR.
- **Only a small backport is made (amended 2026-11-23).** If the fix doesn't apply as a small, reviewable change, it ships in the next minor, which is brought forward if it's urgent.
- **Such a branch is admitted when it's cut (amended 2026-11-22).** Until then only `main` can stage (decision 6). Cutting one includes adding it to the `npm` environment by its exact name and giving it a ruleset. A pattern such as `release/*` won't do: version-PR branches have names that match it, and no ruleset protects them.
- **Today the release workflow runs on `main` only (amended 2026-11-23).** Its stage and finish jobs and `scripts/release/rules.ts` require that ref. A task after 0.1 makes them accept `release/<major>.<minor>`, with tests and a dry run of a throwaway patch, before the first patch is needed.
- **The branch lives until the next minor ships (amended 2026-11-23).** One such branch exists at a time. It's deleted when `0.2.0` is `latest`, and its tags stay. It is never merged back into `main`.
- **A patch to an older line isn't made (amended 2026-11-22, restated 2026-11-23).** Once `0.2.0` is `latest`, a `0.1.x` must not take that dist-tag back, so the release workflow refuses it. Decision 9 says why.
- **The branch is created only when needed.** Most cycles won't need one.

### 6. Tags and GitHub Releases

- **Every published version has a tag `v<version>`** on the commit it was built from.
- **The tag follows the publish (amended 2026-11-22).** The `finish` run below makes it, for previews and releases alike. A tag is a record: pushing one starts no release, CI or Pages deploy. Before the amendment the Prerelease workflow tagged previews after publishing, and a release tag pushed by the maintainer was to start the release.
- **GitHub Releases** exist for 0.1.0 and later. Prereleases get none: they're for this project and `isoloop/web`, and their tag and changelogs are enough. `finish` makes the Release. Its text is `.github/releases/<version>.md` where that file exists, as for 0.1.0, whose changelogs would repeat every preview's entries. Otherwise it's generated from the changelog sections (amended 2026-11-22).

**How a version is released (amended 2026-11-22).** One workflow, `.github/workflows/release.yml`, releases previews and releases. It's started by hand, and it's a dry run unless told otherwise. The npm dist-tag comes from the version: `next` for `-next.N`, `latest` for a plain `x.y.z`.

1. **Stage.** A run on `main` (or on a release branch admitted under decision 5), started on the maintainer's word for that version, runs the full CI on its commit.
   - A build job, without `id-token`, packs the tarballs and prints their shasums.
   - A stage job installs no dependencies and runs `npm stage publish` on those tarballs. It runs in the GitHub environment `npm`, which admits only `main` and such branches.
   - The run's summary is the approval checklist: the packages in the order below, with version, shasum and link.
2. **Approve.** The maintainer approves each package on npmjs.com with 2FA.
   - None is approved until all 13 are staged, scanned by npm and match the run.
   - The order follows the dependencies: protocol, codec, dom and vite; then bus and runtime; then host, react and preact; then balancer, devtools, webmcp and the `isoloop` CLI.
3. **Finish.** A second run checks every package on npm: the version, the dist-tag, the provenance, and the workflow, ref and commit that provenance attests. Only then does it make the annotated tag on the staged commit and, for a release, the GitHub Release.

When it goes wrong:

- **Only some packages staged:** none is approved. The maintainer rejects those, and only the stage job runs again, on the same tarballs. An "already staged" error is a failure, never skipped, since the job can't see whose tarball is staged.
- **A problem before the first approval:** all are rejected.
- **A problem after it:** the set is finished, and the fix ships in the next version.
- **Workflow files don't change on `main` between a stage and its `finish`:** GitHub can refuse a job's tag on a commit whose workflow files differ.

Pages isn't part of a release. It serves a redirect to isoloop.dev, and `pages.yml` is run by hand when that changes.

**What the gate is.** Each package trusts only `release.yml` in the environment `npm`, allowed to stage and neither to publish directly nor to change dist-tags. Tokens are disallowed. There is no fallback to a token or to a publish from someone's machine: if the gate doesn't work, the release waits.

- **It stops** a publish without the maintainer's 2FA. That holds against a mistake, an agent or a job holding GitHub credentials, and a dependency that runs during the build.
- **It doesn't stop** a bad tarball from being staged, or approved. Anyone who can change `main` or the repository's settings can change what gets staged, and what a run's summary says about it. The approval is only as good as what the maintainer checks before giving it, and `finish` checks after the publish.
- **It doesn't protect** the maintainer's npm account or a session signed in to it. So approvals and trust changes are made in the browser, and the machines agents work on stay signed out of npm.
- **It doesn't protect the tags.** The `tags` ruleset stops a tag moving or being deleted, not being created, so npm's provenance, not the tag, proves what was published.

**Moving to it.** The gate holds only once it's the only way in, because npm accepts a publish that matches any one of a package's trust entries.

1. The stage-only entries are added next to `prerelease.yml`'s.
2. `0.1.0-next.12` rehearses the whole path.
3. The old entries are revoked and `prerelease.yml` is deleted, all before 0.1.0. Until then nobody runs it.

The rehearsal is also where these are found out, since npm's docs don't say or we haven't seen them:

- whether provenance survives an approval (`finish` fails if it doesn't);
- how long the scan takes;
- whether a staged and approved version counts as the publish a new trust entry needs within 2 days;
- whether a version can be staged again after a reject (if not, a failed stage means the next version);
- whether the approval page shows the shasum to compare.

### 7. Guards in CI

- **No accidental 1.0.** The changeset check fails on any changeset that asks for a `major` bump while the version is below 1.0.0, unless the PR has the `release-1.0` label. The maintainer adds that label when 1.0's previews are to start. On 0.x a breaking change is a minor (decision 3).
- **Version PRs pass on their own.** A PR whose diff only consumes changesets (the changeset files, `.changeset/pre/`, the `version` fields and the `CHANGELOG.md`s) passes the changeset check without the `no-changeset` label. The check reads the diff, not the branch name.
- **The release workflow refuses mixed versions** (#221's rule for previews, extended to releases on 2026-11-22). It stages only if every package shares one version: a `-next.N` in pre mode, or a plain `x.y.z` out of it.

### 8. The versions before this ADR

Once `isoloop/web` has moved to `0.1.0-next.0`, every `0.0.0*` version of each `@isoloop/*` package is deprecated on npm: the `0.0.0-next.<sha>` builds, `0.0.0-stage`, and the `0.0.0` placeholder that `latest` points to. The message is "Pre-release builds; install @isoloop/<pkg>@next until 0.1.0". The maintainer runs `npm deprecate`, since it needs their npm login. The versions aren't unpublished: that would break old lockfiles, and npm limits it anyway.

### 9. What is supported (amended 2026-11-23)

Grilled 2026-11-23, Q1–Q13, yes to all.

- **Only the version on npm `latest` is supported.** When `0.2.0` takes `latest`, every `0.1.x` is unsupported. `next` previews are never supported. We encourage everyone to move to `latest`.
- **No backports to an older line.** Decision 5's branch patches the current `latest` only.
- **A security bug in an unsupported version** is fixed in `latest` and published as a GitHub security advisory that names the affected range and the fixed version.
- **`npm deprecate` is for a known bug.** We deprecate a range with a known security or data-loss bug, with the message "Upgrade to latest". We don't deprecate every superseded minor by default.
- **Breaking changes are listed.** Each minor's changeset names its breaking changes and the migration. It's a convention the steward checks, with no extra tooling.
- **Where it's said.** One sentence, "Only the latest release is supported": here, in `SECURITY.md`, in the README and in the docs.
- **0.x only.** At 1.0 the policy is decided again, since a previous-minor window may be expected then.
- **Apps and the site (web repo) are outside it.** They deploy from `main` on a fresh tag, with no branches and no backports.

## Consequences

- **Every published version sorts in the order it was made.** `^0.1.0-next.0` ranges and npm's `next` behave as people expect.
- **One version number answers "which build is this":** across packages, through the tag, and in each package's `CHANGELOG.md`.
- **Every version costs the maintainer 13 approvals and a wait for npm's scan,** previews included (amended 2026-11-22). Previews will be fewer or slower, and a release can't go out while the maintainer is away.
- **A release can be partly public for a while** (amended 2026-11-22). Each approval moves that package's dist-tag at once. The order means a published package never depends on one that isn't published yet.
- **A version can be on npm without its tag** until `finish` runs (amended 2026-11-22).
- **The isolate seam check stays sound on 0.x** at the cost of one rule: a seam addition waits for a minor.
- **`@experimental` stays a real promise** without freezing the balancer or WebMCP at 1.0. Users of those APIs must read the changelog at each minor.
- **A `release/0.x` branch, when there is one, is a second place to apply fixes.** Backports are by hand, and only small ones are made (decision 5).
- **Users of an old version get no patch** (amended 2026-11-23). They upgrade to `latest`, and on 0.x that may mean taking a breaking minor.
- **An urgent fix can wait for an unfinished minor** (amended 2026-11-23), when the fix is too large to backport.
- **More steps for the maintainer** around the first 0.1.0: `pre exit`, the version PR, the stage, the approvals and `finish`, then `pre enter next` for the next cycle (amended 2026-11-22).
- **Anyone who installs `@isoloop/<pkg>` without `@next` before 0.1.0** gets the placeholder, now with a deprecation message saying what to install instead.

## Alternatives considered

- **A standing `release/0.x` branch for every minor** (amendment of 2026-11-23). Rejected: it costs a ruleset, CI, a Changesets state and hand cherry-picks every week, for a line we've told people to leave.
- **Support the previous minor for a window** (amendment of 2026-11-23). Rejected for 0.x, where a minor may break anything; revisited at 1.0.
- **Keep `0.0.0-next.<sha>`,** perhaps with a timestamp. It needs no version PR, but it never leads to a release, and only a timestamp would fix the order, which Changesets doesn't produce.
- **Publish every merge to `main` as a snapshot** (`0.1.0-next-<date>`). Fewer steps, but changelogs would have no sections, and the web repo would chase builds nobody chose.
- **Treat every 0.x minor as a major for the seam,** so patches may add to it. Rejected in ADR 0012: a 0.4 host would refuse 0.3 isolates that would run fine.
- **Patches only fix, even outside the seam.** Simpler to state, but host-side additions would wait a whole cycle for no reason the check needs.
- **No previews after 0.1.0:** every release goes straight to `latest`. Simpler, but the web repo couldn't try a minor before users get it.
- **`@experimental` must graduate or go by 1.0.** It would tie 1.0 to a browser shipping WebMCP and to the balancer's design settling.
- **Block majors outright,** with 1.0 done by hand outside the checks. A label is the same safety with the same steps as any other release.
- **A separate tag prefix for prereleases** (`next-v0.1.0.N`). The semver suffix already says what a tag is.
- **Unpublishing the `0.0.0*` versions.** See decision 8.
- **Direct publishing behind a GitHub environment, with the build split off** (amendment of 2026-11-22). No approvals to give. Rejected: whoever holds the maintainer's GitHub credentials, as agents do, can change the environment and publish.
- **Stage-only for releases, direct publishing for previews** (amendment of 2026-11-22). Previews would stay quick. Rejected: any one trust entry authorises a publish, so the direct one would be the way around the gate.
- **Two stage-only workflows** (amendment of 2026-11-22). Rejected: two paths to audit, and previews wouldn't rehearse the path a release takes.
- **The tag first, starting the release** (decision 6 until 2026-11-22). Rejected: the tags ruleset forbids moving or deleting a tag, so a rejected stage would leave the version's tag on the wrong commit for good.
- **Approving with the npm CLI** (amendment of 2026-11-22). Faster for 13 packages. Rejected: agents share that shell's npm session, and npm can skip 2FA for 5 minutes after a prompt.
- **Skipping packages that are already staged** on a re-run (amendment of 2026-11-22). Rejected: the job can't list staged versions, so it can't tell whether one is its own tarball.
- **Deploying Pages with each release** (decided 2026-11-07, dropped 2026-11-22). The redirect doesn't change with a release, and the `github-pages` environment refuses deploys from tags.
- **Generated notes for 0.1.0's GitHub Release** (amendment of 2026-11-22). Rejected: they'd repeat the preview cycle's changesets as the first release anyone reads.
