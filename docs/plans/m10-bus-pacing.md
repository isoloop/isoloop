# M10: Bus pacing (outline)

**Goal:** fewer bus messages for readers that need every record, by letting a subscriber choose how often it's delivered to and a publisher gather a burst of publishes, with every record, the order, offsets and at-least-once delivery kept.

**Done when:** the candidates that [M5b Delivery batching](m5b-delivery-batching.md)'s write-up keeps ship in `0.3.0`, `@experimental` where they add API; plant and markets send fewer port messages for the same widgets, and click-to-paint doesn't change; measured on [M13 Benchmark gate](m13-benchmark-gate.md) and written up, whatever it shows.

**Depends on:** [M5b Delivery batching](m5b-delivery-batching.md), in the same minor, `0.3.0` (the [releases table](roadmap.md#releases)). This plan is written after M5b's write-up, and its findings can shrink it: a candidate the spike shows doesn't pay is dropped, and `0.3.0` ships smaller. Grilled before it gets a task list.

## Candidates

Added 2026-11-24 from a bus exploration on 2026-11-20.

1. **Pacing chosen by the subscriber:** a subscribe option such as `pace: 'frame'` or `{ maxWaitMs }`. An idle subscription gets its first record at once, so click-to-paint doesn't change; records that arrive during the next window go out together in one `deliver`. No new message type is needed, since a `deliver` already carries a list. It is M5b's adaptive candidate with the subscriber setting the window, suited to a visual isolate that paints once a frame anyway.
2. **Linger on the publisher,** like Kafka's `linger.ms`: the publishes a `BusClient` makes within a short window go as one message and get one `result`, with the first still sent at once. It is M5b's client-side batching across tasks. It only helps producers that publish in bursts; plant's feeds already batch their samples, so expect little there and more on markets.

## Evidence

M5b's plan holds the numbers behind both: on plant, about 2,390 port messages a second for Isoloop against 34 for the native + workers build, and batching per port per task cut them by only 3%.

## Open questions

- **A subscribe option or a kernel setting:** a new subscribe option adds to the isolate seam, so under [ADR 0019](../adr/0019-versioning-and-releases.md) it ships in a minor; a kernel setting doesn't touch the seam.
- **Credits:** how a held batch meets them.
- **Rates:** the deliveries a second at plant's and markets' rates, against the about 815 of `matched` at 5 kHz.
- **Watchers:** where pacing ends and [M8 Watchers](m8-watchers.md) begins. Watchers serve readers that only want the latest value; pacing serves readers that need every record.
