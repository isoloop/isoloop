# M12: Tauri (outline)

**Goal:** a desktop app built with Tauri gets native durability and native commands through Isoloop, with isolates unchanged ([ADR 0022](../adr/0022-tauri.md), *Proposed*, drafted 2026-11-18 and still to be grilled).

**Done when:** an example Tauri app runs the plant dashboard on Windows, macOS and Linux, with a persistent topic on `TauriStorage` that loses no acknowledged record across an app restart, and one native command reached by an isolate through `exposeCommands`. The spike's findings and the storage latency against `OpfsStorage` are written up, whatever they show.

**Depends on:**

- **[M11 Pure kernel core](m11-pure-kernel-core.md),** done before this milestone starts: a Tauri host is a second shell around the same kernel decisions.
- **[M5 Shared-memory engine](m5-shared-memory-engine.md),** in the same minor, `0.4.0` (the [releases table](README.md#releases)). `TauriStorage` reuses M5's Rust code for the segment format, and the spike reuses its cross-origin isolated test setup. That's reuse, not a block: if M5's engine doesn't ship, this milestone writes the segment code in Rust itself, on the M2b segment layout `OpfsStorage` already uses.
- With [M8 Watchers](m8-watchers.md) W3, also in `0.4.0`, Tauri apps get shared watch slots by default through the config helper. `kernel.respond` may land earlier (an open question for the ADR).
- **Reused later by [M16 Native runtimes](m16-native-runtimes.md),** whose isolates outside the webview reach the bus over this milestone's IPC, and whose example is this milestone's app. Nothing here waits on M16.

Grilled before it gets a task list, together with its ADR.

## Main work items

1. **Spike** (the ADR's decision 6): the suite and plant in a Tauri window on three OSes; a storage round trip from the bus worker without the main thread; the token; `crossOriginIsolated`.
2. **`kernel.respond`** in `@isoloop/host`, with conformance cases next to `kernel.request`'s.
3. **`isoloop-tauri` crate:** the plugin, the storage endpoint, segment files in the app's data folder.
4. **`@isoloop/tauri`:** `exposeCommands`, `TauriStorage` and the config helper, plus a storage conformance suite, lifted from `OpfsStorage`'s tests, that both storages pass.
5. **Example app** in `isoloop/web`: plant in Tauri, with a native command and a persistent topic.
6. **Guide page:** what each webview supports, as measured.
7. **CI:** a Tauri build and E2E run on Windows, macOS and Linux.

## Open risks

- Fetching a custom scheme from a worker may behave differently on each webview; the spike decides the transport.
- WebKitGTK on older distros may lack OPFS sync handles or OffscreenCanvas features.
- A Rust crate adds a second toolchain to CI and to releases.
