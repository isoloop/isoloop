# ADR 0019: Versioning and releases

- **Status:** Accepted (2026-11-17), after grilling (Q1–Q12, yes to all)
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
| **The library:** every `@isoloop/*` package, and the unscoped `isoloop` CLI once it exists | semver, one shared version for all of them (the Changesets `fixed` group) | a version PR, then the Prerelease workflow or a release tag |
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

- **When a fix for the current release is needed,** cut `release/0.1` from the `v0.1.0` tag, cherry-pick the fix, and release `0.1.1` from that branch. Its version PR and its release tag go through the same checks.
- **The branch is created only when needed.** Most cycles won't need one.

### 6. Tags and GitHub Releases

- **Every published version has a tag `v<version>`** on the commit it was built from.
  - The Prerelease workflow pushes the prerelease tag (`v0.1.0-next.N`) after publishing. If the tag already exists on another commit, it fails.
  - A release tag (`v0.1.0`) is pushed by the maintainer, and pushing it runs the release (M4d).
- **Only tags without a suffix release.** M4d's release workflow matches `v<major>.<minor>.<patch>` and nothing else; a prerelease tag is a record only.
- **GitHub Releases** exist for 0.1.0 and later, made by M4d's release workflow from the changelog sections. Prereleases get none: they're for this project and `isoloop/web`, and their tag and changelogs are enough.

### 7. Guards in CI

- **No accidental 1.0.** The changeset check fails on any changeset that asks for a `major` bump while the version is below 1.0.0, unless the PR has the `release-1.0` label. The maintainer adds that label when 1.0's previews are to start. On 0.x a breaking change is a minor (decision 3).
- **Version PRs pass on their own.** A PR whose diff only consumes changesets (the changeset files, `.changeset/pre/`, the `version` fields and the `CHANGELOG.md`s) passes the changeset check without the `no-changeset` label. The check reads the diff, not the branch name.
- **The Prerelease workflow refuses mixed versions.** It publishes only if every package shares one `-next.N` (#221, unchanged).

### 8. The versions before this ADR

Once `isoloop/web` has moved to `0.1.0-next.0`, every `0.0.0*` version of each `@isoloop/*` package is deprecated on npm: the `0.0.0-next.<sha>` builds, `0.0.0-stage`, and the `0.0.0` placeholder that `latest` points to. The message is "Pre-release builds; install @isoloop/<pkg>@next until 0.1.0". The maintainer runs `npm deprecate`, since it needs their npm login. The versions aren't unpublished: that would break old lockfiles, and npm limits it anyway.

## Consequences

- **Every published version sorts in the order it was made.** `^0.1.0-next.0` ranges and npm's `next` behave as people expect.
- **One version number answers "which build is this":** across packages, through the tag, and in each package's `CHANGELOG.md`.
- **The isolate seam check stays sound on 0.x** at the cost of one rule: a seam addition waits for a minor.
- **`@experimental` stays a real promise** without freezing the balancer or WebMCP at 1.0. Users of those APIs must read the changelog at each minor.
- **A `release/0.x` branch, when there is one, is a second place to apply fixes.** Cherry-picks are by hand.
- **One step more for the maintainer** around the first 0.1.0: `pre exit`, the version PR, the tag, then `pre enter next` for the next cycle.
- **Anyone who installs `@isoloop/<pkg>` without `@next` before 0.1.0** gets the placeholder, now with a deprecation message saying what to install instead.

## Alternatives considered

- **Keep `0.0.0-next.<sha>`,** perhaps with a timestamp. It needs no version PR, but it never leads to a release, and only a timestamp would fix the order, which Changesets doesn't produce.
- **Publish every merge to `main` as a snapshot** (`0.1.0-next-<date>`). Fewer steps, but changelogs would have no sections, and the web repo would chase builds nobody chose.
- **Treat every 0.x minor as a major for the seam,** so patches may add to it. Rejected in ADR 0012: a 0.4 host would refuse 0.3 isolates that would run fine.
- **Patches only fix, even outside the seam.** Simpler to state, but host-side additions would wait a whole cycle for no reason the check needs.
- **No previews after 0.1.0:** every release goes straight to `latest`. Simpler, but the web repo couldn't try a minor before users get it.
- **`@experimental` must graduate or go by 1.0.** It would tie 1.0 to a browser shipping WebMCP and to the balancer's design settling.
- **Block majors outright,** with 1.0 done by hand outside the checks. A label is the same safety with the same steps as any other release.
- **A separate tag prefix for prereleases** (`next-v0.1.0.N`). The semver suffix already says what a tag is.
- **Unpublishing the `0.0.0*` versions.** See decision 8.
