# M15: Derived topics (outline)

**Goal:** topics defined by a plan over other topics and kept up to date by derive isolates, so processing data needs no isolate code and can run in a Rust engine ([ADR 0024](../adr/0024-derived-topics.md), *Proposed*, drafted 2026-11-25).

**Done when:**

- A derived topic declared in contracts replaces one of plant's hand-written derived topics, with identical output in equivalence tests.
- Blocking or crashing its derive isolate leaves the bus and every other topic running, and the derived topic catches up from the log.
- The TypeScript and Rust/WASM engines are benchmarked on [M13 Benchmark gate](m13-benchmark-gate.md) at several data sizes, and the crossover point is written up, whatever it shows.

**Depends on:**

- **The `0.1` kernel, bus and pools.** A derive isolate is an ordinary headless isolate whose owner is the kernel.
- **[M5 Shared-memory engine](m5-shared-memory-engine.md),** for the Rust engine only. It reuses M5's toolchain, binary codec and `SharedArrayBuffer` setup.
- **[M13 Benchmark gate](m13-benchmark-gate.md),** for the benchmark verdict.
- **Not [M16 Native runtimes](m16-native-runtimes.md).** This milestone works in the browser on its own.

Added 2026-11-25. Its slot in the [releases](README.md#releases) is open (ADR 0024, question 2). Grilled before it gets a task list, together with its ADR.

## Why derive isolates

Plant's fleet engine already subscribes only to derived topics ([M3d](m3d-plant-dashboard.md), decision 5), but each one is computed by hand in a headless isolate. Filters, windows, groups and aggregates over large topics are work a columnar engine with SIMD and threads can do in fewer milliseconds than per-record JavaScript, but only if the data and the work stay in the engine: a crossing between JS and Rust for each call costs more than it saves. So JS sends a plan across once, and the engine runs it.

A derivation never runs in the bus worker. A heavy one there would block its event loop and stall every topic, which breaks the rule that code sharing data shouldn't share an event loop. The bus only routes records. Each derived topic is kept by its own **derive isolate**: a headless isolate the kernel owns, running a fixed engine instead of user code. It subscribes to the sources, runs the plan and publishes the derived topic, is placed like any other isolate, and is restarted by the supervisor from its committed offsets.

## Shape of the API

A sketch, not decided:

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

## Main work items

1. **[ADR 0024](../adr/0024-derived-topics.md):** the plan format and the v1 operators (filter, map, window, groupBy, aggregate; join is a question); incremental or windowed recompute; system-owned isolates (who spawns them, how devtools shows them, what an app may do to them); grants carrying over, so reading a derived topic needs the subscribe grant on each of its sources.
2. **`@isoloop/derive`:** the plan builder and `derive:` in `topic()`; the kernel spawns one derive isolate per derived topic; a TypeScript reference engine and an engine conformance suite.
3. **Placement:** a default `derive` pool, an own-worker option for heavy plans, and balancer support, as far as the ADR's questions on [ADR 0017](../adr/0017-opt-in-balancer.md) allow.
4. **The Rust engine,** compiled to WASM and run inside the derive isolate behind the same engine interface. Spike DataFusion first, compare it with Polars and DuckDB-wasm, then decide whether to wrap one or build our own.
5. **Supervision and replay:** on restart, resume from the committed offset on each source.
6. **Devtools:** a row per derived topic, with its plan, its lag behind each source and the engine it runs.
7. **Port one of plant's derived topics** in `isoloop/web`, measure it with the [M3f](m3f-markets-parity.md) method, and write it up, including the sizes where the TypeScript engine does better.

**Release:** the TypeScript engine as `@experimental` in the minor after ADR 0024 is accepted. The Rust engine follows M5 and ships only if it does better on M13, the same rule as M5.

## What builds on it

Noted, not planned: [M3e](m3e-live-widget-creator.md)'s widget specs (source → filter/window/aggregate → view) and the [Isoloop Builder](builder.md)'s agent output are both plans, so both could become derived topics. That fits the Builder's decision that the agent writes specs, not code.

## Open risks

- **The plan format may grow into a query language.** Keep v1's operators few.
- **The binary codec and the copies between the bus and a WASM engine** may cost more than the engine saves on small topics. Measure early.
- **Incremental aggregation over windows with late records is hard.** Windowed recompute may be the v1 answer.
- **Plant's derived topics may not fit v1's operators.** `spectrum` is an FFT over a Hann window, which filter, map, window, groupBy and aggregate can't express. The topic to port is picked when the milestone is grilled: `health`, or an aggregate over `scalars`, is the likelier fit.
