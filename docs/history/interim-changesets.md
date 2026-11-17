# Interim changesets, before 0.1.0-next.0

These are the working notes written with each change, one file per change in `.changeset/`, from the first milestone until Changesets was set up on 2026-11-17 ([`isoloop/web` ADR 0004](https://github.com/isoloop/web/blob/main/docs/adr/0004-publishing-and-governance.md)). They were replaced by one current-state entry per package before the first `0.1.0-next.0`, and are kept here unchanged, as history.

**Read them as a log, not as documentation:** some describe states that later work changed or removed. Each package's `CHANGELOG.md` describes it as it is, and its first section links here.

85 notes, oldest first. Each lists its packages and bump, the date it was added, and the commit and PR that added it.

## 2026-11-05

### m1-browser-check

`@isoloop/host: minor` · [`5692ea8`](https://github.com/isoloop/isoloop/commit/5692ea8), [#20](https://github.com/isoloop/isoloop/pull/20)

`createKernel` checks for module workers, `MessageChannel`, adopted stylesheets on a `ShadowRoot`, and OPFS. If any are missing it throws one `KernelError` with code `unsupported_browser`, naming everything that's missing.

### m1-compositor

`@isoloop/host: minor` · [`e967d90`](https://github.com/isoloop/isoloop/commit/e967d90), [#27](https://github.com/isoloop/isoloop/pull/27)

The compositor applies batches within a frame budget (`KernelConfig.compositor.frameBudgetMs`, default 8 ms). Isolates take turns one batch at a time, starting from a rotating isolate each frame, and the first batch of a frame always applies (I8). Batches are never split; leftovers roll to the next frame. `snapshot().surface` gains `dropped` (batches discarded by a restart) and `lastFrameMs`.

### m1-dom-package

`@isoloop/dom: minor`, `@isoloop/runtime: minor`, `@isoloop/host: minor` · [`187939b`](https://github.com/isoloop/isoloop/commit/187939b), [#29](https://github.com/isoloop/isoloop/pull/29)

New internal package `@isoloop/dom`, Isoloop's own render bridge (`isoloop-dom@1`, ADR 0010 and 0011). It has three entries: `/worker` (the DOM subset and its recorder), `/host` (the applier and node-id map) and `/testing` (the conformance suite).

`@isoloop/runtime` starts modules whose default export is `{ start(ctx) }`. They render into `ctx.root`, and when the isolate has a surface the DOM subset is installed as the worker's `document`. Function exports still run as legacy isolates.

`@isoloop/host` renders `isoloop-dom@1` through the component registry, with host-owned input rules. `HostRenderBridge` gains `idFor` and `nodeFor`. An isolate that reports a render format the host doesn't speak fails at once with reason `render-fmt-mismatch`, without a restart.

### m1-event-bridge

`@isoloop/host: minor` · [`cda7c8e`](https://github.com/isoloop/isoloop/commit/cda7c8e), [#30](https://github.com/isoloop/isoloop/pull/30)

EventBridge (design §4.6). Isoloop-dom surfaces forward the fixed set of event types, but only those an isolate registered a listener for. Pointer moves are coalesced to one per frame. `submit` is always prevented on the host, so a form in an isolate never navigates the page. A value or checked state the isolate sends never overwrites a focused input.

### m1-host-calls

`@isoloop/protocol: minor`, `@isoloop/host: minor`, `@isoloop/runtime: minor` · [`3dd9e91`](https://github.com/isoloop/isoloop/commit/3dd9e91), [#31](https://github.com/isoloop/isoloop/pull/31)

Host calls (design §4.7). `ctx.host.measure`, `focus` and `scrollIntoView` post a `call` and settle on the `result`, with a 5 s timeout. The isolate flushes its pending patches first, and the host runs the call through the compositor after them, so `measure` sees the new layout. It returns a `Rect` relative to the surface. `navigate` fails with `routing_disabled` until M2, and `requestCanvas` with the new code `unsupported` until M3. A node the host never rendered fails with the new code `not_found`.

### m1-loader-hardening

`@isoloop/host: minor`, `@isoloop/runtime: minor`, `@isoloop/protocol: minor` · [`d8432ce`](https://github.com/isoloop/isoloop/commit/d8432ce), [#18](https://github.com/isoloop/isoloop/pull/18)

Loader hardening. `kernel.stop` sends `shutdown` and terminates on the isolate's new `bye` message or after a 1 s grace period, and its promise settles once the worker is gone. `spawn` throws a `KernelError`: `pools_unsupported` for `manifest.pool`, `suspend_unsupported` for any `manifest.suspend` other than `'never'`, and `invalid_manifest`. Passing `workers.budget` (default 32) live workers warns once and emits `workers:budget`, but never blocks a spawn. A `new Worker` that throws crashes the isolate with reason `spawn-failed`. A failed cross-origin import names the URL and points to the CORS guide (`docs/guide/hosting.md`).

### m1-registry

`@isoloop/host: minor` · [`c44036f`](https://github.com/isoloop/isoloop/commit/c44036f), [#26](https://github.com/isoloop/isoloop/pull/26)

Component registry and sanitiser for rendering (invariant I9). Unknown tags render as `div` (`g` in SVG). `script`, `iframe`, `object`, `embed`, `style`, `on*` attributes and `srcdoc` are never created. URLs are limited to http(s), mailto and relative, and SVG `<use>` only to the same document. `KernelConfig.components` maps isolate tags to host elements, for example `{ 'iso-button': { tag: 'ds-button', attributes: ['variant'] } }`; a malformed entry makes `createKernel` throw `invalid_config`.

### m1-remove-legacy-vdom

`@isoloop/runtime: minor`, `@isoloop/host: minor`, `@isoloop/protocol: patch` · [`a84bb69`](https://github.com/isoloop/isoloop/commit/a84bb69), [#38](https://github.com/isoloop/isoloop/pull/38)

Removes `legacy-vdom@1` and the M0 isolate API.

`@isoloop/runtime` no longer exports `createLegacyIsolate`, `h`, `LEGACY_VDOM` or the `Legacy*` isolate types. A module whose default export is a function now fails with a fatal error; isolates export `{ start(ctx) }` (`defineIsolate`).

`@isoloop/host` accepts only `isoloop-dom@1` for an isolate with a surface. The M1 bus over the isolate port (`x-pub` / `x-sub`) stays until M2 replaces it.

### m1-styles

`@isoloop/protocol: minor`, `@isoloop/host: minor`, `@isoloop/runtime: minor` · [`2ef4f18`](https://github.com/isoloop/isoloop/commit/2ef4f18), [#32](https://github.com/isoloop/isoloop/pull/32)

Styles (design §4.8). `ctx.styles(css)` adds stylesheets to an isolate's surface. They travel with the next patch in `patch.styles` and are adopted into the shadow root as constructable stylesheets just before that patch applies. Isolate CSS stays inside its surface, and host design tokens reach in as CSS custom properties. A restart drops the isolate's sheets.

### m1-supervisor-machine

`@isoloop/host: minor` · [`829f857`](https://github.com/isoloop/isoloop/commit/829f857), [#12](https://github.com/isoloop/isoloop/pull/12)

Supervisor state machine with a restart limit and backoff (design §4.3). A crash restarts the isolate after `250 ms × 2ⁿ` (capped at 4 s); a fourth crash within 60 s leaves it `failed`. A blocked isolate is killed after `killAfterMs`, and an isolate that never sends `ready` after `readyTimeoutMs`. New `KernelConfig.supervisor` (`strategy`, `maxRestarts`, `withinMs`, `backoff`) and `heartbeat.killAfterMs` / `readyTimeoutMs`; `restartAfterMs` is gone. New events `isolate:ready` and `isolate:failed`; `isolate:crash` carries a `reason`.

### m1-supervisor-wiring

`@isoloop/host: minor` · [`8f0976c`](https://github.com/isoloop/isoloop/commit/8f0976c), [#15](https://github.com/isoloop/isoloop/pull/15)

Supervisor wiring. A blocked isolate's surface shows a busy overlay, and a failed one shows a fallback with a Retry button; `manifest.fallback` replaces the fallback with the host's own render function. Worker `messageerror` counts as a crash. Heartbeats are judged every 50 ms. Nothing is judged blocked or killed while the page is hidden, and every heartbeat clock restarts when it is shown again or resumes from frozen.

### m1-vanilla-api

`@isoloop/runtime: minor` · [`fc6b75f`](https://github.com/isoloop/isoloop/commit/fc6b75f), [#33](https://github.com/isoloop/isoloop/pull/33)

The vanilla isolate API. A module's default export `{ start(ctx) }` gets `id`, `config`, `root` (the surface, which `undefined` means headless), `host` (`measure`, `focus`, `scrollIntoView`), `styles`, `onShutdown`, `keepAwake` (a no-op until M2) and `bus`. Until M2's log bus, `bus` is the M0 main-thread bus. `defineIsolate<Root>(def)` types the export. `onShutdown` handlers run before the worker says `bye`.

### m2-bus-client

`@isoloop/protocol: minor`, `@isoloop/host: minor`, `@isoloop/runtime: minor` · [`27d50e0`](https://github.com/isoloop/isoloop/commit/27d50e0), [#45](https://github.com/isoloop/isoloop/pull/45)

The isolate `BusClient` (design §5). `ctx.bus` now talks to the bus worker on its own port: `publish` resolves on the broker's result or rejects with a `BusError`; `subscribe` runs handlers in order with `autoCommit` (at least once: a throwing handler stops commits, so its record is redelivered on the next start), `group` and `onReset`; `request` with a timeout; `reply`; and `commit` for manual commits. On `reattach` after a bus restart it resubscribes and re-sends every unanswered publish in order. `BusError` moves to `@isoloop/protocol` and is re-exported by host and runtime. M0's main-thread bus is now `ctx.legacyBus`, until M2 task 11 removes it.

### m2-bus-controller

`@isoloop/protocol: minor`, `@isoloop/bus: minor`, `@isoloop/host: minor` · [`1396dc3`](https://github.com/isoloop/isoloop/commit/1396dc3), [#44](https://github.com/isoloop/isoloop/pull/44)

The host bus controller (ADR 0005, ADR 0007). With `contracts: { url, list }` and `workers.bus`, the kernel starts the bus worker before any isolate, gives each isolate a `MessageChannel` attached to the bus, and adds `kernel.publish` (rejecting with a `BusError`) and `kernel.subscribe`. The bus is supervised like an isolate: a crash starts a new bus worker and sends every running isolate `reattach` with a new port, and each memory-topic subscription gets one `reset`. `bus: { onReset: 'restart' }` restarts an isolate instead. Contract errors are fatal: `bus:failed { code }`, every isolate fails and `spawn` throws `bus_failed`. Past the restart limit, `bus:failed { reason }` and every publish rejects with `bus_unavailable`. New events: `bus:ready`, `bus:crash`, `bus:restart`, `bus:failed`, `bus:metrics`. Protocol: `TopicRef`, `TypedRecord`, `ContractsList`, `topicConfigOf`, and `attach.reattach`.

### m2-bus-worker

`@isoloop/protocol: minor`, `@isoloop/bus: minor` · [`ce85fdc`](https://github.com/isoloop/isoloop/commit/ce85fdc), [#43](https://github.com/isoloop/isoloop/pull/43)

The bus worker (`bus-worker.js`, exported as `@isoloop/bus/worker`). `boot` imports the contracts module, checks it against the host's topic list and fails with `contracts_failed`, `contracts_invalid`, `contracts_mismatch` or `reserved_topic`. `attach` and `detach` wire isolate ports to the broker, and publishes sent while the contracts load are buffered and validated in order. The worker sends `beat`, 1 s `metrics` and `error`, answers host publishes with `result`, and runs `time` and `compacted` retention every second.

### m2-remove-legacy-bus

`@isoloop/protocol: minor`, `@isoloop/host: minor`, `@isoloop/runtime: minor` · [`1ce5def`](https://github.com/isoloop/isoloop/commit/1ce5def), [#47](https://github.com/isoloop/isoloop/pull/47)

The M0 main-thread bus is gone: the `x-pub` / `x-sub` / `x-deliver` envelopes, `ctx.legacyBus`, the `bus:publish` event and `BusDelivery`. Every record now travels on the bus worker's ports, never through the main thread (I7). `kernel.debug.messages()` (internal) counts what the main thread receives by type, for the I7 test.

### m2-replay

(no bump listed) · [`21c86f6`](https://github.com/isoloop/isoloop/commit/21c86f6), [#48](https://github.com/isoloop/isoloop/pull/48)

---
---

four-loops: D builds its log only from the bus and replays it after a crash; a headless store isolate S folds count.v1 and note.v1 into the compacted store.v1. E2E replay test (the M2 done-criterion).

### m2-route-topic

`@isoloop/protocol: minor`, `@isoloop/bus: minor`, `@isoloop/host: minor`, `@isoloop/runtime: minor` · [`2de24d9`](https://github.com/isoloop/isoloop/commit/2de24d9), [#46](https://github.com/isoloop/isoloop/pull/46)

Routing (ADR 0002). The kernel publishes the location to the built-in compacted `isoloop.route.v1` topic (`routeTopic` in `@isoloop/protocol`, value `{ href, pathname, path, search, hash, state }`): on start, on `popstate` / `hashchange`, on `kernel.syncRoute()`, after an accepted navigation and after a bus restart, skipping unchanged `href` and `state`. `KernelConfig.routing` (default true), `basePath` (default `/`) and `onNavigate` (default `history.pushState` / `replaceState`). `ctx.host.navigate(href, { replace, state })` needs `grants.navigate` (checked in the runtime and the kernel), resolves `/x` against `basePath`, rejects with `cross_origin`, `forbidden`, `routing_disabled` or `navigate_failed`, and resolves only after the route record is in the log. Same-origin link `href`s render as their resolved URL, and plain primary-button clicks on them go to `onNavigate` without a grant. Too-large `history.state` is published as `null` with `route:state_dropped`; a throwing `onNavigate` emits `route:navigate_error`.

### m2-suspension

`@isoloop/protocol: minor`, `@isoloop/bus: minor`, `@isoloop/host: minor`, `@isoloop/runtime: minor` · [`80190f9`](https://github.com/isoloop/isoloop/commit/80190f9), [#49](https://github.com/isoloop/isoloop/pull/49)

Opt-in suspension (ADR 0001). `manifest.suspend: 'when-idle' | { whenIdle: { afterMs } }` (default `'never'`) lets the kernel shut down an idle isolate's worker: no visible surface, nothing delivered for `afterMs`, no `ctx.keepAwake()` hold and nothing in flight. The surface keeps an inert snapshot of its last frame. Visual isolates wake when shown, headless ones on a record for a subscribed topic (the bus sends `wake`), and both on `kernel.resume(id)`; a wake queue starts at most `suspend.maxConcurrentWakes` (default 4) at once, visible surfaces first in on-screen order. A woken isolate's `latest` subscriptions resume from `committed`, and `onGap` reports records retention dropped meanwhile. A suspended group member leaves its group. New state `suspended`, which never counts towards the restart limit; `ctx.keepAwake()` returns a release function; beats carry an idle report; `suspend_unsupported` is gone.

### m2-throughput-bench

(no bump listed) · [`9b2be79`](https://github.com/isoloop/isoloop/commit/9b2be79), [#50](https://github.com/isoloop/isoloop/pull/50)

---
---

`pnpm bench:throughput`: the bus throughput bench (one publisher, 10 subscriber workers, 200-byte records), report only, run in CI's bench job.

## 2026-11-07

### m2b-codec-core

`@isoloop/codec: minor` · [`c24b30d`](https://github.com/isoloop/isoloop/commit/c24b30d), [#74](https://github.com/isoloop/isoloop/pull/74)

New package: the binary codec for topic records (`isoloop-codec@1`). Objects, arrays, strings, numbers, booleans, `null` and `undefined`; functions, symbols, class instances and cycles throw `not_encodable`.

### m2b-codec-types

`@isoloop/codec: minor`, `@isoloop/bus: minor` · [`cfc5e82`](https://github.com/isoloop/isoloop/commit/cfc5e82), [#84](https://github.com/isoloop/isoloop/pull/84)

The codec covers the rest of the structured-clone types topics allow: `bigint`, `Date`, `Map`, `Set`, `ArrayBuffer`, typed arrays and `DataView`. The broker rejects a publish to a persistent topic whose value the codec can't encode with `not_encodable`; memory topics are unchanged.

### m2b-compaction-disk

`@isoloop/bus: minor` · [`824b49d`](https://github.com/isoloop/isoloop/commit/824b49d), [#104](https://github.com/isoloop/isoloop/pull/104)

Compacted persistent topics are compacted on disk too: once half of a topic's records on disk are superseded, the bus rewrites its older segments in the background, one segment between commits, keeping only the latest record per key. A crash at any point of the rewrite leaves either the old segments or the new ones.

### m2b-dedupe-resends

`@isoloop/bus: minor`, `@isoloop/host: minor`, `@isoloop/protocol: minor`, `@isoloop/runtime: minor` · [`66b0115`](https://github.com/isoloop/isoloop/commit/66b0115), [#116](https://github.com/isoloop/isoloop/pull/116)

Re-sent publishes are deduplicated on persistent topics (M2b task 20, ADR 0007 steps 5 and 6). Every publish and request from an isolate's `BusClient` or `kernel.publish` carries `(epoch, seq)`: the publisher's instance and a counter. The frame on disk stores it, the bus rebuilds the last 1,000 per producer and topic when it loads, and a re-send it already holds is answered with the original offset instead of appended again; a re-sent request gets the reply to the original record. Memory topics are unchanged. `kernel.publish` calls the bus never answered before a crash are now sent again to the new bus instead of rejecting with `bus_unavailable`.

### m2b-eviction

`@isoloop/bus: minor` · [`ce15a9a`](https://github.com/isoloop/isoloop/commit/ce15a9a), [#105](https://github.com/isoloop/isoloop/pull/105)

Persistent topics keep only their recent records in memory, about 8 MiB each (`residentBytes`). Older ones are evicted, and a subscriber that starts from an evicted offset gets them read back from disk, segment by segment, in order. `LogEngine` gains `readable` and `page` for this.

### m2b-flush-on-freeze

`@isoloop/protocol: minor`, `@isoloop/bus: minor`, `@isoloop/host: minor` · [`201a39d`](https://github.com/isoloop/isoloop/commit/201a39d), [#112](https://github.com/isoloop/isoloop/pull/112)

Flush on freeze: when the page freezes or goes away (`freeze`, `pagehide`), the kernel sends the bus a `flush` control message and persistent topics are written at once instead of at the next group commit (M2b task 16).

### m2b-follow-orphans

`@isoloop/bus: minor`, `@isoloop/host: minor`, `@isoloop/protocol: minor` · [`1b800c0`](https://github.com/isoloop/isoloop/commit/1b800c0), [#115](https://github.com/isoloop/isoloop/pull/115)

`follow`, orphaned topics and `kernel.dropTopic` (M2b task 19, ADR 0003 decisions 18–19). With `seed.follow`, new records on the source go on to the seeded topic after its seed, through `map` and its schema. A seed may read a topic the contracts no longer list; the bus keeps it for the seed but doesn't open it to isolates. At boot, persistent topics on disk that the contracts no longer list are kept and reported as `bus:orphaned_topics { names, bytes }`. `kernel.dropTopic(name, { force })` deletes one; it rejects with `seed_pending` while a declared seed that reads it hasn't ended, and with `invalid` for a listed topic or one with rejected seed records unless `force` is set.

### m2b-no-sync-access

`@isoloop/bus: minor` · [`b077253`](https://github.com/isoloop/isoloop/commit/b077253), [#110](https://github.com/isoloop/isoloop/pull/110)

Without OPFS sync access handles, persistent topics behave as memory topics: the bus reports `ready.storage: 'memory'` and the kernel emits `bus:durability-degraded { reason: 'no-sync-access' }` (ADR 0007, decision 6).

### m2b-opfs-offsets

`@isoloop/bus: minor` · [`6de3f6c`](https://github.com/isoloop/isoloop/commit/6de3f6c), [#92](https://github.com/isoloop/isoloop/pull/92)

`OpfsStorage` keeps the committed offsets of persistent topics, written with the same group commit after the records, into two slot files in turn, so a write killed halfway leaves the previous offsets. `open()` restores them.

### m2b-opfs-segments

`@isoloop/bus: minor` · [`edb3127`](https://github.com/isoloop/isoloop/commit/edb3127), [#89](https://github.com/isoloop/isoloop/pull/89)

`OpfsStorage`: persistent topics in the Origin Private File System, one directory per topic, 4 MiB segment files of length-prefixed frames with a CRC-32 each, written through sync access handles with a group commit every 5 ms or 256 records. The engine writes persistent topics through its storage, and the broker acknowledges a persistent publish only once its batch is on disk.

### m2b-quota

`@isoloop/bus: minor`, `@isoloop/host: minor`, `@isoloop/protocol: minor` · [`e4a8eaf`](https://github.com/isoloop/isoloop/commit/e4a8eaf), [#108](https://github.com/isoloop/isoloop/pull/108)

Quota: bus metrics carry the origin's storage use while the bus keeps files, and the kernel emits `bus:quota { usage, quota }` once it reaches 80 %. When storage is full, or a write fails with `QuotaExceededError`, persistent publishes reject with the new error code `quota_exceeded`, and memory topics carry on.

### m2b-reattach-committed

`@isoloop/bus: patch` · [`744f77a`](https://github.com/isoloop/isoloop/commit/744f77a), [#118](https://github.com/isoloop/isoloop/pull/118)

After a bus restart, a reattached subscription to a persistent topic resumes after the offset it committed on the old bus, as ADR 0007 step 3 says, instead of starting at its `from` again. A `from: 'earliest'` subscriber no longer sees the records it already handled a second time. With no commit, it still starts at its `from`.

### m2b-recovery

`@isoloop/bus: minor` · [`9e7919e`](https://github.com/isoloop/isoloop/commit/9e7919e), [#94](https://github.com/isoloop/isoloop/pull/94)

Recovery: `OpfsStorage.open()` truncates a torn tail off each topic's newest segment and skips a corrupt frame inside a segment, keeping every intact record after it; `TsEngine.restore` rebuilds persistent topics and their committed offsets from disk, and the bus worker reports them in `ready.restored`.

### m2b-retention-disk

`@isoloop/bus: minor` · [`c792209`](https://github.com/isoloop/isoloop/commit/c792209), [#100](https://github.com/isoloop/isoloop/pull/100)

Retention on disk: `last-n` and `time` topics delete whole segments once every record in them is out of retention (`LogStorage.dropBelow`, applied after the commit that writes them). `flush()` also waits for a commit still writing.

### m2b-safe-mode

`@isoloop/bus: minor`, `@isoloop/host: minor`, `@isoloop/protocol: minor` · [`02bf4c8`](https://github.com/isoloop/isoloop/commit/02bf4c8), [#106](https://github.com/isoloop/isoloop/pull/106)

Safe mode (ADR 0007, decision 5): when the bus crashes twice in a row while loading, or within 2 s of `ready`, the next bus worker sets each persistent topic's newest segment aside and starts from the one before it. The kernel emits `bus:recovered { quarantined }`. Quarantined segments are kept on disk (`<segment>.to-<next>.quarantined`), and their offsets are never handed out again. A stored record the restore can't read now crashes the bus, so safe mode can recover from it; before, the bus fell back to memory.

### m2b-seed-progress

`@isoloop/bus: minor`, `@isoloop/host: minor`, `@isoloop/protocol: minor` · [`65fca54`](https://github.com/isoloop/isoloop/commit/65fca54), [#114](https://github.com/isoloop/isoloop/pull/114)

Seeding, exactly once: seed progress is saved with every batch, after the batch's records, so a seed cut short resumes without copying a record twice. A source record that `map` throws on, returns a promise for (`seed_async`), or the topic's schema rejects is skipped, recorded and reported as `bus:seed_rejected` (at most 10 a second per topic); the kernel emits `bus:seeded { topic, copied, rejected }` when the seed ends. A seed that ended doesn't run again (M2b task 18).

### m2b-seed-state

`@isoloop/bus: minor`, `@isoloop/protocol: minor` · [`3aed343`](https://github.com/isoloop/isoloop/commit/3aed343), [#113](https://github.com/isoloop/isoloop/pull/113)

Seeding: `topic(name, { seed: { from, map, follow } })` starts a topic from an older one (ADR 0003, decision 18). When the topic is empty and its source has records, the bus that holds the files copies them through `map` and the topic's schema, keeping `ts` and `producer`. Until the seed ends, the topic's publishes wait and its subscribes are answered late; other topics don't wait. `contracts()` rejects a seed from an unlisted topic and seed cycles (M2b task 17).

### m2b-tab-lock

`@isoloop/bus: minor`, `@isoloop/host: minor`, `@isoloop/protocol: minor` · [`1bb5f42`](https://github.com/isoloop/isoloop/commit/1bb5f42), [#107](https://github.com/isoloop/isoloop/pull/107)

One tab owns the OPFS files: the bus worker takes the Web Lock `isoloop-bus`. A bus in another tab runs every topic in memory, and the kernel emits `bus:durability-degraded { reason: 'another-tab' }`. The same event, with `open-failed`, now replaces the console-only warning when the files can't be opened or read back. A bus restarting in the owning tab waits up to 2 s for the lock.

### m2b-wire-opfs

`@isoloop/bus: minor` · [`391fea4`](https://github.com/isoloop/isoloop/commit/391fea4), [#98](https://github.com/isoloop/isoloop/pull/98)

The bus worker keeps persistent topics in OPFS where sync access handles exist (`ready.storage: 'opfs'`), restores them on boot and after a crash, and falls back to memory if the files can't be opened. After a bus restart, a subscription to a persistent topic resumes from its committed offset with no `reset`. The one-time "behaves as memory" console warning is gone.

### m3a-adapter-conformance

(no bump listed) · [`31b51bf`](https://github.com/isoloop/isoloop/commit/31b51bf), [#95](https://github.com/isoloop/isoloop/pull/95)

---
---

The adapter conformance E2E suite: a Preact and a React fixture app, built once per supported major, rendering, handling events and host-owned inputs, replaying after a crash and following a route change, in Chromium, Firefox and WebKit. The subset's `createTextNode` now converts its data to a string, as the DOM does (Preact passes numbers).

### m3a-adapter-packages

(no bump listed) · [`446cbe4`](https://github.com/isoloop/isoloop/commit/446cbe4), [#73](https://github.com/isoloop/isoloop/pull/73)

---
---

`@isoloop/preact` and `@isoloop/react`: empty adapter packages, with peers `preact: ^10 || ^11` and `react`/`react-dom: ^18 || ^19`. Their tests run once per framework major.

### m3a-demo

(no bump listed) · [`76ac180`](https://github.com/isoloop/isoloop/commit/76ac180), [#103](https://github.com/isoloop/isoloop/pull/103)

---
---

Four-loops gains P (Preact) and R (React), side by side on one topic and both crashable; the M3a write-up is in docs/posts.

### m3a-dom-group1-members

(no bump listed) · [`f0f551b`](https://github.com/isoloop/isoloop/commit/f0f551b), [#79](https://github.com/isoloop/isoloop/pull/79)

---
---

DOM group 1 in the worker subset: `classList`, `dataset` and `id` on elements (written as `class`, `data-*` and `id` attributes) and `document.getElementById`. `contains` was already there; the conformance suite now covers all four.

### m3a-dom-usage

(no bump listed) · [`33c3fe5`](https://github.com/isoloop/isoloop/commit/33c3fe5), [#75](https://github.com/isoloop/isoloop/pull/75)

---
---

DOM usage logs per framework major (`packages/dom/usage`, `pnpm dom:usage`), checked in CI. What they asked for is now in the subset: `select.options` and `multiple`, `option.value`, `defaultSelected` and `disabled`, a detached `document.head` and `document.ownerDocument`, and `document.querySelector` for type selectors (React 19's `head > title`).

### m3a-force-value

(no bump listed) · [`3f4a661`](https://github.com/isoloop/isoloop/commit/3f4a661), [#85](https://github.com/isoloop/isoloop/pull/85)

---
---

`ctx.setValue(node, value, { force: true })`: an isolate can set a host-owned input's value while the user is focused on it (the caret goes to the end). `isoloop-dom@1`'s `prop` record takes an optional `force` flag, amended in place (ADR 0010). Four-loops' D clears its note box this way instead of moving focus first.

### m3a-fragments-comments

(no bump listed) · [`f0d53fe`](https://github.com/isoloop/isoloop/commit/f0d53fe), [#81](https://github.com/isoloop/isoloop/pull/81)

---
---

DOM group 1: `DocumentFragment` (inserting one inserts its children in order and empties it) and comment nodes, a new `comment` kind in the `insert` subtree of `isoloop-dom@1`, amended in place (ADR 0010).

### m3a-framework-smoke

(no bump listed) · [`180d842`](https://github.com/isoloop/isoloop/commit/180d842), [#78](https://github.com/isoloop/isoloop/pull/78)

---
---

Preact and React render the same DOM in a worker as on the page, checked per major. The subset gains the DOM's event handler properties (`onclick`…), which Preact 10 and React check to learn event names. An element put into the worker's `document.head` (React 19's `<title>`) isn't rendered; the patch reports it, and the kernel warns once in `dev`.

### m3a-memory-bench

(no bump listed) · [`8ab5c98`](https://github.com/isoloop/isoloop/commit/8ab5c98), [#101](https://github.com/isoloop/isoloop/pull/101)

---
---

`pnpm bench:memory`: memory per idle isolate, vanilla, Preact and React, 10 of each, against the design's targets, in CI's bench job (report only).

### m3a-preact-hooks

(no bump listed) · [`547ff90`](https://github.com/isoloop/isoloop/commit/547ff90), [#87](https://github.com/isoloop/isoloop/pull/87)

---
---

`@isoloop/preact`: `useRequest(topic)` for request/reply, `useHost()` for host calls on elements from refs, and `useRoute()`, which subscribes to the route topic only where it's used.

### m3a-preact-render

(no bump listed) · [`6689fde`](https://github.com/isoloop/isoloop/commit/6689fde), [#86](https://github.com/isoloop/isoloop/pull/86)

---
---

`@isoloop/preact`: `defineIsolate(Component)` renders into the isolate's surface under the isolate context and unmounts on shutdown; `useTopic(topic, { from })` keeps a topic's latest value (cleared on reset) and `usePublish(topic)` publishes. `@isoloop/runtime/testing` adds `createTestContext()`, an isolate context without a worker for testing components.

### m3a-react-hooks

(no bump listed) · [`8d51a2c`](https://github.com/isoloop/isoloop/commit/8d51a2c), [#90](https://github.com/isoloop/isoloop/pull/90)

---
---

`@isoloop/react`: `useRequest(topic)`, `useHost()` and `useRoute()`, as in `@isoloop/preact`.

### m3a-react-render

(no bump listed) · [`e1abfff`](https://github.com/isoloop/isoloop/commit/e1abfff), [#88](https://github.com/isoloop/isoloop/pull/88)

---
---

`@isoloop/react`: `defineIsolate(Component)` renders with `createRoot` under the isolate context and unmounts on shutdown; `useTopic` reads a topic through `useSyncExternalStore` (StrictMode leaves one subscription) and `usePublish` publishes. The bootstrap now installs the DOM subset before it imports the isolate module, since React checks for a DOM when it loads.

### m3a-request-canvas

(no bump listed) · [`81a6fc8`](https://github.com/isoloop/isoloop/commit/81a6fc8), [#96](https://github.com/isoloop/isoloop/pull/96)

---
---

`ctx.host.requestCanvas(node, size?)`: the host hands the `<canvas>` it rendered for the node to the isolate as an `OffscreenCanvas` (once per canvas; headless isolates get `no_surface`), and `resize` events with its CSS size follow. `<canvas>` with `width` and `height` joins the component registry.

### m3a-requires-stamp

(no bump listed) · [`becbe02`](https://github.com/isoloop/isoloop/commit/becbe02), [#91](https://github.com/isoloop/isoloop/pull/91)

---
---

`defineIsolate` (runtime, Preact and React) stamps the definition with `requires`, the Isoloop `major.minor` it was built against, and the bootstrap reports it in `ready` (ADR 0012). `@isoloop/protocol` adds `majorMinor` and `compareVersions`.

### m3a-version-check

(no bump listed) · [`6cfe501`](https://github.com/isoloop/isoloop/commit/6cfe501), [#93](https://github.com/isoloop/isoloop/pull/93)

---
---

The kernel checks an isolate's `requires` stamp against `[FLOOR, VERSION]` (ADR 0012): newer than this host fails with `runtime-too-old`, older than the floor with `isolate-too-old`, both final; unstamped isolates aren't checked. `createDeprecations(dev)` warns once per deprecated member in `dev`.

### m3a-vite-build

(no bump listed) · [`66c569a`](https://github.com/isoloop/isoloop/commit/66c569a), [#99](https://github.com/isoloop/isoloop/pull/99)

---
---

`@isoloop/vite` builds isolates: `?isolate` imports give an isolate module's URL (emitted as its own chunk, exports kept), `isoloop({ isolates })` builds the listed ones, maps them in `virtual:isoloop/isolates` and writes `isoloop-manifest.json`, and `library: true` builds only the isolates, for a repository that ships them to another host.

### m3a-vite-dev

(no bump listed) · [`a9623bb`](https://github.com/isoloop/isoloop/commit/a9623bb), [#97](https://github.com/isoloop/isoloop/pull/97)

---
---

`@isoloop/vite`: `isoloop()` provides `virtual:isoloop/workers` (the bootstrap's and the bus worker's URLs for `KernelConfig.workers`) and sends the hosting guide's Content-Security-Policy, plus COOP/COEP when asked for, on dev and preview responses. Four-loops uses it.

### m3b-controlled-checkbox

`@isoloop/dom: patch` · [`4da23df`](https://github.com/isoloop/isoloop/commit/4da23df), [#127](https://github.com/isoloop/isoloop/pull/127)

A controlled checkbox whose state arrives after the click (from a topic) is drawn with that state. One click fires `click`, `input` and `change` with the same `checked`; only the first now reports it to the worker, so the later ones can't overwrite what React restored in between.

## 2026-11-08

### m2c-pool-bootstrap

`@isoloop/protocol: minor`, `@isoloop/runtime: minor` · [`e5cef96`](https://github.com/isoloop/isoloop/commit/e5cef96), [#138](https://github.com/isoloop/isoloop/pull/138)

Pool bootstrap (M2c): the isolate bootstrap can host several headless isolates in one worker. An `init` that names its isolate in the new optional envelope field `isolate` makes the worker a pool; every message to or from a member names it, each member gets its own context and bus port, the beat is the worker's, and the worker closes after its last member says `bye`. An `init` without `isolate` behaves exactly as before. The host doesn't place isolates in pools yet.

## 2026-11-09

### m2c-frozen-builtins

`@isoloop/runtime: minor` · [`9da770c`](https://github.com/isoloop/isoloop/commit/9da770c), [#145](https://github.com/isoloop/isoloop/pull/145)

A pool worker freezes the built-ins before its first member loads (M2c, decision 6): the prototypes and constructors of the standard built-ins, the iterator and generator prototypes, `Math`, `JSON` and `Reflect`. A member that patches one (`Array.prototype.x = …`) gets a TypeError instead of changing it for its neighbours. As in Hardened JS, inherited data properties become accessors first, so overriding them on an instance (`this.name = 'MyError'`) still works; `Error`'s statics (`stackTraceLimit`) stay writable. Own workers are untouched. With every isolate worker frozen this way, the runtime, React 18/19, Preact 10/11 and host suites and the E2E suite on Chromium, Firefox and WebKit passed.

### m2c-pool-snapshot

`@isoloop/host: minor` · [`c07ad75`](https://github.com/isoloop/isoloop/commit/c07ad75), [#143](https://github.com/isoloop/isoloop/pull/143)

Pools in the kernel's reports (M2c): `kernel.isolates()` gives each pool member's `pool`, and the new `kernel.pools()` lists every named pool with its members (not stopped), whether its worker runs, and its effective grants: the union of its members' grants, since members share a worker and can reach each other's bus ports (ADR 0001).

### m2c-pool-supervision

`@isoloop/host: minor` · [`26424b0`](https://github.com/isoloop/isoloop/commit/26424b0), [#140](https://github.com/isoloop/isoloop/pull/140)

Pool members share fate (M2c, ADR 0001). When a pool member stops responding or its worker errors, every member on that worker crashes with it (each with its own `isolate:crash`, now carrying `pool`), the worker is terminated, and they restart together in a new one, each replaying from its committed offsets. A member's own fatal error, ready timeout or version mismatch stays that member's: the rest of the pool keeps running.

### m2c-pool-suspension

`@isoloop/protocol: minor`, `@isoloop/runtime: minor`, `@isoloop/host: minor` · [`4aae3a5`](https://github.com/isoloop/isoloop/commit/4aae3a5), [#144](https://github.com/isoloop/isoloop/pull/144)

Pool suspension (M2c, ADR 0001): a pool's beat carries each member's idle report (`beat.p.members`), and a pool suspends only as a whole, when every member that isn't stopped or failed is idle under its own `suspend` setting; the worker goes with it. Any member's wake condition (a record, `kernel.resume`) wakes the whole pool. Registering a pool member that asks for `suspend` alongside one that never suspends warns once that the setting has no effect.

### m2c-pools-host

`@isoloop/host: minor`, `@isoloop/runtime: patch` · [`a6b79a3`](https://github.com/isoloop/isoloop/commit/a6b79a3), [#139](https://github.com/isoloop/isoloop/pull/139)

Worker pools for headless isolates (M2c): a manifest with `pool` joins a shared worker with every other isolate naming the same pool. The pool's worker starts with its first member and is terminated after its last; a pool counts as one worker against `workers.budget`. A visual isolate with `pool` is rejected with the new `pools_headless_only` code, which replaces `pools_unsupported`. Supervision of a pool as a group arrives next; until then each member is supervised on the pool's heartbeat.

### m2d-adapter-boundary-portal

`@isoloop/runtime: minor`, `@isoloop/react: minor`, `@isoloop/preact: minor` · [`ef4dbba`](https://github.com/isoloop/isoloop/commit/ef4dbba), [#153](https://github.com/isoloop/isoloop/pull/153)

Per-isolate error boundary and portal root (ADR 0015). The isolate context gains `reportError(error, { fatal })`, which reports an error as the isolate's own, and `portalRoot`, a container inside the surface for modals, tooltips, toasts and menus. The React and Preact adapters wrap each isolate's root in a boundary that reports render errors through `reportError`, so in a pool a render error crashes only that member, and add `usePortalRoot()`. Under a runtime without `reportError`, the boundary rethrows as before. `createTestContext()` records reported errors in `errors`.

### m2d-pool-warning

`@isoloop/host: minor` · [`f57e259`](https://github.com/isoloop/isoloop/commit/f57e259), [#157](https://github.com/isoloop/isoloop/pull/157)

`kernel.pools()` reports `sharesDocument` for each pool, and a `warning` ("Members of this pool can read each other's DOM and input.") when a member has a surface (ADR 0015), for devtools to show.

### m2d-root-per-member

`@isoloop/dom: minor`, `@isoloop/runtime: minor` · [`e250b77`](https://github.com/isoloop/isoloop/commit/e250b77), [#152](https://github.com/isoloop/isoloop/pull/152)

A pool's visual members render into their own roots in one shared document (ADR 0015). `@isoloop/dom/worker` adds `addRoot()`: each root sends its own batches and knows itself as `ROOT_ID` to its surface, and a node can't move from one member's root to another's. The runtime gives each visual pool member such a root. `@isoloop/dom/testing` adds `servePoolFixture()` and `mountMembers()` for pooled fixtures.

### m2d-visual-pools-host

`@isoloop/host: minor` · [`721ad61`](https://github.com/isoloop/isoloop/commit/721ad61), [#154](https://github.com/isoloop/isoloop/pull/154)

Visual isolates can join a pool (ADR 0015): `spawn` accepts `pool` on an isolate with a surface, and a pool may mix headless and visual members. Each visual member renders into its own surface; a hang or a worker error restarts the whole pool, which redraws each member's surface. The `pools_headless_only` error is gone. Members of a pool share one document and can read each other's DOM and input, so pool only trusted isolates and keep widgets that handle secrets on their own worker.

### webkit-entry-once

`@isoloop/runtime: patch`, `@isoloop/vite: patch` · [`62ef495`](https://github.com/isoloop/isoloop/commit/62ef495), [#159](https://github.com/isoloop/isoloop/pull/159)

The isolate worker's bootstrap runs once per worker. WebKit evaluates a module worker's entry a second time when one of its modules imports it by URL, and the second copy booted restarted pool members twice and closed the pool worker when its copy left, which restarted the whole pool. The bootstrap now starts under a once-per-worker marker (`Symbol.for('isoloop.bootstrap')`), and a second copy stays inert (with a warning in Vite dev). `@isoloop/vite` loads the new `@isoloop/runtime/worker` entry, a tiny module that holds the host's messages, loads the bootstrap and replays them, so no other chunk imports the worker's entry.

## 2026-11-10

### bus-expire-slots

`@isoloop/bus: patch` · [`61245db`](https://github.com/isoloop/isoloop/commit/61245db), [#163](https://github.com/isoloop/isoloop/pull/163)

Time and last-n retention let go of expired records right away. The memory engine used to free records only a whole 4,096-record chunk at a time, so a slow topic kept expired records referenced until the chunk holding its tail filled. In the plant dashboard that meant 30 s of spectra held for up to about 17 minutes, and the bus worker grew by about 52 MB in 10 minutes (`docs/investigations/plant-memory.md`).

## 2026-11-11

### bus-combined-commits

`@isoloop/protocol: minor`, `@isoloop/bus: minor`, `@isoloop/runtime: minor`, `@isoloop/host: minor` · [`d028bc1`](https://github.com/isoloop/isoloop/commit/d028bc1), [#166](https://github.com/isoloop/isoloop/pull/166)

Subscribers commit together (ADR 0016, decision 1). The `commit` message is replaced by `commits { offsets: { topic, offset }[] }`. The isolate's bus client and the host's own subscriptions send one per port per commit interval, instead of one per record. They send early at half a subscription's credit, before an unsubscribe, and first on a new port after a bus restart. On shutdown, for every reason, the client sends what's pending and waits for the broker before `bye`.

`KernelConfig.bus.commitIntervalMs` sets the interval: an integer from 0 to 1,000 (0 sends at the end of every task), default 100; anything else throws `invalid_config`. The cost: a worker killed without a graceful shutdown can have up to one interval of handled records delivered again.

### runtime-sync-handlers

`@isoloop/runtime: patch` · [`0601d70`](https://github.com/isoloop/isoloop/commit/0601d70), [#169](https://github.com/isoloop/isoloop/pull/169)

A synchronous subscription handler no longer yields a microtask per record: the bus client awaits a handler's result only when it is a promise. Async handlers are unchanged; a synchronous throw still stops the commits at the record before it.

## 2026-11-12

### runtime-protected-properties

`@isoloop/runtime: patch` · [`b8ffdcf`](https://github.com/isoloop/isoloop/commit/b8ffdcf), [#173](https://github.com/isoloop/isoloop/pull/173)

A pool's frozen built-ins no longer turn the properties V8 protects into accessors. These are the iteration protocol (`Symbol.iterator` on arrays, typed arrays, maps, sets and `%IteratorPrototype%`, and the iterators' `next`), `constructor` on arrays, typed arrays and promises, `Promise.prototype.then`, and all of `RegExp.prototype` and `String.prototype`. They stay plain frozen data, so V8 keeps its fast paths in pools. In a worker benchmark, `map` and `slice` were 23× slower with the old freeze, destructuring 3.6× and regexps 3.2×, and all of them are now within 2% of a plain worker (`bench/freeze`). Every other inherited property can still be overridden on an instance. Overriding one of the protected ones on an instance now throws in strict code (ADR 0001).

## 2026-11-16

### balancer-dispose-release

`@isoloop/balancer: patch` · [`d2c24a7`](https://github.com/isoloop/isoloop/commit/d2c24a7), [#208](https://github.com/isoloop/isoloop/pull/208)

`dispose()` gives back the kernel's claim (ADR 0017): another `createBalancer` on the same kernel now succeeds after it, as a kernel has one balancer at a time rather than one for its whole life. A disposed balancer's `spawn` throws, and the isolates it placed keep running where they are.

### balancer-stop-during-move

`@isoloop/balancer: patch` · [`79000c6`](https://github.com/isoloop/isoloop/commit/79000c6), [#209](https://github.com/isoloop/isoloop/pull/209)

`stop(id)` during a move no longer throws "No isolate": it cancels the move, respawns nothing and resolves once the old copy has stopped.

### claim-pools-release

`@isoloop/host: patch` · [`d2c24a7`](https://github.com/isoloop/isoloop/commit/d2c24a7), [#208](https://github.com/isoloop/isoloop/pull/208)

`claimPools` now returns `release()` as well (`@internal`, ADR 0017). Releasing gives the kernel's claim back: the released claim's `spawn` throws `reserved_pool`, isolates already in `balancer-` pools keep running, and the kernel can be claimed again. A kernel still has one claim at a time; a second claim throws `balancer_exists` while the first is held.

### m3h-balancer-beats

`@isoloop/balancer: minor` · [`33271f9`](https://github.com/isoloop/isoloop/commit/33271f9), [#202](https://github.com/isoloop/isoloop/pull/202)

The balancer reads every heartbeat through the kernel's `isolate:beat` event instead of polling `isolates()` every 100 ms, which kept only each worker's latest beat and so missed most spikes (ADR 0017, amended). `maxWorkers` now counts only the balancer's own pools: `balancer-N`, plus any quarantine worker beyond the first. `balancer-quarantine-1` is allowed on top, and workers the app runs itself no longer count. `KernelLike` takes `on('isolate:beat')` in place of `isolates()`, and `IsolateLike` gives way to `BeatLike`.

### m3h-balancer-full-pool

`@isoloop/balancer: minor` · [`ec96353`](https://github.com/isoloop/isoloop/commit/ec96353), [#203](https://github.com/isoloop/isoloop/pull/203)

The balancer gets a full-pool trigger: when a pool's members' busy time adds up to 80 % of a core or more over the 3 s window, its heaviest member moves, even if the pool's lag stays low. Isolates whose work yields often keep the lag low while starving each other, so neither the spike nor the sustained trigger fired. Placement stops adding at 60 %, so the gap between 60 % and 80 % is the hysteresis.

Leaving quarantine changes too:
- An offender leaves after its quiet window (no spike, no crash), whatever its load. `quarantine.steadyLoadPct` is removed.
- A never-measured isolate leaves as soon as it is measured, with no 30 s window. Members a bisect moved stay until that bisect ends.
- With no room anywhere, a member stays in quarantine flagged `atCap`.

### m3h-balancer-full-reason

`@isoloop/balancer: minor` · [`3322248`](https://github.com/isoloop/isoloop/commit/3322248), [#204](https://github.com/isoloop/isoloop/pull/204)

Moves made by the full-pool trigger now carry their own `MoveReason`, `full`, instead of `sustained`. A pool that is full and also lagging still reports `sustained`; `full` is the low-lag case, where members that yield often starve each other.

### m3h-balancer

`@isoloop/balancer: minor` · [`9e61934`](https://github.com/isoloop/isoloop/commit/9e61934), [#196](https://github.com/isoloop/isoloop/pull/196)

New package, `@experimental`: `createBalancer(kernel, opts)` places isolates spawned through it (M3h). One per kernel (`balancer_exists`). An isolate joins the `balancer-N` pool with room for its measured load, or gets a pool of its own within `maxWorkers`; one that spikes, crashes or kills its pool goes to a quarantine pool (`balancer-quarantine-N`) and comes back once steady, and a repeat offender is kept apart. Moves are a stop and a spawn with another `pool`, reported as `move` events. `measure(id)` gives any isolate's load over the last 3 s. Isolates spawned with `kernel.spawn` are never touched.

### m3h-busy-ms

`@isoloop/protocol: minor`, `@isoloop/runtime: minor`, `@isoloop/host: minor`, `@isoloop/react: minor`, `@isoloop/preact: minor` · [`e44f2e8`](https://github.com/isoloop/isoloop/commit/e44f2e8), [#198](https://github.com/isoloop/isoloop/pull/198)

Each isolate's busy time (ADR 0017). Every beat reports `busyMs` for each member: the milliseconds its worker spent running that isolate's code since the last beat. A pool reports it in `members[id]` and an own worker in `idle`, and `kernel.isolates()` shows it as `IsolateSnapshot.busyMs`. Per worker, `lagMs` is unchanged. It is always on, costs two `performance.now()` calls per callback, and sends no new messages.

The runtime counts what it dispatches to an isolate (host messages, `start`, DOM flushes) and every callback the isolate registers. Before any member loads, it wraps the worker's `setTimeout`, `setInterval`, `requestAnimationFrame`, `queueMicrotask` and `requestIdleCallback`, plus `MessagePort` `onmessage` and `message` listeners. Each callback is billed to the isolate that registered it, so chains stay with it. The wrapped functions behave as the natives do: ids, `clear*`, `this`, arguments, errors, `name` and `length` are all unchanged.

A pool's shared framework renders several members in one task, and that task is split equally among the members whose roots it touched:
- **React:** the runtime installs a minimal `__REACT_DEVTOOLS_GLOBAL_HOOK__`, which production react-dom calls on every commit. The adapter names its container to the runtime.
- **Preact:** the adapter runs each render batch through `options.debounceRendering`. A root's first DOM change since its last flush names it.

Not counted, and visible only in `lagMs`: promise continuations, module evaluation, other schedulers, and the worker's shared work, such as garbage collection.

### m3h-claim-pools

`@isoloop/host: minor` · [`fdbc923`](https://github.com/isoloop/isoloop/commit/fdbc923), [#197](https://github.com/isoloop/isoloop/pull/197)

Pool names starting `balancer-` are reserved for `@isoloop/balancer` (ADR 0017). `kernel.spawn` with one throws a `KernelError` coded `reserved_pool`. The balancer gets them through `claimPools(kernel, 'balancer')`, an `@internal` export that returns a `spawn` allowed to use those pools and otherwise the same as `kernel.spawn`. A kernel can be claimed once, so it has one balancer; a second claim throws `balancer_exists`.

### m3h-isolate-beat

`@isoloop/host: minor` · [`7c8f83b`](https://github.com/isoloop/isoloop/commit/7c8f83b), [#201](https://github.com/isoloop/isoloop/pull/201)

A new kernel event, `isolate:beat` `{ id, pool?, lagMs, busyMs?, at }`, reports every heartbeat as it arrives, once per member of a pool (ADR 0017). It is emitted only while someone listens. `@isoloop/balancer` reads every beat through it instead of polling `isolates()`, which keeps only the latest one.

### pool-member-stop-timers

`@isoloop/runtime: patch` · [`33b8c89`](https://github.com/isoloop/isoloop/commit/33b8c89), [#206](https://github.com/isoloop/isoloop/pull/206)

A stopped pool member's callbacks no longer run (ADR 0015, decision 9, amended). Once its `onShutdown` handlers settle, none of the timers, animation frames, idle callbacks, queued microtasks or port listeners it registered run again, and none is billed to its `busyMs`: each member instance holds a token that ends then. The gating is lazy (an interval clears itself and a port closes the next time they fire; a pending timeout keeps its closure until then), and a restart under the same name gets a new token. Work started outside the member's code and promise continuations aren't covered. Before, a member moved by the balancer kept burning CPU in the pool it left and doubled its `busyMs` when it came back.

## 2026-11-17

### stop-spawn-same-id

`@isoloop/host: patch` · [`70b742a`](https://github.com/isoloop/isoloop/commit/70b742a), [#219](https://github.com/isoloop/isoloop/pull/219)

`kernel.stop(id)` followed at once by `kernel.spawn()` with the same id, without awaiting `stop()`, no longer leaves the new isolate cut off. The old instance's `bye` (or the end of its grace) ended the bus connection by id, so it detached the new isolate's connection and dropped its subscriptions; in a pool it also shut the new member down, or terminated the pool's worker when it was the only member. The new isolate now stays `restarting` until the stopped one's worker is gone, then starts, which waits at most the stop grace. Messages the old worker sends meanwhile, other than `bye`, are dropped, so they can't reach the new isolate's surface. `stop()` resolves as before.
