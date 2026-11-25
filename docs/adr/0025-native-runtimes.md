# ADR 0025: Native runtimes for headless isolates

- **Status:** Proposed (2026-11-25), to grill when M16 is next to start (questions at the end). The design chat's handover called it 0024; it became 0025 because 0023 went to watchers.
- **Date:** 2026-11-25
- **Plan:** [M16 Native runtimes](../plans/m16-native-runtimes.md). Not in the [releases](../plans/README.md#releases): its release is question 1.
- **Touches:** [ADR 0001](0001-one-worker-per-isolate.md) (placement), [ADR 0005](0005-bus-topology-message-channels.md) (isolates talk to the bus worker over `MessageChannel`s), [ADR 0007](0007-bus-worker-supervision.md) (bus supervision and durability), [ADR 0008](0008-isolates-and-surfaces.md) (headless isolates), [ADR 0012](0012-isolates-built-apart.md) (the seam), [ADR 0017](0017-opt-in-balancer.md) (what the balancer moves), [ADR 0022](0022-tauri.md) (the Tauri package, which rejected the log engine in the Rust core), [ADR 0024](0024-derived-topics.md) (derive isolates, the first workload).

## Context

A headless isolate today is a Web Worker in the webview. Nothing on the roadmap runs one outside JS. [M12 Tauri](../plans/m12-tauri.md) lets isolates *call* native commands through `exposeCommands`; the `2.0` hosts for Node and Bun use `worker_threads`, which are still JS threads.

A Tauri app has a Rust process next to the page. Work that runs there gets threads, SIMD and native libraries, and isn't limited by the webview's worker budget. ADR 0024's derive isolates are a fit to try first: system code, with a fixed engine and no user code to trust.

The forces:

- **`LogEngine` is synchronous** and lives in the bus worker. ADR 0022 rejected the log engine in the Rust core for that reason: making it async would change the broker's hot path for every app to suit one host. A bus in the core reopens that decision.
- **Isolates talk to the bus over direct `MessageChannel`s** (ADR 0005). An isolate outside JS has no `MessageChannel`.
- **One set of supervision rules.** Heartbeats, restarts, the restart limit and replay must behave the same wherever an isolate runs. [M11 Pure kernel core](../plans/m11-pure-kernel-core.md) puts the kernel's decisions in pure modules that a second shell can reuse.
- **Isoloop is not a security boundary today.** The README and the limits guide say so: isolates run same-origin and grants keep isolates to their topics, not attackers out. Running untrusted code natively would need one.
- **1.x stays browser-only.** The maintainer decided on 2026-11-18 that non-browser hosts are `2.0` scope. Native runtimes run isolates outside the browser.
- **Mobile is open** in ADR 0022. iOS forbids spawning binaries and JIT compilation.

## Decision

### 1. Runtime is part of placement

Placement gains a runtime next to own-worker and pools, for example `runtime: 'worker' | 'wasm' | 'native'`. `worker` is today's behaviour and the default. The same `defineIsolate` and bus API apply in every runtime, and a headless isolate's code doesn't change with its runtime. Visual isolates stay in the webview.

### 2. Derive isolates first, user isolates after

The first workload is ADR 0024's derive isolates, with the Rust engine built natively. A user's headless JS isolate comes after, through the WASM runtime (decision 4). Native sidecars for existing binaries come last.

### 3. The bus moves to the core in a Tauri app that uses native runtimes

M5's engine, built natively, runs the bus in the Tauri core, with webview isolates attached over Tauri IPC. A webview isolate can't tell whether a topic's producer is native. This reopens ADR 0022's rejected alternative, so it's question 2, not settled here: the alternative is the bus staying in the webview, with native isolates attached over IPC.

### 4. Three runtimes

- **`worker`:** a Web Worker in the webview, as today.
- **`wasm`:** a WASM component in wasmtime in the core. JS isolates reach it through ComponentizeJS (SpiderMonkey) or Javy (QuickJS), so a headless JS isolate compiles unchanged. These have no JIT, so the runtime is measured against `worker` and the result documented, whatever it shows.
- **`native`:** a native process or thread in the core, for Rust engines and, later, sidecars spawned with stdio under an OS sandbox (Landlock and seccomp on Linux, App Sandbox on macOS, AppContainer on Windows).

### 5. A Rust supervisor on M11's decisions

The core gets a supervisor with heartbeats, restarts and replay driven by M11's pure decisions, so the TypeScript and Rust supervisors make the same choice from the same inputs. Crash, restart and replay behave the same in every runtime, checked by one conformance suite run against both.

### 6. Grants as capability handles outside the webview

Outside the webview, a grant becomes a capability handle: filesystem scopes, network and MCP, checked when the handle is created rather than per record. That begins a real security boundary. No untrusted code runs natively until a separate ADR on that boundary is accepted (question 7).

## Consequences

- **Derived topics can run on threads and SIMD** in a Tauri app, with the same plan and output as in the browser, measured against the webview.
- **A user's headless isolate can move off the webview** by changing placement, not code.
- **Two supervisors exist,** kept in step only by M11's pure decisions and a shared conformance suite.
- **IPC between the webview and the core is on the path** of every record a webview isolate reads from a native producer. On small topics it may cost more than native execution saves.
- **The Rust host adds a second toolchain** to CI and releases, beyond M12's crate.
- **New API, `@experimental`:** the `runtime` placement option, in `@isoloop/tauri` or wherever question 1 puts it.

## Alternatives considered

- **Only native commands** (M12's `exposeCommands`). Not enough: the work still runs per call, with a crossing each time, and outside supervision.
- **Wait for the `2.0` Node and Bun hosts.** They use `worker_threads`, which are still JS, so they don't give native execution.
- **A JS-to-Rust call per operator from a webview isolate.** Rejected as in ADR 0024: the crossings cost more than the engine saves.

## To grill

1. **M16's release.** The 2026-11-18 rule keeps `1.x` browser-only and makes non-browser hosts `2.0` scope. Native runtimes break that rule. Does M16 go to `2.0` next to Node and Bun, or ship in `1.x` as an `@experimental` part of `@isoloop/tauri`?
2. **Where the bus lives in a Tauri app:** the webview or the core. The core means reopening ADR 0022's rejection of the log engine in the Rust core, and an amendment to ADR 0005 for isolates without a `MessageChannel`.
3. **The wire protocol** for isolates outside JS: the bus port's messages over Tauri IPC, over a socket, or over shared memory in the core.
4. **Runtime in placement:** how `runtime` combines with pools (a pool per runtime?), and whether the balancer may move an isolate between runtimes or only within one (ADR 0017).
5. **ComponentizeJS or Javy** for JS in the WASM runtime.
6. **Mobile** (iOS and Android), still open in ADR 0022. Only the WASM runtime, interpreted or compiled ahead of time, works on iOS.
7. **The security boundary** for untrusted native or WASM code, in a separate ADR: what it promises, and how the README, the limits guide and `SECURITY.md` change when it lands.
