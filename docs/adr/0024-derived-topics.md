# ADR 0024: Derived topics, kept by derive isolates

- **Status:** Proposed (2026-11-25), to grill when M15 is next to start (questions at the end). The design chat's handover called it 0023; it became 0024 because 0023 went to watchers.
- **Date:** 2026-11-25
- **Plan:** [M15 Derived topics](../plans/m15-derived-topics.md). Its slot in the [releases](../plans/roadmap.md#releases) is question 2.
- **Touches:** [ADR 0001](0001-one-worker-per-isolate.md) (the runtime never pools on its own), [ADR 0003](0003-schema-format-standard-schema.md) (a topic's schema), [ADR 0007](0007-bus-worker-supervision.md) (restart and replay), [ADR 0012](0012-isolates-built-apart.md) (the seam), [ADR 0014](0014-own-codec.md) (the binary codec a WASM engine reads), [ADR 0017](0017-opt-in-balancer.md) (what the balancer places), [ADR 0020](0020-inspection-feed.md) (kill and block from the inspector).

## Context

Plant's fleet engine subscribes only to derived topics (`spectrum`, `health`, `scalars`), never to raw vibration ([M3d](../plans/m3d-plant-dashboard.md), decision 5). Each one is computed by hand, in TypeScript, in a headless isolate. Every app that wants a windowed sum or a filtered stream writes that isolate again.

Filters, windows, groups and aggregates over large topics are work a columnar engine with SIMD and threads can do in fewer milliseconds than per-record JavaScript. That holds only if the data and the work stay in the engine: a crossing between JS and Rust for each record or each call costs more than the engine saves. So JS describes the work once, as a plan, and the engine runs it.

The forces:

- **The bus worker only routes records.** Isoloop runs the work apart from what depends on it, and every topic depends on the bus worker. A heavy derivation there would block its loop and stall every topic.
- **A derived topic is a topic.** Readers subscribe, watch, replay and get grants on it as on any other.
- **Grants guard sources.** If a derived topic could be read without the grants on its sources, it would be a way around them.
- **The runtime never pools on its own** (ADR 0001, as amended by ADR 0017). Pools are the app's choice, or the balancer's in pools it owns.
- **The balancer places only what is spawned through it** (ADR 0017).
- **The inspector can kill, block and restart any isolate** (ADR 0020).
- **New API starts `@experimental`,** and a seam addition ships in a minor (ADR 0019).

## Decision

### 1. A topic may carry a plan

`topic()` takes an optional `derive:` plan built with `@isoloop/derive`'s builder. The plan names its source topics, and the derived topic's schema checks its output as any topic's does. A sketch, not decided:

```ts nocheck
export const volume = topic('market.volume.v1', {
  schema: VolumeSchema,
  derive: from(trades)
    .filter(col('qty').gt(0))
    .window('1m')
    .groupBy('sku')
    .agg({ vol: sum('qty') }),
});
```

The plan is data, not code: a serialisable tree of operators. v1's operators are filter, map, window, groupBy and aggregate (join is question 3). It stays a small set, not a query language.

### 2. Derivations never run in the bus worker

The bus only routes records. Each derived topic is kept by one **derive isolate**: a headless isolate the kernel spawns and owns, running a fixed engine instead of user code. It subscribes to the plan's sources, runs the plan and publishes the derived topic.

### 3. Derive isolates are placed like other isolates

A light derive isolate shares a `derive` pool; a heavy one gets its own worker, set per topic. Both are recorded as defaults the kernel picks, which ADR 0001's rule doesn't allow today (question 8). The balancer may move them by `busyMs`, which ADR 0017 doesn't allow either (same question).

### 4. Supervision and replay as for any isolate

A blocked or crashed derive isolate is restarted by the supervisor and resumes from its committed offset on each source. The bus and every other topic keep running, and the derived topic catches up from the log.

### 5. Reading a derived topic needs the grants on its sources

An isolate that subscribes to or watches a derived topic needs the subscribe grant on the derived topic and on every one of its sources, checked when it subscribes. A derived topic can't be used to read what the reader couldn't read itself.

### 6. One engine interface, two engines

The derive isolate runs the plan through an engine interface. A TypeScript reference engine ships first, with an engine conformance suite. A Rust engine compiled to WASM runs in the same derive isolate behind the same interface, reusing M5's toolchain, codec and `SharedArrayBuffer` setup. It ships only if it does better than the TypeScript engine on [M13](../plans/m13-benchmark-gate.md), the same rule as M5. Whether to wrap DataFusion, Polars or DuckDB-wasm, or build our own, is question 5.

### 7. Devtools shows derived topics

A row per derived topic: its plan, its lag behind each source and the engine it runs. Derive isolates appear in the isolate list marked as the kernel's.

## Consequences

- **Data processing needs no isolate code** for the operators v1 covers, and the plan is safe to accept from a spec (M3e's widgets, the Builder's agent).
- **A blocked derivation stalls only its own topic.** The bus and the other derived topics keep running.
- **Every derived topic costs a derive isolate,** on a shared pool or its own worker, with the memory and start-up that brings. The docs say so.
- **The same plan can later run outside the webview** ([ADR 0025](0025-native-runtimes.md)), since it's data with a fixed engine.
- **New API, all `@experimental`:** `derive:` on `topic()` and `@isoloop/derive`. `topic()` is in the isolate seam, so this ships in a minor.

## Alternatives considered

- **Run plans in the bus worker.** Rejected: a heavy plan blocks the loop every topic shares (decision 2).
- **A JS-to-Rust call per record or per operator.** Rejected: the crossing costs more than the engine saves. The data and the work stay in the engine.
- **Leave it to app code,** as plant does today. Not taken: every app writes the same isolate again, and a spec can't carry code.
- **A full query language** (SQL). Not taken for v1: a small operator set is easier to check, explain and run in two engines.

## To grill

1. **M16's release** is [ADR 0025](0025-native-runtimes.md)'s question 1. This ADR runs in the browser and doesn't wait on it. Is that split right, or should the plan format be grilled with ADR 0025, so it fits a native engine from the start?
2. **M15's slot.** The TypeScript engine needs only the bus. `0.3.0`, `0.4.0` or later?
3. **Join in v1?** A join over two topics needs keyed state and a window per side.
4. **Incremental or windowed recompute** for v1. Incremental aggregation over windows with late records is hard; windowed recompute may be enough.
5. **Build or wrap the Rust engine:** DataFusion, Polars, DuckDB-wasm or our own. The spike starts with DataFusion. Wrapping one sits behind our own engine interface and conformance suite either way.
6. **Mobile** (iOS and Android), still open in [ADR 0022](0022-tauri.md). Does the WASM engine's binary size matter there?
7. **The security boundary** for untrusted native or WASM code, which needs its own ADR. Here only in that derive isolates run no user code.
8. **System-owned isolates and existing rules.**
   - A default `derive` pool the kernel creates goes against ADR 0001 as amended by ADR 0017: the runtime never pools on its own. Amend ADR 0001 for kernel-owned isolates, or make the `derive` pool something the app declares?
   - The balancer places only isolates spawned through it, into `balancer-` pools it owns (ADR 0017). Does it gain derive isolates, or do they stay out of its reach?
   - The inspector carries kill and block for every isolate (ADR 0020). If apps can't kill a derive isolate, does devtools still block or restart one, and is that a refusal in the feed?
9. **Grants checked once or continuously.** Decision 5 checks at subscribe time. What happens when a plan's sources change between versions of the derived topic?
