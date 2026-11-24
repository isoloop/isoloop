# M8: Watchers (outline)

**Goal:** a second way to read a topic. A **watcher** gets only the current value per key, never the stream, so readers that only show state stop paying for offsets, commits, replay and backlog. Publishers, contracts, grants and existing subscribers don't change.

**Done when:** `bus.watch`, `useWatch` in both adapters and the devtools rows ship in `0.2.0` as `@experimental`; on markets, where ticks outrun painting, watchers send fewer messages than `useTopic` for the same widgets; on plant, slow topics cost no more than they do today; and the equivalence tests pass. Measured on the bench server and written up, whatever it shows.

**Depends on:** 0.1 ([M4](m4-devtools-release.md)). `bus.watch` and `useWatch` add to the isolate seam, which [ADR 0019](../adr/0019-versioning-and-releases.md) allows only in a minor. Its phases ship across three minors (the [releases table](README.md#releases)): W1 in `0.2.0`, W2 in `0.3.0` with the other bus work, and W3 in `0.4.0` next to [M5 Shared-memory engine](m5-shared-memory-engine.md).

Proposed 2026-11-21 in a design exploration. Grilled before it gets a task list, and the ADR (W0) is accepted before any W1 code. If the ADR changes what `useTopic` means, that break ships in `0.2.0` with an `isoloop migrate` codemod.

## Phases

| Phase | Ships in | Scope | Gate before the next phase |
| --- | --- | --- | --- |
| W0 Decide | ADR | Settle what `useTopic` means, the expiry rule, credit size and `kernel.watch` | ADR accepted |
| W1 Watchers | `0.2.0`, `@experimental` | Slots in the bus worker; `watch`, `view`, `seen` and `unwatch` messages; `useWatch`; devtools rows and a conflation ratio per watch | Markets: fewer messages. Plant: no regression. Equivalence tests pass |
| W2 Pools and wake | `0.3.0` | One watch per pool worker, values handed to members read-only; wake from suspension from a snapshot | Wake cost flat as topics grow. Pool tests pass |
| W3 Shared slots | `0.4.0` | One `SharedArrayBuffer` per topic, written only by the bus worker under a sequence lock; message fallback when the page isn't cross-origin isolated. Uses [M5](m5-shared-memory-engine.md)'s cross-origin isolated setup, and ships whether or not M5's engine wins | No messages per update. Torn-read fuzz test clean. Faster than messages |

W1 carries most of the gain. W2 and W3 optimise the same API.

## Main work items (W1)

1. **ADR (W0):** the semantics (snapshot on attach, newest wins, an idle watcher waits for nothing, retention respected, reattach with `have`), the four messages, credit and `seen` pacing on ADR 0016's committer, and the open questions below.
2. **Slots in the bus worker:** `Map<key, Slot>` per watched topic, filled from the log on the first watcher, dropped after a short grace when the last one leaves. A slot's version is its record's offset.
3. **`bus.watch` in `@isoloop/runtime`,** with reattach after a bus restart or a wake.
4. **`useWatch` in `@isoloop/react` and `@isoloop/preact`,** with adapter conformance cases.
5. **`kernel.watch`** on the host, if the ADR keeps it.
6. **Devtools:** watchers per topic, live slots, the transport, the conflation ratio.
7. **Tests:** the equivalence property (a quiet bus leaves a watcher holding the last value per key a stream reader from `earliest` ends with), pacing, retention clearing a slot, compacted deletes, bus restart, wake, refused grants.
8. **Bench and write-up:** markets and the plant probe on the bench server.
9. **Guide page:** when to use a watcher and when to keep a stream, with the risk stated plainly: a watcher skips values.

## Open questions

- **What `useTopic` means:** keep it a stream and add `useWatch`, or make it a watcher and add `{ every: true }` for streams.
- **Expiry:** does a slot clear when retention drops its record, or keep the last value until it's replaced?
- **Credit size and grace period:** fixed constants, or `KernelConfig.bus` settings from the start?
- **Shared-memory slot sizes (W3):** declared per topic in the contract, or sized by the bus from the first values it sees?
- **`kernel.watch`:** ships with the isolate API, or waits for a use case?

## Open risks

- **Someone who wants every tick picks a watcher** and loses ticks without noticing. The hook's name and the guide have to make the difference obvious.
- **Unfiltered watchers on wide topics** hold a slot per retained key. Retention bounds it, and devtools show it.
