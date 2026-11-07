# Would like

Ideas we've consciously deferred or want to explore later. None of them is planned or promised: an item moves into a milestone plan only when a user asks for it, or a milestone shows it's needed, and then it gets an ADR if it changes a decision. Each entry links the ADR that deferred it. Work we have committed to but that waits on something is in [should-do](should-do.md) instead.

## Bus and contracts

- **Async seed `map`.** Let a seed's `map` return a promise, for migrations that need I/O. Deferred because it puts the network on the seed's path inside the bus worker; the migrator-isolate pattern covers it today. ([ADR 0003](adr/0003-schema-format-standard-schema.md))
- **`kernel.reseed(topic)`.** Re-run the current `map` over the v1 offsets a seed rejected, once the `map` or the schema is fixed. The offsets are already kept in the seed metadata. ([ADR 0003](adr/0003-schema-format-standard-schema.md))
- **`migrator(from, to, map)` helper.** A ~20-line helper in `@isoloop/runtime` that builds the migrator isolate for migrations a seed can't express. ([ADR 0003](adr/0003-schema-format-standard-schema.md))
- **`isoloop contracts check --against <ref>`.** Detect breaking schema changes within a topic version by diffing exported JSON Schema. Today it's a CI review of the diff. ([ADR 0003](adr/0003-schema-format-standard-schema.md))
- **Hot contract reload.** `kernel.reloadContracts()` for long-lived tabs that outlive a deploy. Needs validation against two versions at once. ([ADR 0003](adr/0003-schema-format-standard-schema.md))

## Frameworks

- **Solid and Svelte adapters.** Both compile markup to HTML strings, parse them in a `<template>` and copy them with `cloneNode(true)` or `importNode`, so they need HTML parsing and `cloneNode` in the `isoloop-dom` subset first (group 2). Next after 0.1. ([ADR 0010](adr/0010-own-render-bridge.md#frameworks-and-versions))
- **Vue adapter.** Evaluate after Solid and Svelte: its runtime DOM renderer probably works on the same additions, or a custom renderer could target records directly. ([ADR 0010](adr/0010-own-render-bridge.md#frameworks-and-versions))

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

## Tooling

- **tsrs as the type checker.** The Rust port of the TS 7 checker (`oxc-project/tsrs`). Switch `typecheck` from `tsc` once tsrs has a stable release for the TypeScript version we're on and is at least 2× faster than `tsc` on this repo. It's one script change. ([ADR 0009](adr/0009-toolchain.md))

## Getting started

- **A way in for new and existing apps.** Two shapes to weigh once 0.1 is out: a starter template (`npm create isoloop`) for new apps, and an agent skill that adapts an existing app to Isoloop, splitting it into isolates and contracts. They may share one source of truth for what an Isoloop app looks like. Whether the unscoped `isoloop` package also re-exports the main APIs, so users install one thing, is part of the same question; today it's planned as the CLI only ([ADR 0004](adr/0004-npm-name.md), M4).
