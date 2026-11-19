# M4b: Devtools (epic of [M4](m4-devtools-release.md))

**Goal:** a devtools panel showing each isolate's loop health and a live bus log, running as an isolate itself, fed by one inspection feed that the [M4a](m4a-agents.md) dev MCP reads too.

**Done when:** the panel shows isolates, the bus and a live log on plant and markets, keeps working while the bus restarts, and lists itself in its own figures. `kernel.inspect()` and the `inspect` grant are accepted in their own ADR.

**Status:** the inspection feed was grilled on 2026-11-18 (Q1–Q11, yes to all) and is [ADR 0020](../adr/0020-inspection-feed.md), accepted 2026-11-18. Not started. Its feed comes first: M4a's dev MCP reads wait for it.

## Main work items

1. **The inspection feed and its ADR,** [ADR 0020](../adr/0020-inspection-feed.md). `kernel.inspect()` and the `inspect` grant as public, `@experimental` API.
2. **The devtools panel** (`packages/devtools`), as decided below: a panel in the page, drawn by a visual isolate in its own worker. Its views:
   - isolates: state, lag, memory (Chromium, cross-origin isolated), restarts, patch queue, `busyMs`, pools and members (the balancer's own states, such as quarantine, are in [would-like](../would-like.md));
   - bus: topics, rates, consumer lag and credit, rejected publishes;
   - a live record log sampled from the bus worker.

   Replaying a topic into a scratch view is droppable.

## Devtools decisions (2026-11-16)

1. **A panel in the page, not a browser extension.** It works on every browser and on phones, needs no install and is one package to release. A browser extension is in [would-like](../would-like.md); it would be one more client of the same feed.
2. **One inspection feed, `kernel.inspect()`, `@experimental` in 0.1.** Subscribing gives a snapshot, then events: isolate state and lag, supervisor events, compositor stats, bus metrics, and sampled records on request. It costs nothing until something subscribes, except a ring buffer of the last 200 events kept from start ([ADR 0020](../adr/0020-inspection-feed.md), decision 5). The panel, the dev MCP and any later extension all read it.
3. **`@isoloop/devtools` is imported and mounted by the app,** and is allowed in production builds; the app author's import is the opt-in. After 0.1, isoloop.dev's live examples get a devtools toggle (an `isoloop/web` follow-up).
4. **The panel is a visual isolate in its own worker,** never pooled, written in Preact. A devtools crash or hang never touches the app, and the panel restarts like any isolate.
5. **It gets the feed through a dedicated port, granted by a new public `inspect` grant** (`@experimental`), not through bus topics. It has to keep working while the bus restarts, and its traffic mustn't count in the bus figures it shows.
6. **It lists itself in its own figures,** marked as devtools, with nothing filtered out.
7. **Controls:** kill, block and restart an isolate. No publishing from the panel; that's the dev MCP's `--allow-write` ([M4a](m4a-agents.md), decision 12).
8. **UI:**
   - When closed, a floating button (FAB) like React Query's devtools, drawn by the devtools isolate itself, so it disappears briefly while the devtools restart.
   - `position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'`, bottom-right by default.
   - The closed FAB shows a dot: amber while an isolate is restarting or lagging, red when one has given up (`maxRestarts`).
   - A click or Alt+Shift+D opens a docked, resizable panel from that corner. Its size, dock and open state are kept in IndexedDB, on the page's origin: the panel runs in a worker, which has no `localStorage` (changed 2026-11-19, #265).
   - The app calls `connectDevtools(kernel, { src?, position?, id? })`, which returns a function that disconnects, as `connectWebMCP` does (2026-11-19, #265).
9. **An ADR at the start of M4b** records the feed and the `inspect` grant as public API.

## Inspection feed decisions (2026-11-18)

Grilled on 2026-11-18 (Q1–Q11, yes to all); [ADR 0020](../adr/0020-inspection-feed.md) has them in full.

1. **`kernel.inspect(): Inspector`** with `snapshot()`, `on()`, `tap()`, `records()` and `close()`. Every message is plain structured-cloneable data, the same over the `inspect` port and the dev MCP's WebSocket. It reads the existing events and getters underneath.
2. **Contents:** a snapshot of isolates, pools and the bus (with the bus restart count, newly kept as state), then events. State, crash and failed go out at once; beats and `bus:metrics` are coalesced to about one per second. Memory per isolate is measured by the host with `measureUserAgentSpecificMemory()` when the page is cross-origin isolated, at most every 5 s while a reader listens; `@isoloop/vite` can send COOP/COEP from the dev server ([ADR 0020](../adr/0020-inspection-feed.md), decision 4, amended). `BusMetrics` gains each topic's head offset and retained count.
3. **Records:** a `HostToBus` `tap { topics, maxPerSec }` on a dedicated port, not a consumer, 50/s by default, only while the log is open, reopened after a bus restart. `records(topic, { last })` through a `HostToBus` `read`, capped at 100. Values are cut to a 2 KB preview with their size.
4. **The `inspect` grant** is a boolean like `navigate`. A pooled isolate holding it fails with `invalid_config`. The port goes host to isolate and survives a bus restart. It carries the kill, block and restart controls.
5. **Block** is a new runtime `block { ms }` busy loop, capped at 10 s, sent only over the inspect port or from an `Inspector` (the dev MCP's `isoloop_block` too).
6. **Recent events:** a ring buffer of the last 200 supervisor and bus events, kept from the kernel's start, in `snapshot()`.
7. **Placement view:** pools and members from `kernel.pools()`; `inspector.annotate` for the balancer is in would-like.
8. **Cost:** nothing but the ring buffer runs until someone inspects. Plant at `?rate=5`, feed open against closed, measured in CI and reported; no budget until the numbers are known.
9. **Format:** `InspectMessage` types in `@isoloop/protocol`, versioned, additions only, unknown fields and messages ignored.

## Tasks

About one evening each ([conventions](README.md#conventions)). Forks follow the usual rules: one PR per task, squash-merged on green CI. ADR 0020 goes to the user, and so do any findings that contradict it. Tasks 2–6 can run alongside [M4a](m4a-agents.md) tasks 6 and 7.

| # | Task | Files | Tests |
| --- | --- | --- | --- |
| 1 | ADR 0020 "Inspection feed" | `docs/adr/0020-inspection-feed.md` | — (user review) |
| 2 | `InspectMessage` types, `kernel.inspect()`, the event ring buffer | `packages/protocol/src/inspect.ts`, `packages/host/src/inspect.ts`, `packages/host/src/kernel.ts` | unit + browser: snapshot, events, coalescing, ring buffer before and after a crash, unknown messages ignored |
| 3 | The bus's `tap` and `read`, head offset and retained count in `BusMetrics`, the bus restart count as state | `packages/protocol/src/control.ts`, `packages/bus/src/{broker,server}.ts`, `packages/host/src/bus/controller.ts` | unit + browser: tap rate cap, tap absent from the consumer figures, tap reopened after a bus restart, read cap and previews |
| 4 | The runtime's `block { ms }` (heap dropped: isoloop#251) | `packages/runtime`, `packages/protocol/src/isolate.ts` | browser: block makes the beat late and the supervisor act; 10 s cap |
| 5 | The `inspect` grant, its refusal in pools, the host↔isolate port, `ctx.inspector` (ADR 0020 decision 6), the host `Inspector`'s `tap` and `records`, the controls, and removing the unused `heapBytes` | `packages/protocol/src/grants.ts`, `packages/host/src/kernel.ts`, `packages/runtime` | browser: an isolate reads the feed, the port survives a bus restart, kill/block/restart work, a pooled `inspect` fails with `invalid_config` |
| 5b | Memory per isolate: the host's `measureUserAgentSpecificMemory()` when cross-origin isolated, attributed by worker URL (a fragment per worker on the marked `@isoloop/runtime/worker` entry only), `memory` in the snapshot and feed; `@isoloop/vite`'s existing `crossOriginIsolated` sends COOP/COEP | `packages/host/src/{memory,inspect,loader,kernel}.ts`, `packages/protocol/src/inspect.ts` | browser: report reading, the 5 s loop, attribution to own workers and pools; E2E (full Chromium, COOP/COEP server): a figure per worker, shared in a pool, absent when not isolated |
| 6 | The feed's cost: plant at `?rate=5`, feed open against closed, plus the ring buffer's size after a run | `isoloop/web` plant (`?inspect=1`, `comparison/inspect/`), the *Comparison (plant)* workflow's `inspect` job; [the write-up](../investigations/inspect-feed-cost.md) | — (measurement, reported only) |
| 7 | `@isoloop/devtools` package skeleton: the visual isolate in its own worker, Preact, the floating button and dock (decision 8) | `packages/devtools` | browser: mounts, restarts on a crash, settings kept across mounts (IndexedDB) |
| 8 | Isolates view (decision 2's list) and controls | `packages/devtools` | E2E on a fixture page |
| 9 | Bus view: topics, rates, consumer lag and credit, rejected publishes | `packages/devtools` | E2E on a fixture page |
| 10 | Live record log from the tap | `packages/devtools` | E2E: log during a bus restart |
| 11 | Mount it on plant and markets (examples repo), plus the write-up | `isoloop/examples`, `docs/posts/m4b-devtools.md` | E2E: done-when on both |
| 12 | Topic replay into a scratch view (droppable) | `packages/devtools` | E2E |

## Open risks

- Scope creep; ship the isolates and bus views and the log first. Topic replay is droppable.
