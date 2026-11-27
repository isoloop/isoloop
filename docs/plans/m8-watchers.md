# M8: Watchers

**Goal:** a second way to read a topic. A **watcher** gets only the current value per key, never the stream, so readers that only show state stop paying for records they never show. Publishers, contracts, grants and existing subscribers don't change.

**Done when:** `bus.watch`, `kernel.watch` (amended 2026-11-26), `useWatch` in both adapters and the devtools rows ship in `0.2.0` as `@experimental`; on markets, where ticks outrun painting, watchers send fewer messages than `useTopic` for the same widgets; on plant, slow topics cost no more than they do today; and the equivalence tests pass. Measured on bench machine 1 and written up, whatever it shows.

**Depends on:** 0.1 ([M4](m4-devtools-release.md)). `bus.watch` and `useWatch` add to the isolate seam, which [ADR 0019](../adr/0019-versioning-and-releases.md) allows only in a minor. Its phases ship across three minors (the [releases table](roadmap.md#releases)): W1 in `0.2.0`, W2 in `0.3.0` with the other bus work, and W3 in `0.4.0` next to [M5 Shared-memory engine](m5-shared-memory-engine.md).

**Status:** proposed 2026-11-21 in a design exploration; W0 grilled 2026-11-25 (Q1–Q30, yes to all). [ADR 0023](../adr/0023-watchers.md) accepted 2026-11-25; W1 can start. Tasks 2 to 4 merged 2026-11-27 (#475, #476, #478); the gaps they found are settled in the ADR's two 2026-11-27 amendments.

## Phases

| Phase | Ships in | Scope | Gate before the next phase |
| --- | --- | --- | --- |
| W0 Decide | ADR | [ADR 0023](../adr/0023-watchers.md) | ADR accepted |
| W1 Watchers | `0.2.0`, `@experimental` | Views built from the log in the bus worker; `watch`, `view` and `unwatch` messages, `seen` at once in a burst and in `commits` otherwise; `bus.watch`; `useWatch`; the dev warning; devtools rows with the conflation ratio in plain words | Markets: fewer messages. Plant: no regression. Equivalence tests pass |
| W2 Pools and wake | `0.3.0` | One watch per pool worker, values handed to members read-only; wake from suspension from a snapshot. Grilled before it starts | Wake cost flat as topics grow. Pool tests pass |
| W3 Shared slots | `0.4.0` | One `SharedArrayBuffer` per topic, written only by the bus worker under a sequence lock; message fallback when the page isn't cross-origin isolated. Uses [M5](m5-shared-memory-engine.md)'s cross-origin isolated setup, and ships whether or not M5's engine wins. Slot sizes decided in an amendment to ADR 0023 first | No messages per update. Torn-read fuzz test clean. Faster than messages |

W1 carries most of the gain. W2 and W3 optimise the same API.

## Decisions (2026-11-25, grilled; maintainer, yes to all)

[ADR 0023](../adr/0023-watchers.md) has them in full.

1. **`useTopic` stays a stream.** W1 adds `useWatch` beside it: no break, no codemod in `0.2.0`. Folding `useTopic` onto a watcher is decided when watchers go stable.
2. **Values per key.** `bus.watch(topic, onView, { keys? })` with the view a `ReadonlyMap`; `useWatch(topic)` returns the map, `useWatch(topic, { key })` one value. The `keys` filter ships in W1.
3. **A key clears when retention removes its newest record,** so a watcher on a quiet bus holds what a stream reader from `earliest` ends with.
4. **At most one view in flight per watch,** newest wins. The constants are fixed and internal in `0.2.0`.
5. **A view is settled** when `onView` returns, or after the adapter commits the render (a layout effect).
6. **Reattach after a bus restart** with `have`, the versions held; a lost memory topic resets the view to empty.
7. **The subscribe grant; many watches per topic per isolate,** run by the client over one bus watch with the union of their keys.
8. **No `kernel.watch`** until there's a use case.
9. **W3 slot sizes** wait for an amendment before W3.
10. **Devtools rows per topic:** watches, live keys, transport, conflation ratio, added to the inspection feed under the `inspect` grant.
11. **`seen` travels in ADR 0016's `commits`,** once per commit interval; no new timer (refined by 22).
12. **`onView(view, changed)`,** `changed` the keys added, updated or cleared; `bus.watch` returns `unwatch()`.
13. **Records with no key share the `null` key.**
14. **Values decoded like a `deliver`,** not frozen; a key's version is its record's offset, not visible to apps.
15. **Names `bus.watch` and `useWatch`,** with "a watcher skips values" as the first line of the TSDoc and of the guide.
16. **The done-when's apps:** markets' state-only widgets move to `useWatch`; plant keeps `useTopic`, with one probe widget on a slow topic on `useWatch`.
17. **ADR 0023 and this plan in one PR,** to the maintainer as Proposed.
18. **No compacted delete exists;** if one is added, it clears the key as retention does.
19. **An async `onView`** is settled when its promise settles.
20. **The first snapshot isn't paced:** parts of at most 512 values back to back, `onView` once after the last.
21. **Wake:** a full snapshot to the new worker; a changed key wakes a suspended headless isolate; a view counts as delivered for the idle rule.
22. **No `reset` message for a watch;** an empty snapshot after a restart is the reset.
23. **A watch and a subscription on one topic are independent.**
24. **The risk, worded right:** a component sees the latest with either hook; the trap is code that needs every value (history, sums, counts). The guide opens with "Need history, sums or counts? Use `subscribe`", with a sparkline; devtools say "showed 1 of every 40 values".
25. **The burst rule:** a view arriving less than one commit interval after the previous one gets `seen` at once, once settled; any other view's `seen` rides in `commits`.
26. **The bus worker points at the log's records, no copies;** dev mode warns once when an unfiltered watch holds over 1,000 keys.
27. **No work on append:** a view is built when sent, from the log between the watch's last sent offset and the tail, newest per key. The snapshot map is for attach only.
28. **The guide's table:** show latest → `useWatch`; react to every record → `subscribe`; one topic in one component → either. `useTopic`'s TSDoc links it.
29. **No fallback over `subscribe` on an older host.** ADR 0012 stays unchanged: a `0.2` isolate fails on a `0.1` host at start with `runtime-too-old`, naming both versions, and the ADR states that as a cost.
30. **Expired keys:** each watch keeps the last version sent per key, as pointers to log records; a key below the oldest retained offset with no newer record clears in the next view; on `time` topics the retention pass marks the affected watches. Memory per watch per key, bounded by `keys`, shown in devtools.

## Tasks (W1)

| # | Task | When | Repo | Files | Tests | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ADR 0023 and this plan, to the maintainer | this PR | library | `docs/adr/0023-watchers.md`, `docs/adr/README.md`, `docs/plans/m8-watchers.md`, `docs/plans/README.md` | — (maintainer) | the grilling |
| 2 | **Protocol:** `watch`, `view`, `unwatch` and `commits.seen` in the bus port types and guards (ADR 0023, point 13) | after 1 is accepted | library | `packages/protocol/src/messages/bus.ts` | unit: guards accept the new messages and reject malformed ones | 1 |
| 3 | **Watches in the bus worker:** nothing on append beyond noting news for idle watches; a view built when sent, from the log between the watch's last sent offset and the tail, newest per key; per watch the last sent version per key, as pointers to log records; clears from the oldest retained offset, and the `time` pass marking watches whose keys fell out; the snapshot map read once on a topic's first watch, dropped 5 s after its last; one view in flight, snapshot parts of 512; `have` on a new `watch`; the dev warning past 1,000 keys on an unfiltered watch; refused without a subscribe grant | after 2 | library | `packages/bus/src/broker/`, `packages/bus/src/server/server.ts` | unit on the broker: snapshot, newest wins under an unseen view, `keys` filter, `null` key, clears on `last-n` and on `time` with no append, compacted topic keeping its keys, `have` sending only the difference, grace, the dev warning once, `forbidden`. Bench: append throughput with and without a watcher on the topic, in `bench/throughput` | 2 |
| 4 | **`ctx.bus.watch` in `@isoloop/runtime`:** `more` on `view` in the protocol and the bus, and `onView` after the part without it (amended 2026-11-27); a new `watch` drops the topic's pending `seen`; the task 2 placeholder in `bus-client.ts` replaced; the client's multiplexing (one bus watch per topic per port, union of keys, per-watch `onView`), the burst rule (`seen` at once for a view less than one commit interval after the previous, otherwise in the committer's `commits`), reattach with `have` after a bus restart, the reset to empty for a lost memory topic; a watch counts towards wake and idle like a subscription; TSDoc, `@experimental` | after 3 | library | `packages/runtime/src/bus/bus-client.ts`, `packages/runtime/src/isolate/` | unit: two watches with different keys share a bus watch and get only their keys; `seen` waits for every local watch; a slow topic sends `seen` in `commits` with no extra message; a burst sends it at once; an async `onView`; reattach; reset. Browser: a bus restart with a persistent and a memory topic | 3 |
| 5 | **`useWatch` in `@isoloop/react` and `@isoloop/preact`,** both forms, `seen` after commit in a layout effect, StrictMode leaving one watch; built on the adapters' `hooks/shared-topic.ts` ref count, which `useTopic` uses since #410; TSDoc, `@experimental` | after 4 | library | `packages/react/src/hooks/`, `packages/preact/src/hooks/` | the adapter conformance suite gains watcher cases (two components on one topic, one key, the `null` key, a reset, a render that never commits sends no `seen`) | 4 |
| 5b | **`kernel.watch` in `@isoloop/host`** (ADR 0023, points 30 to 34, amended 2026-11-26): the same signature as `ctx.bus.watch`, over a host connection to the bus, the host's watches on one topic sharing one bus watch, `seen` when `onView` settles with the burst rule, reattach with `have` after a bus restart, counted in the devtools rows; TSDoc, `@experimental` | after 4 | library | `packages/host/src/kernel/kernel.ts`, `packages/host/src/bus/controller.ts` | unit: two host watches with different keys share a bus watch; `seen` after an async `onView`; reattach and reset after a bus restart. Browser: the host's view matches an isolate's on the same topic | 4 |
| 6 | **The equivalence tests:** a property test that, for random publishes with random keys and each retention kind, a watcher on a quiet bus holds the same value per key as a stream reader from `earliest`; and the same across a bus restart and a wake | after 4 | library | `packages/bus/src/`, `packages/runtime/src/bus/` | property tests in CI; an E2E on all three engines with a restart and a wake | 4 |
| 7 | **Inspection and devtools rows:** `BusMetrics` per topic gains watches, live keys, transport, and the records appended and values delivered to watchers (ADR 0020, decision 7); the devtools bus view shows them, with the ratio in plain words ("showed 1 of every 40 values") | after 4 | library | `packages/protocol/src/messages/control.ts`, `packages/bus/src/server/server.ts`, `packages/host/src/inspect/`, `packages/devtools/src/views/` | unit on the metrics; the devtools E2E shows a watched topic's row | 4 |
| 8 | **Guide page:** opens with "Need history, sums or counts? Use `subscribe`", with a sparkline as the example; then the table (show the latest value → `useWatch`; react to every record → `subscribe`; one topic in one component → either); `bus.md` links to it and `useTopic`'s TSDoc links the table; `limits.md` states the costs from ADR 0023 with their limits (values in between skipped, the second value after a quiet spell up to one commit interval late, an entry for every retained key on an unfiltered watch, a `0.2.0` host needed) | after 5 | library | `docs/guide/` (new page, `bus.md`, `limits.md`, `map.json`) | `docs:check` | 5 |
| 9 | **Markets:** the state-only widgets move from `useTopic` to `useWatch` on `0.2.0-next.N` | after 5, on a preview | web | `apps/dashboards/markets/` | the app's E2E; message counts in the devtools rows | 5 |
| 10 | **Plant probe:** one probe widget on a slow topic on `useWatch`, the rest unchanged | after 5, on a preview | web | `apps/dashboards/plant/` | the app's E2E | 5 |
| 11 | **Bench and write-up:** markets (`useTopic` against `useWatch`, port messages per second and renderer CPU) and the plant probe, on bench machine 1, whatever it shows | after 9 and 10 | web | `apps/dashboards/*/comparison/`, a post | — (maintainer reviews the write-up) | 9, 10 |
| 12 | **`0.2.0` changesets and the done-when check:** minor changesets for runtime, host, react, preact, bus and protocol; the plans README row | with the release | library | `.changeset/`, `docs/plans/README.md` | CI | 2–11 |

Tasks 6 and 7 run in parallel after 4. Tasks 9 and 10 need a `0.2.0-next.N` on npm with tasks 2–5 in it.

## Open risks

- **Code that needs every value picks a watcher** (a sparkline, a sum, a count) and loses values without an error. The guide's first sentence and table, the TSDoc's first line and the devtools ratio have to make it obvious.
- **Unfiltered watchers on wide topics** hold an entry for every retained key. Retention bounds it; the dev warning and devtools show it.
- **The plant probe may show a cost** if a slow topic's view and `commits` don't line up as ADR 0023 expects. The probe exists to find that before `0.2.0`.
