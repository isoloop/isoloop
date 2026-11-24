# M14: Big-file split (outline)

**Goal:** the large source files outside the kernel split along their seams, with no change to behaviour or published types.

**Done when:** the broker in `@isoloop/bus`, the worker DOM in `@isoloop/dom` and the balancer in `@isoloop/balancer` are each split along their seams, and the API check reports no change, so it ships with no changeset.

**Depends on:** `0.2.0`. Runs after it ships, alongside `0.3.0`, in parallel with [M11 Pure kernel core](m11-pure-kernel-core.md), which splits the fourth large file, `kernel.ts` in `@isoloop/host` (the [releases table](README.md#releases)).

Added 2026-11-21 from [ADR 0021](../adr/0021-source-layout-and-entry-points.md) as a note; given an id on 2026-11-24. Grilled before it gets a task list.

## What

- Four source files were still over 1,200 lines after [M4e](m4e-source-layout.md): the kernel, the broker, the worker DOM and the balancer. This milestone takes the last three; M11 takes the kernel.
- **Why after 0.1:** splitting them during M4e would have stopped its moves from being provable no-ops, just before the release. The splits follow seams, not a line cap.
