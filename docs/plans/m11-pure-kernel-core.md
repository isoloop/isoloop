# M11: Pure kernel core (outline)

**Goal:** the kernel's decisions written as pure steps, `step(state, input) → [state, effects]`, with a thin shell that owns workers, ports, timers and the DOM and carries the effects out.

**Done when:** `createKernel`'s decisions live in pure modules inside `@isoloop/host`, each tested with synthetic clocks and no workers; `kernel.ts` is split along them; and the API check reports no change, so it ships as a refactor with no changeset.

**Depends on:** 0.1.1 being out, so the split doesn't collide with the host fixes. Runs after `0.2.0` ships, alongside `0.3.0`, and is done before [M12 Tauri](m12-tauri.md) starts (the [releases table](README.md#releases)). Runs in parallel with [M14 Big-file split](m14-big-file-split.md), which splits the other three large files; this milestone splits `kernel.ts`.

Added 2026-11-24 from a design exploration on 2026-11-20. Grilled before it gets a task list.

## What

The supervisor already works this way: `supervisor/machine.ts` only decides, and the kernel feeds it inputs and runs its effects, so its transition table is tested with plain numbers. The same split would cover the rest of `createKernel` (about 1,240 lines in one closure): spawn, stop and restart bookkeeping, pools and suspension, the router's decisions, the bus controller's state, and the balancer's choices.

## Why

- **Tests:** each part tested like the supervisor, with synthetic clocks and no workers.
- **The seam for splitting `kernel.ts`,** one that follows the code rather than a line cap.
- **Other shells:** [M12 Tauri](m12-tauri.md) and Node or Bun ([Towards 2.0](README.md#towards-20-node-bun-and-server-side-rendering)) reuse the core with their own shell. A Rust port of the core becomes possible later, and isn't a goal.

**Not WASM:** nearly all of the kernel's work is Web API calls (workers, `MessageChannel`, timers, the DOM), which WASM can't make directly, so moving the kernel to WASM gains nothing. The bus broker already has no DOM and runs its tests in Node ([design §6](../design/system-design.md#6-isoloopbus)), so the bus side is mostly there.

## In steps

1. Pure modules inside `@isoloop/host`, next to `machine.ts`, with the API check reporting no change.
2. A separate `@isoloop/core` package only when a second shell needs it, with an ADR, since it's a new published package.

## Open questions

- How effects are ordered against microtasks and port messages.
- Whether the balancer's decisions move with the kernel's or stay in `@isoloop/balancer`.
