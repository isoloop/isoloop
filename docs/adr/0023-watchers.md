# ADR 0023: Watchers, a second way to read a topic

- **Status:** Proposed (2026-11-25), from the M8 Watchers W0 grilling (Q1–Q17, yes to all).
- **Date:** 2026-11-25
- **Plan:** [M8 Watchers](../plans/m8-watchers.md). W1 ships in `0.2.0` as `@experimental`; W2 and W3 come in `0.3.0` and `0.4.0` ([releases](../plans/README.md#releases)).
- **Touches:** [ADR 0005](0005-bus-topology-message-channels.md) (what travels on the bus port), [ADR 0007](0007-bus-worker-supervision.md) (reattach after a bus restart), [ADR 0012](0012-isolates-built-apart.md) (the seam only grows), [ADR 0016](0016-fewer-messages-per-record.md) (the committer, which carries `seen`), [ADR 0020](0020-inspection-feed.md) (new rows in the feed).

## Context

A subscription is a stream. The bus delivers every record, in order, and the reader commits what it settled. That's what a consumer that builds state, counts or forwards records needs. It costs a `deliver` per record per subscriber, plus a share of one `commits` per port per commit interval (ADR 0016), plus credit and backlog when the reader falls behind.

Most widgets don't need a stream. They show the current value. `useTopic` in the React and Preact adapters already returns only the newest value, whatever its key, and drops the rest. It still pays for every record: on markets, where ticks arrive faster than a widget paints, a widget gets records it never shows.

What such a reader needs is the current value per key, and only as often as it can use it.

The forces:

- **Publishers, contracts, grants and existing subscribers must not change.** A watcher is a reader. It adds nothing to how records are written or kept.
- **The seam only grows** (ADR 0012), and anything added to it ships in a minor (ADR 0019). New API starts `@experimental`.
- **Retention already decides what the log holds.** A reader that holds less than the log shouldn't hold more than it either.
- **Slow topics must not cost more.** Plant has topics with one record a second. A scheme that adds a message per value there is a regression.
- **The bus restarts** (ADR 0007), and isolates suspend and wake (ADR 0001). A reader has to come back to the right values after both.

## Decision

### Semantics

1. **A watcher gets the current value per key, never the stream.** On attach it gets a snapshot: the newest retained record's value for each key it watches. After that it gets the slots that changed. When several values arrive for one key between two views, only the newest is sent. **A watcher skips values.** That's the point of it, and it's the risk.
2. **`useTopic` doesn't change** (Q1). It stays a stream, with the same options and the same result. W1 adds `useWatch` beside it. There is no break in `0.2.0` and no codemod. Whether `useTopic` moves onto a watcher is decided when watchers go stable.
3. **Slots are per key** (Q2). Each watched topic has a `Map<key, slot>` in the bus worker. A slot holds the newest retained record for its key.
4. **Records with no key share one slot, under the key `null`** (Q13). On a topic without keys, that one slot is the newest value, which is what `useTopic` gives today.
5. **A slot clears when retention removes its record** (Q3). On a `last-n` or `time` topic, a key whose newest record ages out disappears from the view. On a compacted topic a key's newest record is never removed, so its slot stays. This keeps one property exact: **on a quiet bus, a watcher holds the same value per key as a stream reader that started from `earliest` ends up with**, for the keys it watches. The bus has no way to delete a key from a compacted topic today. If one is added, it clears the slot the same way.
6. **A slot's version is its record's offset** (Q14). The bus sends it with each slot. Apps don't see it; the client uses it to reattach (point 13).
7. **Values go through the same codec and checks as a `deliver`** (Q14). They aren't frozen, since freezing costs time on every value. The TSDoc says to treat them as read-only.

### The API

8. **`ctx.bus.watch(topic, onView, opts?)`** in `@isoloop/runtime` (Q2, Q12):
   - `onView(view, changed)`: `view` is the whole `ReadonlyMap<string | null, Out>`, `changed` a `ReadonlySet<string | null>` of the keys added, updated or cleared in this view.
   - `opts.keys?: readonly (string | null)[]` watches only those keys. Without it, every key the topic retains has a slot.
   - It returns `unwatch()`, the same shape `subscribe` returns.
   - There is no `from`, no `group`, no `onGap` and no commit. A watcher starts from the snapshot, never joins a consumer group and has nothing to commit.
9. **`useWatch` in `@isoloop/react` and `@isoloop/preact`** (Q2): `useWatch(topic)` returns the map; `useWatch(topic, { key })` returns that key's value or `undefined`. `{ key: null }` reads the slot of records with no key. Both read through the same external store as `useTopic`, so concurrent renders never tear.
10. **The names say it** (Q15). The first line of the TSDoc of `bus.watch` and `useWatch`, and the first sentence of the guide page, is: *a watcher skips values; use `useTopic` or `subscribe` to get every record.*
11. **A watch needs the subscribe grant for its topic** (Q7). There is no new grant. A refused watch fails the way a refused `subscribe` does.
12. **An isolate may have any number of watches on one topic** (Q7). The client runs them over one bus watch per topic per port, with one set of slots: the union of their keys, or every key when any of them is unfiltered. Each watch's `onView` gets only its own keys. So two components calling `useWatch` on one topic both get values, which is what #410 asks of `useTopic`. A watch and a subscription on the same topic are independent of each other.

### On the bus port

13. **Three new messages and an addition to `commits`** (Q4, Q6, Q11), all on the existing bus port:
    - `watch { topic, keys?, have? }`, isolate → bus. `keys` is the union from point 12. `have` lists `[key, version]` for the slots the client already holds. A second `watch` on a topic replaces the first, so the client sends one when its union of keys changes.
    - `view { topic, vseq, slots, cleared? }`, bus → isolate. `slots` is `{ key, version, value }[]` for the slots that changed, `cleared` the keys whose slots were removed. `vseq` counts views to this watch on this connection, from 1 at each `watch`.
    - `unwatch { topic }`, isolate → bus.
    - `commits` gains `seen?: { topic, vseq }[]`: the highest view settled per watch.

    `PROTOCOL` stays `{ v: 1, min: 1 }`: the bus port's two ends come from one build (ADR 0016, point 6), and the additions are new message types and an optional field.
14. **At most one view is in flight per watch** (Q4). After sending a view, the bus sends the next only once it has the `seen` for it. Values that arrive meanwhile merge into the next view, newest wins. So a watcher never gets values faster than it uses them, and the bus holds at most one pending value per slot.
15. **A view is settled when its consumer is done with it** (Q5). For `bus.watch`, that's when `onView` returns, or when its promise settles. For `useWatch`, it's after React or Preact commits the render, in a layout effect. A view that several local watches share is settled when all of them are.
16. **`seen` travels in the existing `commits` message** (Q11). The client adds the settled `vseq` to the next `commits` it sends, at most one per port per `commitIntervalMs` (ADR 0016, point 8). There is no new timer and no message of its own. On a slow topic a view then costs one message, as a `deliver` does. In a burst, the next value can wait up to one interval, 100 ms by default.
17. **The snapshot isn't paced.** The first view after a `watch` carries every slot the watcher asked for, split into views of at most 512 slots each, sent back to back; only the last one waits for `seen`. The client calls `onView` once, after the last part.
18. **The bus fills a topic's slots from the log on its first watcher,** and keeps them up to date on each append and each retention pass. It drops them 5 s after the last watcher of the topic leaves, so a remount or a reattach within that time doesn't rebuild them.
19. **The constants are fixed, not settings** (Q4): one view in flight, 512 slots per view part, 5 s of grace. They're internal to the bus. A `KernelConfig.bus` setting comes later only if a measurement asks for one.

### Restart and wake

20. **After a bus restart, the client sends `watch` again with `have`** (Q6). The new bus sends only the slots whose version differs from `have`, and clears those it no longer has. A persistent topic comes back from disk, so usually little changes. A memory topic lost in the restart resets the view to empty: the client clears its slots and calls `onView` with every key in `changed`, as `onReset` does for a subscription. The bus doesn't send `reset` for a watch; an empty snapshot is the reset.
21. **A woken isolate watches from scratch.** Waking starts a new worker (ADR 0001), so the client holds no slots and sends `watch` with no `have`; it gets a full snapshot. A watch counts towards waking a suspended headless isolate the way a subscription does: a changed slot on a watched topic wakes it, and a view counts as delivered for the idle rule. Waking from a snapshot without replay is W2.

### Inspection

22. **The inspection feed gains watcher rows** (Q10), an addition to ADR 0020 under its decision 7 (the format only grows), with the existing `inspect` grant. Per topic, `BusMetrics` gains: the number of watches, the number of live slots, the transport (`'messages'` until W3), and the conflation ratio, which is records appended against values delivered to watchers. The devtools panel shows them in the bus view.

### Not in this ADR

23. **`kernel.watch` on the host** (Q8) waits for a use case. The host has `kernel.subscribe`, and the devtools panel is an isolate.
24. **W2, pools and wake:** one watch per pool worker, with values handed to its members read-only, and waking from a snapshot. In W1 each pool member watches on its own. W2 is grilled before `0.3.0`.
25. **W3, shared slots** (Q9): one `SharedArrayBuffer` per topic written by the bus worker under a sequence lock, with a message fallback when the page isn't cross-origin isolated. How slots are sized, declared per topic in the contract or sized by the bus, is decided in an amendment to this ADR before W3.

## Consequences

**Good:**

- A widget that shows state gets the current values and nothing it can't use. On a fast topic it gets at most one view per interval, whatever the record rate.
- A slow topic costs a watcher the same number of messages as a subscription: one `view` against one `deliver`, with `seen` riding on `commits` as commits already do.
- Several components can read one topic, which `useTopic` doesn't allow.
- Nothing changes for publishers, contracts, grants or subscriptions, and there's no break to migrate.
- The equivalence property (point 5) gives one exact test for every scenario: a watcher on a quiet bus must hold what a replay ends with.

**Bad, stated plainly:**

- **A watcher skips values.** Someone who needs every tick and picks `useWatch` loses ticks without an error. The name, the TSDoc's first line and the guide are the only guard.
- **A burst's next value can wait up to one commit interval** (100 ms by default) behind an unseen view.
- **An unfiltered watch on a wide topic holds a slot per retained key,** in the bus worker and in the isolate. Retention bounds it; the `keys` filter and the devtools' live slot count show and limit it.
- **The bus does more work per append** for a watched topic: a slot update and a dirty mark per watching port.
- **Two ways to read a topic** means a choice to explain. The guide page says when to keep a stream.
- **The isolate seam grows** by `bus.watch` and `useWatch`, so isolates using them need a `0.2.0` host (ADR 0012).

## Alternatives considered

- **`useTopic` becomes a watcher** (Q1), with the same signature. It already returns only the newest value, so most code wouldn't notice. But a watcher hands over the current value on attach, where `from: 'latest'` gives `undefined` until the next record, and a stable hook would then rest on `@experimental` machinery. Not taken for `0.2.0`; revisited when watchers go stable.
- **`useTopic` becomes a watcher, and `{ every: true }` keeps a stream** (Q1). A break that needs a codemod, for a feature that isn't stable yet. Not taken.
- **Credit, view size and grace as `KernelConfig.bus` settings from the start** (Q4). Settings are hard to remove once public, and nothing has measured a need. Not taken.
- **`seen` as a message of its own** (Q11). One extra message per value on a slow topic, which is the regression the plant done-when rules out. Not taken.
- **`kernel.watch` in W1** (Q8). No use case yet. Not taken.
- **A slot keeps its last value after retention removes it** (Q3). The watcher would then show values a replay can't, and the equivalence property would need exceptions. Not taken.
