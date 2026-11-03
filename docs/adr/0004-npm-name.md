# ADR 0004: Project and package name: Isoloop

- **Status:** Accepted
- **Date:** 2026-11-03
- **Answers:** RFC 0001 open question "Is the name `federa` free on npm?"

## Context

The working name was **Federa**. It appears below only as history; everything else in the repo uses Isoloop. Checked on 2026-11-03:

| Name | Result |
| --- | --- |
| `federa` (unscoped npm) | Free |
| `@federa` npm scope | **Taken** by another maintainer (`@federa/federation` 0.6.8, `@federa/bluesky`, `@federa/integration`) |

So the RFC's `@federa/host`, `@federa/react` and so on couldn't be published, and npm searches would mix us with an unrelated project. Nothing had been published and the repo can be renamed, so we picked a new name instead of a workaround scope.

Two constraints shaped the choice:

- **Not visual-only.** The unit of isolation can be headless, such as a state manager or a set of subscribers ([ADR 0008](0008-isolates-and-surfaces.md)), so names built on "pane" or "window" were dropped.
- **Free everywhere:** the unscoped npm package, the npm scope, and a GitHub user/org.

Every real word we checked was taken on at least one of those (bulkhead, mullion, septa, fenestra, casement, tessera, skein, weft, strand, filament, lattice, canton, keel, palisade, transom). So were the `iso-` names isolit (npm), isorun, isolane and isokit. The coined names free on all three were `isoloop`, `isofold`, `isopane`, `paneloop`, `threadpane` and `panesmith`.

## Decision

- The project is **Isoloop**: an isolated event loop per unit, which is exactly what the runtime provides, visual or headless.
- npm: the **`@isoloop/*`** scope for packages (`@isoloop/protocol`, `@isoloop/host`, `@isoloop/runtime`, `@isoloop/bus`, `@isoloop/react`, `@isoloop/preact`, `@isoloop/devtools`), and the unscoped **`isoloop`** for the CLI.
- GitHub: the **`isoloop`** org, with the repo at `isoloop/isoloop`.
- Prefixes in code: host components `iso-*` (e.g. `<iso-button>`), the surface element `<iso-surface>`, and system topics `isoloop.*` (e.g. `isoloop.route.v1`).

## Consequences

- All docs use the new name. The PoC artifact keeps its original identifiers (`FederatedContainer`, `fed-runtime`); they disappear in the M0 port.
- The lifecycle diagram PNG still says "pane" and "unmount"; redraw it when the diagrams are next updated.

## Claimed names

Checked 2026-11-03:

- [x] npm org `isoloop` (scope `@isoloop/*`).
- [x] GitHub org `isoloop`, repo `isoloop/isoloop`.
- [x] Old `sabbin/federa` repo no longer public.
- [x] Placeholder `isoloop@0.0.0` (unscoped, for the CLI) published to reserve the name.
- [x] Local folder renamed to `isoloop`.
