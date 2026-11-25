# M6: Vue, Svelte and Solid adapters (initiative, outline)

**Goal:** isolates can be written in Vue, Svelte and Solid, as they can in Preact and React today, without changing the `isoloop-dom@1` format.

**Done when:** each of Vue `^3`, Svelte `^5` and Solid `^1` has an adapter that passes the [M3a](m3a-adapters.md) adapter conformance suite on its major, with a DOM usage log, a smoke test and one small example app. No benchmarks and no dashboard ports: a framework port of markets or the plant would measure the framework, not Isoloop.

**Depends on:** 0.1 ([M4](m4-devtools-release.md)). The adapters only add packages and members of the DOM subset, so they don't have to land before the API freeze. Comes after [M5 Shared-memory engine](m5-shared-memory-engine.md); its versions are in the [releases table](roadmap.md#releases).

Gets a full task list per epic when it's next to start. Decided in a grilling on 2026-11-16; [ADR 0010](../adr/0010-own-render-bridge.md#amended-2026-11-16-adapters-after-01) records the order and the rules below.

## Epics

| Epic | Goal | Done when |
| --- | --- | --- |
| M6a Vue | A short spike first: Vue's own renderer (`createRenderer` from `@vue/runtime-core`) building on the worker's nodes, against `@vue/runtime-dom` on the DOM subset. Then the adapter on the route that wins | The spike's write-up picks a route; the adapter passes the conformance suite on Vue 3 |
| M6b DOM group 2 | Our own HTML fragment parser in the worker (`innerHTML`, `insertAdjacentHTML`, `<template>`), plus `cloneNode` and `importNode`, all producing ordinary `isoloop-dom@1` records | Conformance cases for parsing and cloning pass; the host's sanitiser still sees every record |
| M6c Svelte | The Svelte 5 adapter (runes; Svelte 4 isn't supported) | Conformance suite on Svelte 5 |
| M6d Solid | The Solid 1 adapter; Solid 2 joins when it ships stable | Conformance suite on Solid 1 |

**Order:** M6a's spike and M6b start together. If `createRenderer` works, Vue needs no HTML parsing and is the first adapter; otherwise it waits for M6b like the others. Svelte comes before Solid because more people use it, and Solid reuses the same DOM work.

## Rules

1. **No protocol change.** `isoloop-dom@1` is published from 0.1, so a new record kind would mean `@2`. Parsing and cloning happen in the worker and send ordinary insert records. Anything that needs a new host record goes to an ADR first.
2. **Our own parser, no library** ([ADR 0010](../adr/0010-own-render-bridge.md), group 2). Compiler output is well-formed and trusted, so a forgiving parser for well-formed markup is enough; it isn't the spec's full algorithm.
3. **Event delegation on `document`.** Solid delegates events at `document` and Svelte 5 at the root. The worker `document` is already an event target and events carry `composedPath`; each adapter's conformance cases check `target` and `composedPath` through delegation.
4. **Layout reads stay out.** Vue's `<Transition>` and Svelte's transitions read layout and call `element.animate`. As today, missing members throw `NotSupportedError`, with no fake layout values, and they're listed on the docs site's "What Isoloop can't hide" page.
5. **Majors, as ADR 0010 says:** each adapter declares its major as a peer range, the catalog pins one exact version per major, the tests run once per major and Dependabot moves each forward.

## Open risks

- Delegation and `composedPath` through a framework's own event system may need more of the `Event` interface than Preact and React use.
- Svelte's and Solid's compilers change output between minors; the DOM usage log per major catches it, at the cost of red update PRs.
- Vue's `createRenderer` route skips the DOM subset, so libraries used with Vue that expect a real `document` may still need the subset.
