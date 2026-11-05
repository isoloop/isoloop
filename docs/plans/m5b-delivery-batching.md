# M5b: Delivery batching spike (outline)

**Goal:** find out whether batching bus traffic across tasks, rather than only within one microtask, gets the TS engine to the [design §9](../design/system-design.md#9-performance-budgets) budget of ≥ 50k records/s delivered. The batching must not cost interactive latency, ordering or backpressure. Then decide, with an ADR, whether [design §6.3](../design/system-design.md#63-broker) changes.

**Done when:** the findings are written up in `docs/investigations/delivery-batching.md` and the user has accepted one of two outcomes: an ADR that amends §6.3 (and the protocol, if needed), or a recalibrated §9 budget with the reason.

**Depends on:** M5. The shared-memory engine changes how records reach isolates. When the host is cross-origin isolated they're read from a `SharedArrayBuffer` and there are no `deliver` posts at all. Batching therefore only matters on the `deliver` fallback path and for `publish`/`result`, and it has to be measured against both engines. M5 also extends the throughput bench to 10/50/100 subscribers, and this spike reuses those benches.

This is a spike: prototypes live on a `spike/m5b-*` branch and aren't merged. That's the same pattern as the Remote DOM spike in M1 task 4. Work that comes out of the decision gets its own tasks.

## Why

The M2 throughput bench (task 13, [#50](https://github.com/isoloop/isoloop/pull/50)) measured, on Chromium with 1 publisher, 10 subscribers and 200-byte records:

| | Local (WSL2) | CI |
| --- | --- | --- |
| Delivered | 36,670 records/s | 45,498 records/s |
| Published | 3,668/s | 4,552/s |
| Delivery latency p50 / p95 | 137 / 143 ms | 109 / 125 ms |

Here is where the time goes. Each `publish` reaches the bus worker as its own task. The broker coalesces `deliver` batches per microtask (`#schedule` in `packages/bus/src/broker.ts`), so a batch never holds more than one record. Each record therefore costs one `result` post plus one `deliver` post per subscriber: 11 `postMessage`s for 10 subscribers. The latency is mostly queueing, because the bench keeps up to 500 publishes unanswered and they wait behind each other.

## Candidates

1. **Broker-side coalescing across tasks:** hold a subscription's pump until a batch fills (64 records) or a short window passes. The window could be a `setTimeout(0)`, a `MessageChannel` tick, or a fixed time such as ≤ 1 ms.
2. **Client-side publish batching:** `BusClient` gathers the publishes made in one microtask into a single `publish` message with several records. The broker then gets them in one task and today's coalescing works as designed. This needs a protocol change.
3. **Batched `result` replies:** one `result` message settles several publishes.
4. **Adaptive:** send at once while a subscription is idle, and coalesce only under load (when the previous batch is still unacknowledged or there's backlog). Interactive single records keep their latency.
5. **A combination** of the above.

## Questions to answer

- Throughput gained per candidate, at 10/50/100 subscribers, on Chromium, Firefox and WebKit, with both engines.
- Latency added to a single interactive record, such as a click that publishes and a visual isolate that renders it. The [click-to-paint](../investigations/click-to-paint-latency.md) budget is one frame, and batching must not eat into it.
- Effects on credits and `gap` notices, per-key order in groups, request/response timeouts, and `deliver` batches crossing a bus restart (`reattach`).
- Whether the gain survives a real schema. The M2 bench uses hand-built validators; run it with Zod as well. That also answers the M2 risk about how long Zod-based contracts take to load.
- Cost in code and protocol: a new message shape needs a protocol version bump (`isoloop-dom@1` isn't affected, but the bus wire format is).

## Main work items

1. **Bench matrix:** M5's throughput bench, with a candidate switch and a single-record latency case added.
2. **Prototypes** of candidates 1, 2 and 4 behind internal flags, each run through the engine conformance suite and the M2 broker unit tests unchanged.
3. **Write-up:** the numbers, the trade-offs and a recommendation, in `docs/investigations/delivery-batching.md`.
4. **Decision:** an ADR amending §6.3 for the chosen design, or a §9 budget change. The user reviews it either way.

## Open risks

- With the SAB engine in place, the `deliver` path may become a fallback that few hosts use. If so, the spike may conclude that only publish batching (candidates 2 and 3) is worth doing.
- A fixed time window trades latency for throughput everywhere. Prefer the adaptive approach unless the numbers rule it out.
