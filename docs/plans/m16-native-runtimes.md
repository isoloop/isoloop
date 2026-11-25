# M16: Native runtimes (outline)

**Goal:** headless isolates that run outside the webview, as WASM components in the Rust core or as native OS processes, with the same `defineIsolate` and bus API ([ADR 0025](../adr/0025-native-runtimes.md), *Proposed*, drafted 2026-11-25). The runtime becomes part of placement, next to own-worker and pools, for example `runtime: 'worker' | 'wasm' | 'native'`. Derive isolates from [M15 Derived topics](m15-derived-topics.md) are the first workload: they're system code with a fixed engine and no user code to trust.

**Done when:**

- In [M12 Tauri](m12-tauri.md)'s example app, one of plant's derived topics runs on all three runtimes with identical output: webview worker, WASM component and native.
- Its throughput is measured against the webview version on the same machine, and written up, whatever it shows.
- A user's headless JS isolate runs unchanged as a WASM component.
- Crash, restart and replay behave the same in every runtime.

**Depends on:**

- **[M11 Pure kernel core](m11-pure-kernel-core.md),** so a Rust host can reuse the kernel's pure decisions.
- **[M12 Tauri](m12-tauri.md),** for the Tauri shell and its IPC.
- **[M5 Shared-memory engine](m5-shared-memory-engine.md),** with its engine built so it also runs natively, so the bus can live in the Tauri core.
- **[M15 Derived topics](m15-derived-topics.md),** for its first workload.

Added 2026-11-25. Not in the [releases](roadmap.md#releases): whether it ships in `1.x` or with `2.0` is open (ADR 0025, question 1). Grilled before it gets a task list, together with its ADR.

## Why

Today a headless isolate is a Web Worker in the webview, and nothing on the roadmap runs one outside JS. M12 only lets isolates *call* native commands (`exposeCommands`). The [2.0 hosts](roadmap.md#towards-20-node-bun-and-server-side-rendering) for Node and Bun use `worker_threads`, which are still JS threads. A Tauri app has a Rust process next to the page; this milestone lets isolates run there, under the same supervision, grants and bus.

## Main work items

1. **[ADR 0025](../adr/0025-native-runtimes.md):** where the bus lives in a Tauri app (the webview or the core); the wire protocol for isolates outside JS; how `runtime` appears in placement, and how it works with pools and the balancer.
2. **The bus in the core:** M5's engine built natively, with webview isolates attached over Tauri IPC. A webview isolate can't tell whether a topic's producer is native.
3. **A Rust supervisor** with heartbeats, restarts and replay that match the kernel's, driven by M11's decisions.
4. **The native derive engine:** M15's Rust engine built natively, with threads and SIMD, measured against the WASM and webview builds.
5. **The WASM runtime:** wasmtime in the core. JS reaches it through ComponentizeJS (SpiderMonkey) or Javy (QuickJS), so a user's headless JS isolate compiles unchanged. It has no JIT, so expect it to be slower than a worker: measure it and document the result.
6. **Native sidecars** for existing binaries: spawn, stdio and an OS sandbox (Landlock and seccomp on Linux, App Sandbox on macOS, AppContainer on Windows).
7. **Grants as capability handles** for runtimes outside the webview: filesystem scopes, network and MCP, checked when a handle is created rather than per record. This starts a real security boundary, where today the README and the limits guide say Isoloop is not one. It needs its own ADR before any untrusted code runs natively.
8. **The example, the measurements and a write-up.**

## Suggested order

From the 2026-11-25 design chat, not a release decision:

1. M15 with the TypeScript engine, in the browser only.
2. M5 in `0.4.0`, which gives M15 its Rust/WASM engine.
3. M12 Tauri, also in `0.4.0`.
4. This milestone: native derive isolates first, user isolates after.

Each step is useful on its own, and nothing waits on the security boundary until user code runs natively.

## Open risks

- **Two supervisors, TypeScript and Rust, could drift apart.** M11's pure decisions are what prevent that, so M11 must be complete.
- **IPC latency between the webview and the core** may cost more than native execution saves on small topics.
- **Mobile:** iOS forbids spawning binaries and JIT compilation, so only the WASM runtime, interpreted or compiled ahead of time, works there. ADR 0022 leaves mobile open.
- **A Rust host adds a second toolchain** to CI and releases. M12 already raises this.
- **The bus in the core reopens a rejected alternative.** ADR 0022 turned down the log engine in the Rust core because `LogEngine` is synchronous and lives in the bus worker. ADR 0025 has to answer that before item 2 starts.
