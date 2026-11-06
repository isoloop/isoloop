# ADR 0005: Isolates talk to the bus worker over direct MessageChannels

- **Status:** Accepted
- **Date:** 2026-11-03
- **Refines:** RFC 0001 "Bus bridge" and "Placement and engines"

## Context

RFC 0001 places the broker in a dedicated bus worker, but routes records through a "bus bridge" on the main thread. That means every record is cloned twice (isolate → main, main → bus worker) and every delivery twice more. On a busy dashboard the main thread would spend its time copying records, which defeats the goal that "the main thread only draws". The proof of concept routes everything on the main thread for the same reason: it had no bus worker.

`MessageChannel` ports are transferable, so two workers can talk directly once someone hands each of them one end.

## Decision

- The kernel starts the bus worker first, with a **control port** (main ↔ bus).
- For each isolate it creates a `MessageChannel`. One port goes to the isolate in `init`; the other goes to the bus worker in a control message `attach { isolateId, grants, port, reattach? }`. `reattach` marks a new port after a bus restart ([ADR 0007](0007-bus-worker-supervision.md)).
- All `publish`, `subscribe`, `unsubscribe`, `deliver` and `commit` messages travel on that port. **No record crosses the main thread**, except the host's own: `kernel.publish` goes over the control port, and `kernel.subscribe` gets its own bus port, so those records reach the main thread because the host asked for them.
- **Grants (ACL)** come from the isolate manifest and are given to the bus worker by the kernel at `attach`. The bus worker enforces them; the isolate can't widen them.
- On isolate stop or restart the kernel sends `detach { isolateId, keepOffsets, wake? }`; the bus worker closes the port. Isolates always keep their committed offsets. `wake` marks a suspended isolate whose subscriptions the bus keeps watching ([ADR 0001](0001-one-worker-per-isolate.md)).
- **Host connections:** each `kernel.subscribe` is attached as `isoloop:host:<n>`, with grants to subscribe to everything and publish nothing. Unsubscribing detaches it with `keepOffsets: false`. Ids starting with `isoloop:` are reserved for the kernel, so `spawn` rejects them with `invalid_manifest`.
- Devtools and metrics read from the control port (sampled, not every record).

The "bus bridge" in the kernel becomes a **bus controller**: it starts the bus worker, wires ports, and forwards host-side `kernel.publish()` calls (rare).

## Consequences

- The main thread carries only patches, events, heartbeats and control traffic.
- One more moving part per isolate (a port), and the bus worker must handle an isolate's port dying without notice. A worker's ports don't signal close, so the kernel's `detach` is the source of truth.
- Heartbeats still go to the main thread, because the supervisor lives there.

## Alternatives considered

- **Route through the main thread (RFC as written):** simpler wiring, but costs main-thread time per record.
- **`BroadcastChannel`:** no per-isolate identity or ACL, and every listener gets every message.
- **`SharedWorker` as the bus:** survives across tabs, which isn't a v1 goal, and Safari support has been patchy.
