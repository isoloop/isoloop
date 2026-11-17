# M4b: Devtools (epic of [M4](m4-devtools-release.md), outline)

**Goal:** a devtools panel showing each isolate's loop health and a live bus log, running as an isolate itself, fed by one inspection feed that the [M4a](m4a-agents.md) dev MCP reads too.

**Done when:** the panel shows isolates, the bus and a live log on plant and markets, keeps working while the bus restarts, and lists itself in its own figures. `kernel.inspect()` and the `inspect` grant are accepted in their own ADR.

Gets a full task list when it's next to start. Its feed comes first: M4a's dev MCP reads wait for it.

## Main work items

1. **The inspection feed and its ADR** (the next free number when it's written; [ADR 0018](m4a-agents.md) is M4a's). `kernel.inspect()` and the `inspect` grant as public, `@experimental` API.
2. **The devtools panel** (`packages/devtools`), as decided below: a panel in the page, drawn by a visual isolate in its own worker. Its views:
   - isolates: state, lag, heap, restarts, patch queue, `busyMs`, the balancer's placements;
   - bus: topics, rates, consumer lag and credit, rejected publishes;
   - a live record log sampled from the bus worker.

   Replaying a topic into a scratch view is droppable.

## Devtools decisions (2026-11-16)

1. **A panel in the page, not a browser extension.** It works on every browser and on phones, needs no install and is one package to release. A browser extension is in [would-like](../would-like.md); it would be one more client of the same feed.
2. **One inspection feed, `kernel.inspect()`, `@experimental` in 0.1.** Subscribing gives a snapshot, then events: isolate state and lag, supervisor events, compositor stats, bus metrics, and sampled records on request. It costs nothing until something subscribes. The panel, the dev MCP and any later extension all read it.
3. **`@isoloop/devtools` is imported and mounted by the app,** and is allowed in production builds; the app author's import is the opt-in. After 0.1, isoloop.dev's live examples get a devtools toggle (an `isoloop/web` follow-up).
4. **The panel is a visual isolate in its own worker,** never pooled, written in Preact. A devtools crash or hang never touches the app, and the panel restarts like any isolate.
5. **It gets the feed through a dedicated port, granted by a new public `inspect` grant** (`@experimental`), not through bus topics. It has to keep working while the bus restarts, and its traffic mustn't count in the bus figures it shows.
6. **It lists itself in its own figures,** marked as devtools, with nothing filtered out.
7. **Controls:** kill, block and restart an isolate. No publishing from the panel; that's the dev MCP's `--allow-write` ([M4a](m4a-agents.md), decision 12).
8. **UI:**
   - When closed, a floating button (FAB) like React Query's devtools, drawn by the devtools isolate itself, so it disappears briefly while the devtools restart.
   - `position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'`, bottom-right by default.
   - The closed FAB shows a dot: amber while an isolate is restarting or lagging, red when one has given up (`maxRestarts`).
   - A click or a keyboard shortcut opens a docked, resizable panel from that corner. Its size, dock and open state are kept in `localStorage`.
9. **An ADR at the start of M4b** records the feed and the `inspect` grant as public API.

## Open risks

- Scope creep; ship the isolates and bus views and the log first. Topic replay is droppable.
