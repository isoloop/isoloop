# ADR 0001: One dedicated worker per isolate in v1

- **Status:** Proposed
- **Date:** 2026-11-03
- **Answers:** RFC 0001 open question "Workers per isolate, or a pool?"

## Context

Thread isolation is Isoloop's main promise: a blocked or crashed isolate affects only itself. A pool that hosts several isolates in one worker saves memory (one framework copy, one heap) but shares an event loop again, so one isolate can block its neighbours. That is exactly the failure Isoloop exists to prevent.

Memory per isolate is a real cost (RFC risk: "one heap and framework copy per isolate"). A dashboard with 10–20 isolates is the main target, and that stays well within what browsers handle.

## Decision

v1 runs exactly one dedicated module worker per isolate. Nothing in the public API exposes worker identity, so a pool can be added later without breaking changes:

- `Supervisor`, `Compositor` and the bus key everything by `isolateId`, never by worker.
- The protocol envelope already carries no worker id; a future pooled worker would multiplex by adding `isolate` to the envelope (protocol v2).

## Consequences

- Isolation guarantees are simple to state and to test.
- Memory grows linearly with isolates. Mitigations stay as in the RFC: lazy start, suspending idle isolates (`shutdown` + replay on resume), and a shared runtime bundle cached per origin.
- A later pool would be opt-in per isolate (`isolation: 'shared'`) and limited to trusted isolates, with a pooled crash restarting every isolate in that worker.

## Alternatives considered

- **Pool from day one:** saves memory but weakens the core guarantee and doubles the supervision cases before there is any user demand.
- **Pool for "light" isolates chosen by heuristics:** surprising behaviour; rejected.
