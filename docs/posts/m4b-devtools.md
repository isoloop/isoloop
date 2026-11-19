# A devtools panel that runs as an isolate

*M4b write-up, 2026-11-19*

M4b's promise: **a devtools panel showing each isolate's health and a live bus log, running as an isolate itself, fed by one inspection feed that the dev MCP reads too.** Done when the panel shows the isolates, the bus and a live log on plant and markets, keeps working while the bus restarts, and lists itself in its own figures.

## One feed, three readers

Everything the panel shows comes from `kernel.inspect()` ([ADR 0020](../adr/0020-inspection-feed.md), `@experimental`): a snapshot of the isolates, pools and the bus, then events as they happen. State changes, crashes and failures go out at once; beats and bus metrics are coalesced to about one a second. A `tap` samples live records from the bus worker, at most 50 a second by default, with `onSkipped` counting what the cap left out. `records()` reads what a topic has kept. Values arrive as previews of at most 2,048 characters, with their size.

The same feed has three readers today:
- **The devtools panel** (`@isoloop/devtools`), through the `inspect` grant on a port of its own.
- **The dev MCP** (`isoloop mcp`, [M4a](../plans/m4a-agents.md)): `isoloop_isolates`, `isoloop_topics`, `isoloop_events`, `isoloop_records` and `isoloop_tap` read it for a coding agent.
- **Any isolate** given the grant: `ctx.inspector` is the same interface with the same controls.

The controls are restart, kill and block (a busy loop of at most 10 s). Nothing gates them in production, and a kill of a pool member takes down its whole worker, as a crash would. Memory per isolate is measured by the host with `measureUserAgentSpecificMemory()`, only on a cross-origin isolated Chromium page, at most every 5 s while a reader listens.

## The panel

`connectDevtools(kernel, { position })` adds a floating button in a corner. A click or Alt+Shift+D opens a docked panel with three views:
- **Isolates:** state, lag, busy time, memory with its age, crash restarts, patch queue and pool, with Restart, Kill and Block 2 s on each row, and a pools table.
- **Bus:** each topic's rate, head offset and retained count, each subscription's lag and credit, rejected publishes by code, and storage used.
- **Log:** live records, newest first, with the cap and the skipped count in its header.

The panel is a Preact visual isolate in its own worker, never pooled. Two things follow from that:
- **It's held to the same rules as the app.** A crash or hang in the panel doesn't reach the page, and the supervisor restarts it like any isolate. While it restarts, its button briefly disappears.
- **It lists itself,** marked `devtools`, with nothing filtered out: its worker and its beats are in the figures it shows.

Its feed comes over its own port, not bus topics, so it keeps working while the bus restarts, and its traffic doesn't count in the bus figures. Its settings (open, size, corner) are kept in IndexedDB, because a worker has no `localStorage`.

## On plant and markets

Both dashboards take `?devtools=1` on their Isoloop build ([isoloop/web#181](https://github.com/isoloop/web/pull/181)). The package is imported only when the flag is set, so a page without it runs no panel and loads none of its code, and the measured comparisons never set it. The panel's files are built as `opt-in-*` and left out of each build's JavaScript figure. Against the build before it, the figure moved from 186.3 to 186.9 KB gzipped on markets and from 178.4 to 179.0 KB on plant (the lazy import in the entry); the panel itself is about 17 KB gzipped, loaded only with the flag.

The end-to-end tests run on the built page in Chromium, Firefox and WebKit: no panel without the flag; the isolates view lists every isolate and itself; the bus view shows the topics; and a record published after `crashBus()` still reaches the log, with the panel still running. Under Vite's dev server, a smoke test per app checks that the panel's module is served from the package and not from Vite's dependency cache, which `@isoloop/vite` now arranges ([#277](https://github.com/isoloop/isoloop/pull/277)).

Markets also calls `connectWebMCP(kernel)` when the browser has WebMCP, so its two agent tools are listed to the browser's agent. Its tests list them and ask for a quote through WebMCP in Chromium and Firefox, both with WebMCP switched on by a flag.

## What the feed costs

Measured on the plant dashboard at 5 kHz, a reader on the feed for the whole run against no reader, 5 interleaved rounds per engine, on the dedicated bench machine (AMD Ryzen 7 5825U, 4 pinned cores at 2.0 GHz), Playwright 1.65 (Chromium 158), library at `ce4dc9a`, the same code as `0.1.0-next.3` ([the investigation](../investigations/inspect-feed-cost.md), raw results in [isoloop/web#170](https://github.com/isoloop/web/pull/170)). Median gap, with the lowest-to-highest spread over the rounds:

| Figure | Chromium, cross-origin isolated | Chromium | Firefox |
| --- | --- | --- | --- |
| CPU, all threads | +1 pp (−7 to +1) | −3 pp (−13 to +7) | – |
| Main-thread CPU | −0 pp (−2 to +1) | +0 pp (0 to +0) | – |
| Memory, first reading, before GC | +3 MB (−3 to +7) | +4 MB (+2 to +7) | – |
| Memory, first reading, after GC | +1 MB (−9 to +4) | −1 MB (−3 to +10) | – |
| Typing, median of 5 | +8 ms (−9 to +25) | +1 ms (−10 to +24) | +16 ms (−33 to +33) |
| Recovery after a 3 s block | +75 ms (−63 to +130) | +55 ms (−84 to +88) | −110 ms (−297 to −4) |

- **Most spreads cross zero,** so five rounds can't separate those gaps from round-to-round variation.
- **Three lean one way:** all-thread CPU on isolated Chromium, at +1 pp, the top of its spread; memory before GC on headless Chromium, higher with the feed open in every round (after GC both straddle zero); and Firefox's recovery, faster with the feed open in every round, which isn't explained yet.
- **The ring buffer** of the last 200 events, kept from the kernel's start whether anyone reads it, was about 18 KB as JSON on Chromium and 15 KB on Firefox.

These runs measure the feed with a reader that only counts. The panel's own drawing, in its worker, and an open live log aren't in them. No budget is set yet; CI's report-only `inspect` job collects runs first.

## What M4b didn't do

- **Topic replay into a scratch view** (task 12, droppable in the plan) isn't done.
- **The interactive pages** don't take `?devtools=1`.
- **A browser extension** reading the same feed, and `inspector.annotate` for the balancer's own states, are in [would-like](../would-like.md).
- **The panel's own cost while drawing** isn't measured.

## Next

The site copy for the panel ([isoloop/web#163](https://github.com/isoloop/web/issues/163)), and the M4c guides that use it as the worked example ("Build a dev tool as an isolate"). Then M4d: the 0.1 freeze.
