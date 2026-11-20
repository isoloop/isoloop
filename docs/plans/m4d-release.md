# M4d: The 0.1 release (epic of [M4](m4-devtools-release.md), outline)

**Goal:** `0.1.0` on npm with a launch post.

**Done when** (RFC 0001): `0.1.0` is published with provenance, and the launch post is out.

**Status (2026-11-19):** not started; it comes after M4c. Done ahead: the Changesets pipeline and ADR 0019 (below), and every package, the new `@isoloop/devtools`, `@isoloop/webmcp` and the `isoloop` CLI included, on npm under `next` at `0.1.0-next.5`, published by `prerelease.yml` through trusted publishing (with provenance).

Gets a full task list when it's next to start. Its first task, the API freeze, comes once [M4a](m4a-agents.md) and [M4b](m4b-devtools.md)'s public API is merged; the rest waits for [M4c](m4c-docs.md) and M4a's skill.

## Main work items

1. **API review and freeze:** freeze the public API names. Mark the experimental parts `@experimental`: groups, request/response, `kernel.request`, tools on contracts, `kernel.inspect()`, `@isoloop/webmcp`, `@isoloop/balancer`. *Added 2026-11-20:* it starts on the maintainer's word, and it includes the TSDoc pass and `docs:check` item 7 at [M4c](m4c-docs.md) decision 30's bar (M4c task 21), so the API reference is complete from its first build.
2. **Release pipeline:**
   - Changesets, with every `@isoloop/*` package in one `fixed` group ([ADR 0011](../adr/0011-dom-package.md), decision 8). *Done 2026-11-17 ([`isoloop/web` ADR 0004](https://github.com/isoloop/web/blob/main/docs/adr/0004-publishing-and-governance.md), #221): in pre mode `next`, so prereleases are `0.1.0-next.N`; leaving pre mode (`changeset pre exit`) is part of cutting 0.1.0.* *Done by 2026-11-19:* the `@isoloop/*` scope ([ADR 0004](../adr/0004-npm-name.md)) and provenance on the `next` prereleases. The semver policy for the protocol version vs package versions is decided in [ADR 0019](../adr/0019-versioning-and-releases.md) (2026-11-17). Still to build: the release workflow, which matches only `v<major>.<minor>.<patch>` tags, makes a GitHub Release from the changelogs, and the 0.1.0 cut is `changeset pre exit`, the version PR, then the tag.
   - **Decided 2026-11-07:** one repo tag per release, `v<version>`, which every package shares (the fixed group). Pushing it runs the full CI, then publishes, then deploys Pages. Changesets' per-package git tags are turned off, and the unscoped `isoloop` CLI joins the group.
   - The release workflow needs an `npm trust github` entry on every package (as `prerelease.yml` has). The new packages (`@isoloop/devtools`, `@isoloop/webmcp`, the CLI) already have their placeholder publish and a `prerelease.yml` trust entry (2026-11-19).
   - Decide whether releases are stage-only (approved by hand on npm).
3. **Trim the interim changesets.** *Done 2026-11-17 (#222):* one current-state changeset per package replaced the interim notes, which are archived unchanged in [`docs/history/interim-changesets.md`](../history/interim-changesets.md).
4. **Launch post** with the M3 dashboard recording and the bench numbers. It includes an "Isoloop for agents" section ([M4a](m4a-agents.md), decision 22) in neutral language: what agents can do, what it costs, and that WebMCP is behind a flag in Chromium and in Firefox.
