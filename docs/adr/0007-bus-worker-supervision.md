# ADR 0007: The supervisor also supervises the bus worker

- **Status:** Proposed
- **Date:** 2026-11-03
- **Fills a gap in:** RFC 0001 (which covers isolate crashes only)

## Context

With the broker in its own worker (RFC decision, [ADR 0005](0005-bus-topology-message-channels.md)), the bus worker is a single point of failure for all shared state. In v1 logs live only in the bus worker's memory. If it crashes or hangs, every topic log and every committed offset is gone.

The broker runs only Isoloop code (no isolate code), so a crash means an Isoloop bug or out-of-memory, not a misbehaving isolate. It should be rare, but it must be handled.

## Decision

- The bus worker sends `beat` on its control port like an isolate does, and the supervisor tracks it with the same blocked/kill timeouts.
- On crash or kill, the supervisor uses an **all-for-one** strategy for the bus:
  1. mark every isolate `Restarting`;
  2. start a new bus worker and re-register topics;
  3. restore persisted topics, if persistence is enabled (later milestone, IndexedDB, compacted topics only);
  4. restart every isolate, which re-subscribes from `earliest` (offsets are gone).
- The bus has its own restart limit (default 3 in 60 s). Past it, the kernel emits `bus:failed`, and isolates keep running without a bus (publishes are rejected with an error).
- The kernel emits `bus:crash` and `bus:restart` events so hosts can report them.

## Consequences

- Handling is simple and correct: no isolate can keep state the restarted bus doesn't know about.
- A bus crash shows as a short full-dashboard reload. That's acceptable for v1 and documented.
- Persistence becomes more valuable; it stays a later milestone.

## Alternatives considered

- **Keep a mirror of the log on the main thread:** brings records back onto the main thread, against ADR 0005.
- **Ignore it:** a bus crash would leave isolates silently disconnected.
