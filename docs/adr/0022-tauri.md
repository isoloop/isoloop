# ADR 0022: A Tauri package, built in M12

- **Status:** Proposed (2026-11-18), to grill when M12 is next to start (questions at the end). Drafted as 0021 and renumbered on 2026-11-24, since 0021 went to the source layout; moved from M5c to M12 Tauri, in `0.4.0`, the same day.
- **Date:** 2026-11-18
- **Plan:** [M12 Tauri](../plans/m12-tauri.md), in `0.4.0` beside [M5 Shared-memory engine](../plans/m5-shared-memory-engine.md) ([releases](../plans/roadmap.md#releases)).
- **Touches:** [ADR 0005](0005-bus-topology-message-channels.md) (no record crosses the main thread), [ADR 0007](0007-bus-worker-supervision.md) (durable topics), [ADR 0014](0014-own-codec.md) (the segment bytes), [ADR 0018](0018-tools-for-agents.md) (requestable topics), [ADR 0020](0020-inspection-feed.md) (memory per isolate), [ADR 0021](0021-source-layout-and-entry-points.md) (the new package's layout).

## Context

Isoloop already runs in a Tauri webview unchanged: a Tauri app is a web page in the system webview (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux). So the question isn't whether it runs. It's what a desktop app gets from a package that a browser tab can't have.

Desktop apps fit Isoloop's pitch closely. They host third-party extensions and long-lived dashboards, and a single frozen main thread freezes the whole app window.

What a Tauri app has that a tab doesn't:

- **A Rust process next to the page,** with the file system, the OS and native libraries.
- **Storage the app controls.** OPFS lives in the webview's profile: it has a quota, the user can clear it with web data, and native code can't read it.
- **Headers the app sets.** COOP and COEP can be set in `tauri.conf.json` (`app.security.headers`), so cross-origin isolation, and with it `SharedArrayBuffer` and M5's engine, costs a Tauri app nothing: its own assets are all it loads.

The forces:

- **`LogEngine` is synchronous.** `append` returns the offset and `read` returns records, in the bus worker. An engine in the Rust core over async IPC can't implement it. `LogStorage` can: it's async, pluggable (`EngineOptions.storage`) and already has two implementations. Both `LogStorage` and that option are `@internal`, so no app can pass a storage to the bus today.
- **Tauri's `invoke` needs `window`.** Workers can't call it, so neither an isolate nor the bus worker can reach a command directly.
- **The host can't answer a request.** `kernel.subscribe` and `kernel.request` exist, but there is no host-side responder for a requestable topic. A headless isolate can answer one, but it has no `window` either.
- **No record crosses the main thread** (ADR 0005), except for host consumers the app chose.
- **The webview engine differs per OS.** WebKitGTK's version depends on the distro. `measureUserAgentSpecificMemory()` exists only in Chromium, so only WebView2 gives memory per isolate (ADR 0020).
- **The isolate seam only grows** (ADR 0012), and new packages start `@experimental`.

## Decision

### 1. `@isoloop/tauri`, an `@experimental` package, built in M12

One npm package, plus one Rust crate (`isoloop-tauri`, a Tauri plugin), versioned with the rest under [ADR 0019](0019-versioning-and-releases.md). The package follows ADR 0021's layout. It ships in `0.4.0`, after [M11 Pure kernel core](../plans/m11-pure-kernel-core.md) (a Tauri host is a second shell around the kernel's decisions) and beside M5, so it can reuse M5's Rust code for the segment format (decision 4) and its cross-origin isolated test setup. That's reuse, not a block: if M5's engine doesn't ship, M12 writes the segment code in Rust itself, on the M2b segment layout.

Rules: `tauri.package`

### 2. `kernel.respond`: the host answers requestable topics

A new public, `@experimental` host API, the mirror of an isolate answering a request:

```ts
const off = kernel.respond(readFile, async (req, { signal }) => {
  return { text: await invoke<string>('read_file', { path: req.path }) };
});
```

- **Generic, not Tauri-specific.** Anything only the main thread can reach goes through it: a Tauri command, a Window-only API (the Chrome Prompt API in [ai-enablers](../investigations/ai-enablers.md), D3), the clipboard.
- **It reuses what requests already have:** the topic's input and `reply` schemas, grants on topic patterns, timeouts, `no_responder` (ADR 0018). It adds no grant and changes nothing in the isolate seam: isolates call `bus.request` as today.
- **Records for these topics cross the main thread.** That's a host consumer the app chose, as `kernel.subscribe` is, and only for the topics it responds to.

Rules: `tauri.kernel-respond`, `tauri.respond-crosses-main-thread`

### 3. Native commands as requestable topics

`@isoloop/tauri` gives `exposeCommands(kernel, { topic: command })`, which calls `kernel.respond` for each pair and `invoke`s the command. Two layers then guard every call: Isoloop's grant on the topic, then Tauri's capability on the command. A command not listed can't be reached through the bus.

Rules: `tauri.expose-commands`

### 4. `TauriStorage`: durable topics on the app's disk

A third `LogStorage`, `kind: 'native'`, next to `MemoryStorage` and `OpfsStorage`:

- **Same bytes as OPFS.** Segments hold `isoloop-codec@1` records in the M2b segment layout, so the engine above doesn't know the difference. `runEngineConformance` runs against an engine on it, and `OpfsStorage`'s own tests are lifted into a storage conformance suite that both pass.
- **The Rust side writes the files,** under the app's data folder, with the same group commit (5 ms / 256 records) and the same `flush` semantics, so a persistent publish is still acked only once it's on disk.
- **The Rust side can read the log.** A native backend can replay a topic without the webview running. Writing from Rust is out of scope (question 4).
- **The bus worker reaches it without the main thread.** Records must not cross it (ADR 0005), so the transport is decided by the spike (decision 6). The candidates are a custom URI scheme the plugin registers, fetched from the bus worker with a token the host passes only to the bus at start, or Tauri's own IPC endpoint fetched directly. A relay through the host is the fallback only if both fail, and it would need an amendment to ADR 0005.
- **Opt-in.** `OpfsStorage` keeps working in Tauri; an app picks `TauriStorage` in its kernel config.

Rules: `tauri.native-storage`, `tauri.native-group-commit`, `tauri.native-reads-log`, `tauri.storage-off-main-thread`, `tauri.storage-opt-in`

### 5. A config helper and a doc page

`@isoloop/tauri` ships the `tauri.conf.json` fragment for COOP/COEP and the CSP `connect-src` the storage needs. A guide page says what each OS's webview supports (OffscreenCanvas, OPFS sync handles, memory figures) as measured in the spike, not as assumed.

Rules: `tauri.config-helper`

### 6. A spike first, with exit criteria

M12 starts with a spike on all three desktop webviews:

1. Isoloop's test suite and the plant dashboard run unchanged in a Tauri window, with the failures listed per OS.
2. A bus worker writes a 256-record batch to the Rust side and gets it back, without the main thread, through at least one of decision 4's transports. Its latency against `OpfsStorage` is measured on the same machine.
3. The token keeps isolate workers from reaching the storage endpoint.
4. `crossOriginIsolated` is true with the config helper, and M5's engine starts if it has shipped.

If item 2 fails on any OS, `TauriStorage` is dropped and the package ships decisions 2, 3 and 5 only.

## Consequences

- **Desktop apps get native durability and native commands** with the isolate seam unchanged. Isolates written for the web run in Tauri as they are.
- **`kernel.respond` is useful beyond Tauri,** for every Window-only API, which [ai-enablers](../investigations/ai-enablers.md) already needed.
- **A Rust crate joins the release,** with its own CI (three OSes) and its own pins under [ADR 0009](0009-toolchain.md).
- **Memory per isolate stays Windows-only** in Tauri, since only WebView2 has the API.
- **WebKitGTK lags.** On older distros some features fail; the guide lists them, and Isoloop doesn't polyfill them.
- **New API, all `@experimental` and all additions:** `kernel.respond`, `@isoloop/tauri` (`exposeCommands`, `TauriStorage`, the config helper). None touches the isolate seam, so under ADR 0019 they can land in a patch, apart from the package's first release.

## Alternatives considered

- **No package, only a guide.** Isoloop already runs in Tauri. Rejected: native durability and commands are what a desktop app would want, and each app would build the bridge again.
- **The log engine in the Rust core.** Rejected: `LogEngine` is synchronous and sits in the bus worker. Making it async would change the broker's hot path for every app to suit one host.
- **A Tauri grant** (`tauri: ['read_file']`) checked by the host, with a new host call in the isolate seam. Rejected: requestable topics already give schemas, grants, timeouts and `no_responder`, and a new host call grows the seam for one platform.
- **Relaying storage writes through the host.** Rejected unless the spike leaves nothing else: every persistent record would cross the main thread twice, which ADR 0005 exists to prevent.
- **Building it before M5.** Not taken: the segment format in Rust and the cross-origin isolated setup both come with M5, in the same minor, and the 2026-11-24 order puts both in `0.4.0`.
- **Electron too.** Not now: Electron ships Chromium, so Isoloop runs there unchanged and in full. If anyone asks, the same `kernel.respond` approach covers its IPC.

## To grill

1. **Placement.** M12 in `0.4.0`, alongside M5, with its own segment code if M5's engine doesn't ship. Or after M5's verdict, in a later minor?
2. **Respond API.** 0.1 shipped without it. `kernel.respond` in an earlier minor, ahead of M12, since it's generic and cheap and outside the seam? Or with M12?
3. **Many windows.** One bus shared across a Tauri app's windows, with the Rust core as broker, is the feature a browser can't match. In this ADR, or deferred to [would-like](../would-like.md)?
4. **Rust writes.** Native code publishing to a topic, not only reading it. Deferred (it needs the broker's validation and offsets on the Rust side)?
5. **Mobile.** Tauri also targets iOS and Android. Out of M12, to [would-like](../would-like.md)?
6. **How `TauriStorage` reaches the bus worker.** `LogStorage` and `EngineOptions.storage` are `@internal`, so there's no public way to give the bus a storage. Make a storage seam public (new public API, under ADR 0019's rules), or let first-party packages such as `@isoloop/tauri` use an internal entry and keep the seam private?
