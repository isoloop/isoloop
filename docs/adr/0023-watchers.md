# ADR 0023: Watchers, a second way to read a topic

- **Status:** Accepted 2026-11-25 (proposed the same day), from the M8 Watchers W0 grilling (Q1–Q30, yes to all). Amendment of 2026-11-26 Proposed: `kernel.watch` in W1 (point 27), from the [M9 Module Federation example](../plans/m9-module-federation.md) grilling (Q17, Q20).
- **Date:** 2026-11-25
- **Plan:** [M8 Watchers](../plans/m8-watchers.md). W1 ships in `0.2.0` as `@experimental`; W2 and W3 come in `0.3.0` and `0.4.0` ([releases](../plans/roadmap.md#releases)).
- **Touches:** [ADR 0005](0005-bus-topology-message-channels.md) (what travels on the bus port), [ADR 0007](0007-bus-worker-supervision.md) (reattach after a bus restart), [ADR 0012](0012-isolates-built-apart.md) (the seam only grows; which host runs which isolate), [ADR 0016](0016-fewer-messages-per-record.md) (the committer, which carries `seen`), [ADR 0020](0020-inspection-feed.md) (new rows in the feed).

## Context

A subscription is a stream. The bus delivers every record, in order, and the reader commits what it settled. That's what a consumer that builds state, keeps history, sums or counts needs. It costs a `deliver` per record per subscriber, plus a share of one `commits` per port per commit interval (ADR 0016), plus credit and backlog when the reader falls behind.

Most widgets don't need a stream. They show the current value. `useTopic` in the React and Preact adapters already returns only the newest value, whatever its key: in a burst, React draws only the newest. So a component sees the same thing with a stream or a watcher. The difference is cost. With `useTopic` every record still crosses to the isolate and is committed, including the ones no render ever shows, and there is one value for the whole topic rather than one per key. On markets, where ticks arrive faster than a widget paints, that's most of them.

What such a reader needs is the current value per key, and only as often as it can use it.

The forces:

- **Publishers, contracts, grants and existing subscribers must not change.** A watcher is a reader. It adds nothing to how records are written or kept.
- **The seam only grows** (ADR 0012), and anything added to it ships in a minor (ADR 0019). New API starts `@experimental`.
- **Retention already decides what the log holds.** A reader that holds less than the log shouldn't hold more than it either.
- **Slow topics must not cost more.** Plant has topics with one record a second. A scheme that adds a message per value there is a regression.
- **Appends must not cost more.** The bus worker's append path carries every publisher; a watcher shouldn't slow it.
- **The bus restarts** (ADR 0007), and isolates suspend and wake (ADR 0001). A reader has to come back to the right values after both.

## Decision

### Semantics

1. **A watcher gets the current value per key, never the stream.** On attach it gets a snapshot: the newest retained record's value for each key it watches. After that it gets the keys that changed. When several values arrive for one key between two views, only the newest is sent. A component sees what it would see with `useTopic`; what a watcher drops is every value in between, so **code that needs every value (a sparkline's history, a sum, a count) must keep a subscription**.
2. **`useTopic` doesn't change** (Q1). It stays a stream, with the same options and the same result. W1 adds `useWatch` beside it. There is no break in `0.2.0` and no codemod. Whether `useTopic` moves onto a watcher is decided when watchers go stable.
3. **Values are per key** (Q2). Records with no key share one key, `null` (Q13). On a topic without keys, that one key is the newest value, which is what `useTopic` gives today.
4. **A key clears when retention removes its newest record** (Q3). On a `last-n` or `time` topic, a key whose newest record ages out disappears from the view. On a compacted topic a key's newest record is never removed, so it stays. This keeps one property exact: **on a quiet bus, a watcher holds the same value per key as a stream reader that started from `earliest` ends up with**, for the keys it watches. The bus has no way to delete a key from a compacted topic today. If one is added, it clears the key the same way (Q18).
5. **A key's version is its record's offset** (Q14). The bus sends it with each value. Apps don't see it; the client uses it to reattach (point 20).
6. **Values go through the same codec and checks as a `deliver`** (Q14). They aren't frozen, since freezing costs time on every value. The TSDoc says to treat them as read-only.

### The API

7. **`ctx.bus.watch(topic, onView, opts?)`** in `@isoloop/runtime` (Q2, Q12):
   - `onView(view, changed)`: `view` is the whole `ReadonlyMap<string | null, Out>`, `changed` a `ReadonlySet<string | null>` of the keys added, updated or cleared in this view.
   - `opts.keys?: readonly (string | null)[]` watches only those keys. Without it, every key the topic retains is in the view.
   - It returns `unwatch()`, the same shape `subscribe` returns.
   - There is no `from`, no `group`, no `onGap` and no commit. A watcher starts from the snapshot, never joins a consumer group and has nothing to commit.
8. **`useWatch` in `@isoloop/react` and `@isoloop/preact`** (Q2): `useWatch(topic)` returns the map; `useWatch(topic, { key })` returns that key's value or `undefined`. `{ key: null }` reads the value of records with no key. Both read through the same external store as `useTopic`, so concurrent renders never tear.
9. **The names say it** (Q15, Q24, Q28):
   - The first line of the TSDoc of `bus.watch` and `useWatch` is: *a watcher skips values; use `useTopic` or `subscribe` to get every record.*
   - The guide page opens with: *Need history, sums or counts? Use `subscribe`*, with a sparkline as the example, then a table: show the latest value → `useWatch`; react to every record → `subscribe`; one topic in one component → either.
   - `useTopic`'s TSDoc links the table.
10. **A watch needs the subscribe grant for its topic** (Q7). There is no new grant. A refused watch fails the way a refused `subscribe` does.
11. **An isolate may have any number of watches on one topic** (Q7). The client runs them over one bus watch per topic per port: the union of their keys, or every key when any of them is unfiltered. Each watch's `onView` gets only its own keys. So two components calling `useWatch` on one topic both get values, which is what #410 asks of `useTopic`. A watch and a subscription on the same topic are independent of each other (Q23).
12. **Dev mode warns about wide watches** (Q26). With the kernel's `dev: true`, the bus warns once in the console when an unfiltered watch holds more than 1,000 keys, and suggests `keys`, as it warns about a replaced subscription today.

### On the bus port

13. **Three new messages and an addition to `commits`** (Q4, Q6, Q11), all on the existing bus port:
    - `watch { topic, keys?, have? }`, isolate → bus. `keys` is the union from point 11. `have` lists `[key, version]` for the keys the client already holds. A second `watch` on a topic replaces the first, so the client sends one when its union of keys changes.
    - `view { topic, vseq, values, cleared? }`, bus → isolate. `values` is `{ key, version, value }[]` for the keys that changed, `cleared` the keys that were removed. `vseq` counts views to this watch on this connection, from 1 at each `watch`.
    - `unwatch { topic }`, isolate → bus.
    - `commits` gains `seen?: { topic, vseq }[]`: the highest view settled per watch.

    `PROTOCOL` stays `{ v: 1, min: 1 }`: the bus port's two ends come from one build (ADR 0016, point 6), and the additions are new message types and an optional field.

### In the bus worker

14. **No work on append** (Q27). An append doesn't touch any watch's state. When a record lands on a watched topic, the bus only notes that the topic has news for the watches that have no view in flight.
15. **A view is built when it's sent** (Q27), by reading the log from the watch's last sent offset to the tail and keeping the newest record per key it watches. Values that arrived while a view was in flight are in that range, so newest wins with nothing merged by hand.
16. **The bus keeps, per watch, the version it last sent for each key** (Q26, Q30). These point at retained records in the log; no value is copied. They're what makes clears and reattach work:
    - **Clears.** The retained records of a `last-n` or `time` topic are one range, from the oldest retained offset to the tail. A key whose last sent version is below the oldest retained offset, with no newer record in the range read, is cleared in the next view. For a `time` topic, whose retention pass runs once a second with or without appends, the pass marks the watches whose oldest sent version fell out of the range, so a clear goes out without a new record. This costs memory per watch per key, bounded by `keys` and shown in devtools.
    - **Snapshot.** On the first watch of a topic, the bus reads the whole retained log once, newest per key, into a map that points at records the same way. Later watches of the topic within the grace (point 19) read their snapshot from it. That map exists only for snapshots: views never update it.
17. **At most one view is in flight per watch** (Q4). After sending a view, the bus sends the next only once it has the `seen` for it. So a watcher never gets values faster than it uses them.
18. **The snapshot isn't paced** (Q20). The first view after a `watch` carries every key the watcher asked for, split into views of at most 512 values each, sent back to back; only the last one waits for `seen`. The client calls `onView` once, after the last part.
19. **The snapshot map is dropped 5 s after the last watch of the topic leaves,** so a remount or a reattach within that time doesn't read the log again.
20. **The constants are fixed, not settings** (Q4): one view in flight, 512 values per view part, 5 s of grace, 1,000 keys for the dev warning. They're internal. A `KernelConfig.bus` setting comes later only if a measurement asks for one.

### When `seen` is sent

21. **A view is settled when its consumer is done with it** (Q5, Q19). For `bus.watch`, that's when `onView` returns, or when its promise settles. For `useWatch`, it's after React or Preact commits the render, in a layout effect. A view that several local watches share is settled when all of them are.
22. **Then the burst rule** (Q11, Q25):
    - **A view that arrived less than one commit interval after the previous one** gets its `seen` sent at once, once settled. That's a burst: `useWatch` then gets about one view per frame, at the paint rate; `bus.watch` one per settled `onView`.
    - **Any other view** gets its `seen` in the next `commits` the client sends, at most one per port per `commitIntervalMs` (ADR 0016, point 8). That's a slow topic: a view costs one message, as a `deliver` does, and `seen` rides on a `commits` the port sends anyway.

    The one wait left: the second value after a quiet spell can wait up to one commit interval (100 ms by default) behind the first view's `seen`. From the third on, the burst rule applies.

### Restart and wake

23. **After a bus restart, the client sends `watch` again with `have`** (Q6). The new bus sends only the keys whose version differs from `have`, and clears those it no longer has. A persistent topic comes back from disk, so usually little changes. A memory topic lost in the restart resets the view to empty: the client clears its values and calls `onView` with every key in `changed`, as `onReset` does for a subscription. The bus doesn't send `reset` for a watch; an empty snapshot is the reset (Q22).
24. **A woken isolate watches from scratch** (Q21). Waking starts a new worker (ADR 0001), so the client holds nothing and sends `watch` with no `have`; it gets a full snapshot. A watch counts towards waking a suspended headless isolate the way a subscription does: a changed key on a watched topic wakes it, and a view counts as delivered for the idle rule. Waking from a snapshot without replay is W2.

### Inspection

25. **The inspection feed gains watcher rows** (Q10, Q24), an addition to ADR 0020 under its decision 7 (the format only grows), with the existing `inspect` grant. Per topic, `BusMetrics` gains: the number of watches, the number of live keys, the transport (`'messages'` until W3), and the records appended and values delivered to watchers that the conflation ratio is computed from. The devtools panel shows the ratio in plain words: "showed 1 of every 40 values".

### Older hosts

26. **No emulation of `bus.watch` over `subscribe` on an older host** (Q29). ADR 0012 already settles that case, and it stays unchanged:
    - `defineIsolate`, in the runtime and in every adapter, stamps an isolate with the `major.minor` it was built with. An isolate built with `0.2.0` is `requires: '0.2'`, and a `0.1.x` host fails it at start with `runtime-too-old`, naming both versions (ADR 0012, points 3 and 4). It never reaches `bus.watch`.
    - `ctx.bus` is the bus client the bootstrap creates, and the bootstrap ships with the host (ADR 0016, point 6). An emulation would have to live in the adapter's `useWatch` and could never detect a missing `watch`, so it would never run.

### Not in this ADR

27. **`kernel.watch` on the host** (Q8) waits for a use case. The host has `kernel.subscribe`, and the devtools panel is an isolate. *(Amended 2026-11-26, Proposed: the use case is the M9 shop, whose header on the main thread shows the cart count from the `cart` topic. `kernel.watch` ships in W1, and is described under "The host's watch" below.)*
28. **W2, pools and wake:** one watch per pool worker, with values handed to its members read-only, and waking from a snapshot. In W1 each pool member watches on its own. W2 is grilled before `0.3.0`.
29. **W3, shared slots** (Q9): one `SharedArrayBuffer` per topic written by the bus worker under a sequence lock, with a message fallback when the page isn't cross-origin isolated. How slots are sized, declared per topic in the contract or sized by the bus, is decided in an amendment to this ADR before W3.

### The host's watch (amended 2026-11-26, Proposed)

30. **`kernel.watch(topic, onView, opts?)`** in `@isoloop/host`, `@experimental` with the rest of W1:
    - The same signature as `ctx.bus.watch` (point 7): `onView(view, changed)`, `opts.keys`, and `unwatch()` returned. No `from`, `group` or `onGap`.
    - It sits beside `kernel.subscribe`, as `ctx.bus.watch` sits beside `ctx.bus.subscribe`. It throws without contracts, as `kernel.subscribe` does.
    - The host needs no grant, as for `kernel.subscribe`.
31. **It runs as a host connection to the bus,** as `kernel.subscribe` does. The host's watches on one topic share one bus watch, with the union of their keys, as an isolate's do (point 11). Everything in the bus worker (points 13 to 20) is unchanged: the bus doesn't tell a host watch from an isolate's.
32. **A host view is settled when `onView` returns,** or when its promise settles (point 21). There's no adapter on the host, so no layout effect. The burst rule (point 22) applies on the host connection's committer.
33. **After a bus restart,** the host connection sends `watch` again with `have`, as an isolate's client does (point 23), and a lost memory topic resets the view to empty. The host never suspends, so point 24 doesn't apply.
34. **Devtools count host watches** in the per-topic watcher rows (point 25), with an isolate's.

## Consequences

**Good:**

- A widget that shows state gets the current values and nothing it can't use: in a burst, about one view per frame, whatever the record rate.
- A slow topic costs a watcher the same number of messages as a subscription: one `view` against one `deliver`, with `seen` riding on a `commits` the port sends anyway.
- Appends cost the same with or without watchers.
- Several components can read one topic, which `useTopic` doesn't allow.
- Nothing changes for publishers, contracts, grants or subscriptions, and there's no break to migrate.
- The equivalence property (point 4) gives one exact test for every scenario: a watcher on a quiet bus must hold what a replay ends with.

**Costs, each with what limits it:**

- **Code that needs every value can pick a watcher by mistake.** A component sees the latest either way; a sparkline's history, a sum or a count silently loses the values in between, with no error. *Limited by* the guide's first sentence and its table (point 9), the first line of the TSDoc, and the devtools ratio in plain words (point 25), which makes skipping visible.
- **The second value after a quiet spell can wait up to one commit interval** (100 ms by default). *Limited by* the burst rule (point 22): from the third value on, `seen` goes at once and views follow the paint rate.
- **An unfiltered watch on a wide topic holds an entry for every retained key,** as version pointers in the bus worker and as values in the isolate. *Limited by* retention, which bounds it; pointers rather than copies in the bus worker (point 16); the `keys` filter; the dev warning past 1,000 keys (point 12); and the live key count in devtools.
- **Building a view reads the log** from the last sent offset to the tail. That's the same records an append would have touched, read once per view instead of once per record, so a burst costs one read of its records. The first watch of a topic reads the whole retained log once. *Limited by* the 5 s grace (point 19), which keeps that snapshot for remounts and reattaches.
- **Two ways to read a topic** means a choice to explain. *Limited by* the guide's table (point 9), linked from `useTopic`.
- **The host API grows** by `kernel.watch` (points 30 to 34), `@experimental`. *Limited by* reusing the isolate client's watch logic over the host connection, so the bus worker gains nothing.
- **The isolate seam grows** by `bus.watch` and `useWatch`, so an isolate built with `0.2.0` needs a `0.2.0` host: a `0.1` host fails it at start with `runtime-too-old`, naming both versions, and there is no fallback over `subscribe` (point 26). *Limited by* ADR 0012: the failure comes at start, with a clear message, rather than at the isolate's first `watch`.

## Alternatives considered

- **`useTopic` becomes a watcher** (Q1), with the same signature. It already returns only the newest value, so most code wouldn't notice. But a watcher hands over the current value on attach, where `from: 'latest'` gives `undefined` until the next record, and a stable hook would then rest on `@experimental` machinery. Not taken for `0.2.0`; revisited when watchers go stable.
- **`useTopic` becomes a watcher, and `{ every: true }` keeps a stream** (Q1). A break that needs a codemod, for a feature that isn't stable yet. Not taken.
- **Credit, view size and grace as `KernelConfig.bus` settings from the start** (Q4). Settings are hard to remove once public, and nothing has measured a need. Not taken.
- **`seen` always on its own message** (Q11). One extra message per value on a slow topic, which is the regression the plant done-when rules out. Not taken.
- **`seen` always in `commits`** (Q25). Every burst would run at one view per commit interval, 10 a second by default, below the paint rate. Replaced by the burst rule.
- **Slots updated on every append** (Q27, which supersedes the first draft): a slot update and a dirty mark per watching port on each append, paid by every publisher. Not taken; views are built from the log when sent.
- **Copying values into slots** (Q26): a second copy of every watched key's value in the bus worker. Not taken; the bus points at the log's records.
- **An emulation over `subscribe` on an older host** (Q29). ADR 0012 fails the isolate before it runs, so it would be dead code. Not taken.
- **`kernel.watch` in W1** (Q8). No use case yet. Not taken on 2026-11-25; taken by the 2026-11-26 amendment (points 30 to 34), with the M9 shop as the use case.
- **The M9 shop's badge as a small isolate from the cart team** instead of `kernel.watch` (M9 grilling, Q17). It works without the amendment, but it puts the header's count in another team's remote only because the host can't watch. Not taken.
- **The badge reading `cart` with `kernel.subscribe`.** It gets every record of the cart on the main thread to show one number. Not taken.
- **A key keeps its last value after retention removes it** (Q3). The watcher would then show values a replay can't, and the equivalence property would need exceptions. Not taken.
