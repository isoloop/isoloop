# M4: Devtools and 0.1 release (outline)

**Goal:** a devtools panel showing each isolate's loop health and a live bus log, running as an isolate itself; a docs site; the first npm release.

**Done when** (RFC 0001): `0.1.0` is published with a launch post.

Gets a full task list when it's next to start, after [M3e](m3e-live-widget-creator.md), [M3h](m3h-auto-placement.md) and [M3g](README.md) land ([M3](m3-adapters-dashboard.md) and [M2b](m2b-durable-log.md) are done). The `0.0.0-next` prerelease workflow from [M3b](m3b-dashboard.md) task 1 is replaced by the Changesets pipeline here.

## Main work items

1. **Devtools panel** (`packages/devtools`), as decided in a grilling on 2026-11-16 (see [Devtools decisions](#devtools-decisions-2026-11-16)): a panel in the page, drawn by a visual isolate in its own worker, reading one inspection feed from the kernel. Panels: isolates (state, lag, heap, restarts, patch queue), bus (topics, rates, consumer lag and credit, rejected publishes), and a live record log sampled from the bus worker. Replaying a topic into a scratch view is droppable.
2. **Docs site,** built in `isoloop/web` and served at `isoloop.dev` (*amended 2026-11-14:* no longer `docs/site` in this repo; the guides and TSDoc stay here and `web` fetches them at the release tag; the engine is chosen in an ADR there, behind an interface it owns, per `isoloop/web` ADRs 0002 and 0003): getting started, hosting (CSP/CORS), isolate authoring per adapter, the bus guide (semantics, idempotent handlers), **"Build a dev tool as an isolate"** (with `@isoloop/devtools` as the worked example: tools that read only the app's own topics need no grant, tools that read the kernel's feed need `inspect`), and **"What Isoloop can't hide"** (sync layout, `window`/`document` globals, drag and drop) up front, as the RFC asks. API reference generated from TSDoc.
3. **CLI** (unscoped `isoloop` package): `isoloop contracts export` → JSON Schema draft 2020-12 through the vendored Standard JSON Schema interface (input and output when they differ, plus `reply`; `unchecked` topics flagged; schemas without the interface reported as not exportable) ([ADR 0003](../adr/0003-schema-format-standard-schema.md)); maybe `isoloop new isolate`.
4. **Release pipeline:** Changesets, with every `@isoloop/*` package in one `fixed` group ([ADR 0011](../adr/0011-dom-package.md), decision 8), npm provenance, `@isoloop/*` scope claimed ([ADR 0004](../adr/0004-npm-name.md)), semver policy for the protocol version vs package versions. **Decided 2026-11-07:** one repo tag per release, `v<version>`, which every package shares (fixed group); pushing it runs the full CI, then publishes, then deploys Pages. Changesets' per-package git tags are turned off, and the unscoped `isoloop` CLI joins the group. The release workflow needs an `npm trust github` entry on every package (as `prerelease.yml` has), and new packages (`@isoloop/devtools`, the CLI) a placeholder publish first. Decide whether releases are stage-only (approved by hand on npm).
5. **Trim the interim changesets** before the first release. `.changeset/` holds one entry per M1/M2 task, and several describe states later work removed (for example "`navigate` fails until M2" and `ctx.legacyBus`). Merge them into a short set that describes 0.1 as shipped, per package, so the generated `CHANGELOG.md` reads as a first release, not a build log. Entries written during M2b and M3 get the same pass.
6. **API review:** freeze public API names; mark experimental parts (groups, request/response) with `@experimental`.
7. **Launch post** with the M3 dashboard recording and bench numbers.
8. **Dev MCP** (`isoloop mcp`, in the CLI), last and droppable if 0.1 slips. A local MCP server that an agent connects to; the page connects to it over a localhost WebSocket only when a kernel dev option is on, never in production builds. It reads the same inspection feed as the panel (isolates, health, topics, records), and publishes or restarts isolates only when started with `--allow-write`. The [Isoloop Builder](builder.md)'s Claude Desktop route gets its own bridge on the same transport code later; this one stays dev-only.

## Devtools decisions (2026-11-16)

1. **A panel in the page, not a browser extension.** It works on every browser and on phones, needs no install and is one package to release. A browser extension is in [would-like](../would-like.md); it would be one more client of the same feed.
2. **One inspection feed, `kernel.inspect()`, `@experimental` in 0.1.** Subscribing gives a snapshot, then events: isolate state and lag, supervisor events, compositor stats, bus metrics, and sampled records on request. It costs nothing until something subscribes. The panel, the dev MCP and any later extension all read it.
3. **`@isoloop/devtools` is imported and mounted by the app,** and is allowed in production builds; the app author's import is the opt-in. After 0.1, isoloop.dev's live examples get a devtools toggle (an `isoloop/web` follow-up).
4. **The panel is a visual isolate in its own worker,** never pooled, written in Preact. A devtools crash or hang never touches the app, and the panel restarts like any isolate.
5. **It gets the feed through a dedicated port, granted by a new public `inspect` grant** (`@experimental`), not through bus topics: it has to keep working while the bus restarts, and its traffic mustn't count in the bus figures it shows.
6. **It lists itself in its own figures,** marked as devtools, with nothing filtered out.
7. **Controls:** kill, block and restart an isolate. No publishing from the panel; that's the dev MCP's `--allow-write`.
8. **UI:** a floating button (FAB) when closed, as React Query's devtools have, drawn by the devtools isolate itself, so it disappears briefly while the devtools restart. `position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'`, bottom-right by default. While closed the FAB shows a dot: amber while an isolate is restarting or lagging, red when one has given up (`maxRestarts`). A click or a keyboard shortcut opens a docked, resizable panel from that corner; its size, dock and open state are kept in `localStorage`.
9. **An ADR at the start of M4** records the feed and the `inspect` grant as public API.

## Open risks

- Scope creep in devtools; ship the two panels and the log first. Topic replay and the dev MCP are droppable.
- Docs time is easy to underestimate; start the "limits" page during M3.
