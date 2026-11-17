# Consumer groups: a commit can cover a redelivered record

**Status:** decided 2026-11-17: the user chose option 1, as the [ADR 0016 amendment](../adr/0016-fewer-messages-per-record.md#group-commits-carry-a-delivery-sequence-amended-2026-11-17) (points 10–13), and that a group that has committed resumes from its committed offset whatever `from` says (point 14), which replaces answer 2's docs-only fix below. Fixed 2026-11-17 (`fix/group-commit-seq`): `packages/bus/src/groups-commit-loss.test.ts` passes, no longer `it.fails`. Investigation written 2026-11-16. Found by the processor example's File processor (isoloop/web#130), where balancer moves stop group members often.

**Answer:**

1. **A record can be lost from a consumer group.** It happens when a member leaves, its uncommitted records are redelivered to another member, and that member's next commit covers one of them before its handler has run. The broker then treats the record as committed. If that member stops before handling it, which a balancer move does, nobody gets it again. This breaks the promise in the design's "Groups" paragraph ([system-design.md](../design/system-design.md): "a member that leaves hands its uncommitted records to the others"), so it's a bug, not documented behaviour.
2. **A group rejoined `from: 'earliest'` after every member left starts at the topic's tail.** This is documented behaviour: a group is a consumer like any other, and `earliest` means the tail (design, "Subscriptions and consumers"). Only `from: 'committed'` resumes. The docs don't say that group members should use `committed`. That's a docs gap, not a bus bug; see "Docs" below.

## The mechanism

Commits are cumulative per member: "everything I hold up to offset N is done".

- The client keeps the **highest** settled offset per topic and sends it once per commit interval, 100 ms by default ([ADR 0016](../adr/0016-fewer-messages-per-record.md), `createCommitter` in `packages/protocol/src/commits.ts`, `settle`).
- The broker's `#commit` drops every group entry of that member at or below the offset: `g.unacked.filter((u) => !(u.member === sub && u.offset <= offset))` (`packages/bus/src/broker.ts`, `#commit`). The group's committed offset then moves to the first entry still unacked, minus one.

Redelivery breaks the ordering this relies on:

- When a member leaves, `#leave` puts its uncommitted offsets in `g.redeliver` with no member (`broker.ts`, `#leave`).
- `#pumpGroup` hands them to the remaining members **before** anything new, and sets `entry.member` to the new owner (`broker.ts`, `#pumpGroup`, the `redeliver` loop).
- The new owner now holds a record whose offset is **lower** than records it has already handled.

Two ways its next commit then covers that record:

1. **In order, no race.** Member A handled 0 and 2, so its committer holds "2". Then 1 and 3 arrive (B left). Within the same 100 ms interval the committer sends "2" while 1 is still waiting in A's queue. The broker drops A's entry for 1.
2. **Crossing.** A's "2" is already on its way when the broker reassigns 1 to A. It arrives after, and covers 1 just the same.

Either way the group's offset moves past 1. If A is then stopped before its handler reaches 1, `#leave` finds no entry for 1 to hand over. A later member joining `from: 'committed'` starts after it. The repro shows `[3]` where `[1, 3]` is expected.

The processor works around it in the app: it commits by hand below the lowest record it still holds, and publishes its held records back to the job topic on stop or crash. That's what fixed its 4-in-6 loss of one CSV file.

## Fix options

1. **A delivery sequence in commits (recommended).**
   - **How:** each `deliver` to a subscription carries a per-subscription `seq`, and each group entry records the `seq` it went out in. A commit carries `(offset, seq)`, where `seq` is the latest delivery whose records the client has all settled. The broker covers only entries with `offset ≤ N` **and** `seq ≤ S`.
   - **For:** this fixes both the in-order case and the crossing. Commits stay cumulative and combined (ADR 0016), and it adds one integer per `deliver` and per commit entry. Own subscriptions are unaffected, since their deliveries are always in order.
   - **Against:** it's a protocol change across protocol, bus and runtime, plus the host's own subscriptions, which share the committer.
2. **Redelivered records need an exact commit.**
   - **How:** the broker never lets a cumulative commit cover an entry that was redelivered. The client commits those offsets one by one; it can tell them apart because their offset is lower than the highest it has seen.
   - **For:** a smaller broker change.
   - **Against:** `commits` needs a second shape, and an exact list. A burst of redeliveries after a member leaves becomes one entry per record, which ADR 0016 set out to avoid.
3. **Per-record acks, or offset ranges, for group subscriptions.**
   - **How:** groups commit the set of settled offsets as ranges, not a high-water mark.
   - **For:** it's exact in every ordering, and ranges stay small when records are handled in order.
   - **Against:** it's the largest change. Group commits stop sharing ADR 0016's single-offset shape, and the broker must merge ranges.

Option 1 keeps the message budget ADR 0016 measured and fixes the cause, the commit not knowing which deliveries it acknowledges. It needs an ADR 0016 amendment, so it's for the user to decide.

## Docs

`docs/guide/balancer.md` ("Moves") already tells isolates that must keep their place to subscribe `from: 'committed'`. The design's "Groups" paragraph and the bus guide should say the same for consumer groups: `earliest` after every member has left replays the topic.
