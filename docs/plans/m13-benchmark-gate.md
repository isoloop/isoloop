# M13: Benchmark gate (outline)

**Goal:** performance figures that compare from one release to the next, and a regression that fails the gate, so the bus work in `0.3.0` and `0.4.0` is judged against a fixed baseline.

**Done when:** the gate runs in CI on a machine that doesn't change, passes or fails on Isoloop's own budgets, reports the native ratios next to them, and has a recorded baseline on `0.2.0`.

**Depends on:** `0.2.0`. Runs after it ships, alongside [M14 Big-file split](m14-big-file-split.md) and [M11 Pure kernel core](m11-pure-kernel-core.md), and blocks `0.3.0`: [M5b Delivery batching](m5b-delivery-batching.md)'s spike starts only once the gate runs in CI (the [releases table](README.md#releases)). Also part of the [1.0 done-when](README.md#towards-10).

Added 2026-11-20 as a note; given an id on 2026-11-24. Grilled before it gets a task list.

## What

- **Why:** results recorded on phones don't hold over time. A phone that's mid-range today is low-end in a year, so those figures can't be compared from one release to the next, and they can't gate one.
- **Built from what exists, not a new bench:** this repo's `bench/` suite (throughput, click-to-paint, memory, codec, pools), plant-bench (the frozen plant build in `isoloop/web`, run at every minor) and the private throughput bench run before every release. The `bench/` suite runs on every PR on GitHub's runners, reported with no threshold; those machines change from run to run, so they can't gate. The other two run by hand on the bench server. This milestone runs all three on the fixed machine and makes them the gate. The `bench/` suite keeps running on PRs for quick feedback.
- **[M5b Delivery batching](m5b-delivery-batching.md)'s figures come from it:** M5b extends `bench/throughput` to 10, 50 and 100 subscribers, and the gate runs that bench.
- **A fixed machine:** the bench server with its cores pinned at a fixed clock, browser builds fixed in a container image, and device classes reproduced there by the specs that matter (cores, CPU throttling, memory) rather than by real phones.
- **Phones** become spot checks, described by class and platform ([`docs/writing.md`](../writing.md)), never the basis of a claim that has to last.

## Open questions

- **The trigger:** the bench server holds no GitHub credentials, so how CI starts a run and gets the results back.
- Which budgets fail the gate, and how much run-to-run noise they allow.
