# Would like

Ideas we've consciously deferred or want to explore later. None of them is planned or promised: an item moves into a milestone plan only when a user asks for it, or a milestone shows it's needed, and then it gets an ADR if it changes a decision. Each entry links the ADR that deferred it. Work we have committed to but that waits on something is in [should-do](should-do.md) instead.

## Bus and contracts

- **De-duplicating request records by `req.id`.** A crash after a handler's side effect but before its reply delivers the request again, so [M4a](plans/m4a-agents.md) (decision 8) asks tool handlers to be idempotent by `req.id`, as the bus guide asks of every handler. The bus could instead skip a request record it has already seen answered. Only if consequential agent tools turn out to need it.
- **`no_responder` for `bus.request`.** [ADR 0018](adr/0018-tools-for-agents.md) fails a `kernel.request` at once when no isolate could answer, from grants and states the host has. An isolate's own `bus.request` still waits out its timeout; failing it fast would need the bus to know which isolates could answer.
- **Async seed `map`.** Let a seed's `map` return a promise, for migrations that need I/O. Deferred because it puts the network on the seed's path inside the bus worker; the migrator-isolate pattern covers it today. ([ADR 0003](adr/0003-schema-format-standard-schema.md))
- **`kernel.reseed(topic)`.** Re-run the current `map` over the v1 offsets a seed rejected, once the `map` or the schema is fixed. The offsets are already kept in the seed metadata. ([ADR 0003](adr/0003-schema-format-standard-schema.md))
- **`migrator(from, to, map)` helper.** A ~20-line helper in `@isoloop/runtime` that builds the migrator isolate for migrations a seed can't express. ([ADR 0003](adr/0003-schema-format-standard-schema.md))
- **`isoloop contracts check --against <ref>`.** Detect breaking schema changes within a topic version by diffing exported JSON Schema. Today it's a CI review of the diff. ([ADR 0003](adr/0003-schema-format-standard-schema.md))
- **Hot contract reload.** `kernel.reloadContracts()` for long-lived tabs that outlive a deploy. Needs validation against two versions at once. ([ADR 0003](adr/0003-schema-format-standard-schema.md))

## Frameworks

Vue, Svelte and Solid left this list on 2026-11-16: they're planned after 0.1 in [M6](plans/m6-adapters.md).

- **Svelte 4.** M6 supports Svelte 5 only; Svelte 4 compiles quite differently and would roughly double the work for an old major. Only if users ask. ([ADR 0010](adr/0010-own-render-bridge.md#amended-2026-11-16-adapters-after-01))

## Rendering

The main thread shows everything isolates render ([engine constraints](investigations/engine-constraints.md) §1 and §2). These would reduce what it has to do; each needs measurements first, and an ADR if it changes the protocol or adds API.

- **Fewer canvases.** One worker draws several widgets' charts into one shared canvas laid over the grid, so the page presents one canvas instead of many. Aimed at engines where presenting worker canvases costs main-thread time per canvas (§2). Layout, scrolling and hit-testing get harder.
- **Pace canvas updates across isolates.** The host sets a page-wide budget of canvas presents per frame and isolates draw in turn. Library API, so an ADR.
- **Input first in the compositor.** Pause applying DOM batches while input is pending (`navigator.scheduling.isInputPending` in Chromium, or yielding to the event loop), so keystrokes run first. Helps DOM applying, not canvas presentation, which happens inside the engine.
- **The iframe tier for performance.** The [system design §11](design/system-design.md) iframe tier, planned for hostile code, used for heavy widgets on browsers that give a cross-site iframe its own process (§7). A process and a site per widget; it may not help with canvas presentation, since every process's frames meet in the same compositor.

- **Attribute errors per member in a pool with `AsyncContext`.** Today an error thrown from a shared framework scheduler or a timer in a pooled worker can't be traced to a member, so the whole pool restarts. `AsyncContext` would carry the member across `await` and timers, so such errors could stay the member's own. Waits on browsers shipping it. ([ADR 0015](adr/0015-visual-pools.md))
- **Count promise continuations in `busyMs` with `AsyncContext`.** The runtime bills timers, rAF, `queueMicrotask` and ports to the member that scheduled them, but not work resumed after `await`, so a member whose work runs in `await`ed slices looks nearly idle. In [M3i](plans/m3i-balancer-scaling.md)'s File processor measurement, each processor read 0 to 8 % of a core. `AsyncContext` would carry the member across `await`. Until browsers ship it, the app reports its own busy time to the balancer ([M3j](plans/m3j-balancer-gaps.md), [ADR 0017](adr/0017-opt-in-balancer.md)).

## Supervision

- **Restart settings per isolate.** Today `KernelConfig.supervisor` (`strategy`, `maxRestarts`, `withinMs`, `backoff`) applies to every isolate in a kernel, so a feed that should always restart and a third-party widget that should hit the crash-loop guard share one policy. A `supervisor` field on the spawn manifest would override the kernel's defaults for that isolate. Pool members are already counted one by one, so it fits pools. It's new public API, so it needs an ADR 0001 amendment. Raised from the website's crash-loop demo, where the kernel-wide setting was judged enough for now. ([system design §4.3](design/system-design.md#43-supervisor))
- **Validate the supervisor settings.** `createKernel` accepts any numbers: `maxRestarts: NaN` silently means "always restart", and a negative or zero `withinMs` breaks the sliding window. Reject them with `invalid_config`, as `bus.commitIntervalMs` already is.
- **Document "always restart".** `maxRestarts: Infinity` restarts every time in today's code (the check `restarts >= Infinity` is never true), and the backoff (250 ms × 2ⁿ, capped at 4 s by default) is then the only brake on a crash loop. Say so in the guide, or add an explicit `strategy: 'always'`.

## Storage

- **IndexedDB storage when OPFS sync access is missing.** Today such a tab falls back to memory topics with `bus:durability-degraded` (`no-sync-access`). A second storage engine is worth it only if a major browser lacks sync access in normal browsing. ([ADR 0007](adr/0007-bus-worker-supervision.md), M2b task 15)
- **A single-thread kernel (`@isoloop/local`),** for testing isolates without workers or as a fallback where workers aren't available. Drafted as ADR 0013 for the M3b comparison and withdrawn on 2026-11-07, since the comparison uses a native build; it would need its own ADR and semver promise if users ask.

## Multiple tabs

- **Share the bus across tabs.** Today a second tab falls back to memory topics with `bus:durability-degraded` and runs its own isolates, so a backend-less app opened in two tabs fetches everything twice (two sets of exchange WebSockets in the markets dashboard). Options: the bus in a `SharedWorker`, or a leader tab elected through Web Locks that runs the feeds and relays records over `BroadcastChannel`. Out of v1 by [ADR 0005](adr/0005-bus-topology-message-channels.md) and [ADR 0007](adr/0007-bus-worker-supervision.md). Backend-less apps are the use case that would justify it.

## Routing

- **Path-glob navigate grants.** `grants.navigate: string[]` matched against `path`, with `true` meaning `['*']`. Today `onNavigate` with `req.from` covers path rules. ([ADR 0002](adr/0002-host-owns-routing.md))
- **`back`/`go(n)` host call.** Hard to veto beforehand, gives no result, and may leave the app. ([ADR 0002](adr/0002-host-owns-routing.md))
- **Detecting host navigations without wiring.** Use the Navigation API's `currententrychange` where available, as an option on top of `kernel.syncRoute()`. ([ADR 0002](adr/0002-host-owns-routing.md))
- **Isolates owning URL segments.** The micro-frontend router model. ([ADR 0002](adr/0002-host-owns-routing.md))

## Devtools

- **The balancer's states in devtools (`inspector.annotate(source, data)`).** The M4b panel shows pools and members from `kernel.pools()`, but not the balancer's own states such as quarantine or a running bisect. An `annotate` call on the inspector would let the balancer add them. Deferred because it adds public API to two packages before the 0.1 freeze. ([ADR 0020](adr/0020-inspection-feed.md))
- **Heap per isolate in devtools (`performance.measureUserAgentSpecificMemory()`).** Chromium has `performance.memory` only on the main thread, so 0.1 shows no heap. `measureUserAgentSpecificMemory()` works in workers but only on cross-origin-isolated pages, asynchronously and coarsely. Worth it if browsers make it practical. ([ADR 0020](adr/0020-inspection-feed.md), decision 4)
- **A browser extension.** M4b's devtools are a panel in the page, drawn by an isolate ([M4b](plans/m4b-devtools.md#devtools-decisions-2026-11-16)). An extension would give devtools on a site without changing its code, and space outside the page. It would be one more client of `kernel.inspect()`, like the panel and the dev MCP, so it needs no new kernel work. Worth it once other people run Isoloop apps in production. It can't reach phones, and Safari needs an Xcode build and a paid Apple developer account.

## Widget creator

From the [M3e](plans/m3e-live-widget-creator.md) grilling, 2026-11-16.

- **`combine`.** A widget with a second source, merged into time buckets. Left out of v1: two sources need two grants and a time-alignment rule, and it's the hardest operator to explain in a form or to an agent.
- **An expression syntax.** `price > 100 && region == "EU"`, parsed by our own parser, next to the structured predicates. Structured JSON is what agents write reliably and what validates field by field, so v1 has only that.
- **Reordering widgets.** Move left and right buttons on each widget. Drag and drop isn't possible in the DOM subset.
- **Replicas.** The balancer starting extra copies of a consumer-group member that's behind, rather than only giving it more CPU. It needs an app-declared replicable manifest and a way to generate ids, since ids are unique. [M3i](plans/m3i-balancer-scaling.md) moves an isolate that's behind and leaves replicas for later. (Packing back, which was here, is planned in M3i.)
- **Placement by topic affinity.** Grouping isolates that subscribe to the same topics in one pool, as an input to [M3h](plans/m3h-auto-placement.md)'s balancer next to load. It saves nothing while the bus delivers each record once per member; it would pay once one delivery per pool worker exists (the `shareRecords` opt-in [ADR 0016](adr/0016-fewer-messages-per-record.md) defers), and should be measured then.
- **Placement groups.** `balancer.spawn(manifest, { group })`: [M3h](plans/m3h-auto-placement.md)'s balancer would share pools only among isolates of the same group, so, for example, widgets on data sources A and B are never pooled together. Pools would be named under the reserved prefix (`balancer-A-1`). This is how separation is meant to be served, rather than several balancers per kernel, which [ADR 0017](adr/0017-opt-in-balancer.md) rejects because they'd contend for the same CPU, cap and quarantine slot.
- **A make-before-break `kernel.move()`.** M3h moves an isolate by stopping it, then spawning it again in another pool, so a visual widget goes blank until it redraws. A kernel primitive that starts the new copy before stopping the old one would close that gap, but two copies of one id would share its subscriptions and surface for a moment. Only if M3h's measured move gap turns out to be a problem.

## Isoloop Builder

These move to `isoloop/builder` when that repo is created, with the [decisions so far](plans/builder.md).

- **Generated code in a sandbox.** Builder v1's agent writes specs only, so it can do only what the fixed operators and views can. Letting it write code, run in a sandboxed isolate (perhaps the [system design §11](design/system-design.md) iframe tier), would cover the rest; a non-technical user can't review that code, so it needs its own design.
- **An online platform.** Builder dashboards are saved in the browser (a persistent topic in OPFS), with export and import as a file. A hosted place where people store and view them, across devices or shared with others, would need accounts and a backend, so it's outside the tab boundary and a separate product decision.

## Tooling

- **tsrs as the type checker.** The Rust port of the TS 7 checker (`oxc-project/tsrs`). Switch `typecheck` from `tsc` once tsrs has a stable release for the TypeScript version we're on and is at least 2× faster than `tsc` on this repo. It's one script change. ([ADR 0009](adr/0009-toolchain.md))

## Getting started

- **A way in for new and existing apps,** for developers (non-technical users get the [Isoloop Builder](plans/builder.md)). Two shapes to weigh once 0.1 is out: a starter template (`npm create isoloop`) for new apps, and an agent skill that adapts an existing app to Isoloop, splitting it into isolates and contracts (*2026-11-17:* the porting skill is now in [Towards 1.0](plans/README.md#towards-10); 0.1 ships a "build with Isoloop" skill for new code, [M4a](plans/m4a-agents.md) decision 17). They may share one source of truth for what an Isoloop app looks like. Whether the unscoped `isoloop` package also re-exports the main APIs, so users install one thing, is part of the same question; today it's planned as the CLI only ([ADR 0004](adr/0004-npm-name.md), M4).
