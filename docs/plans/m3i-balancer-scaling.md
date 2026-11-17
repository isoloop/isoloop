# M3i: Balancer scaling

**Status:** built and measured (2026-11-17). An amendment to [ADR 0017](../adr/0017-opt-in-balancer.md) was accepted the same day. The balancer change is merged in `isoloop/isoloop` (isoloop#214) and shipped in `0.0.0-next.800569e`. The Playground and the File processor are merged in `isoloop/web` (web#137, web#138), and the bench-server run is in web#149. Left: the user's review of the write-up (web#150), then `processor-v0.2.0`, tagged by the user. The run had the processor's [#211](https://github.com/isoloop/isoloop/issues/211) workarounds in place. #211's fix shipped in `0.1.0-next.0`, and web#151 dropped the workarounds. The write-up found three gaps in the balancer itself, which [M3j](m3j-balancer-gaps.md) plans to fix.

**Goal:** `@isoloop/balancer` also acts when an isolate falls behind on its work, not only when it slows its neighbours. It moves isolates back together once they're quiet, and it moves less often. Three things change: an isolate that falls behind gets more CPU, a quiet one is packed back to free a worker, and a move happens only when it's predicted to help.

**Why:** the balancer is how an app gets autoscaling without placing its isolates by hand. It's for developers who don't want to decide which pools their isolates go in. It's `@experimental`, outside the core, and it builds only on the public kernel API. So everything here is inside the balancer and the processor example, and nothing in the kernel, protocol or bus changes.

M3h's measurement of the File processor ([write-up](https://github.com/isoloop/web/tree/main/apps/processor/comparison)) shows where it falls short:
- **Falling behind isn't a trigger.** On Firefox with no faults, one pool did about 44 of the 50 files a second, its queue grew and its p95 latency reached 11.5 s. The balancer moved nothing. Its triggers are lag, CPU at 80 % of a core and crashes, and a pool whose members yield often can stay under all three while falling behind. A worker per processor did all 50 files a second.
- **Moves are costly and frequent.** With faults it made 7 to 10 moves in a 20 s window. Its p95 latency was 16 to 18 s, from files waiting through moves, and it did 800 to 950 files twice in runs of about 2,080. Most of those moves were quarantines after a "poison" file. A poison file blocks whichever processor gets it, so quarantining that processor afterwards protects no one.
- **It never packs back.** After faults it kept 4 workers on Chromium and 9 on Firefox: as many as a worker per processor, with worse throughput and latency.

**Done when:**
- `balancer.report(id, { backlog })`, the backlog trigger, `behind`, the fewer-moves rules, the second-spike quarantine and packing back are in `@isoloop/balancer`, with unit tests on the simulated kernel.
- The processor's Playground shows backlog, packing back and each move's cost, with E2E tests for each.
- The File processor is measured again on the bench server, as in M3h, with each processor's load, backlog and move cost recorded and a "faults, then calm" mix. It's reported whatever it shows.

**Depends on:** [M3h](m3h-auto-placement.md): the balancer, `isolate:beat` and the processor example.

**Comes before:** [M4](m4-devtools-release.md). It doesn't block 0.1: the balancer is experimental and the core doesn't change.

## Decisions (grilling, 2026-11-17)

### Scope

1. **A small epic, now, before M4.** Only `@isoloop/balancer` and `apps/processor` change, with an [ADR 0017](../adr/0017-opt-in-balancer.md) amendment for the user. It ends with a re-run of the File processor measurement.

### Backlog

2. **The app reports the backlog,** on the host: `balancer.report(id, { backlog })`, a count of pending work items.
   - It works for any kind of work, not only consumer groups, and needs nothing from the core. The processor already counts each queue for its UI.
   - The bus reporting a consumer group's lag would need a new public bus API, and the isolate reporting from inside its worker would need a protocol change; both were set aside. A bus lag read can later feed the same `report` call.
3. **Placement only, no replicas.**
   - An isolate that falls behind gets more CPU: a pool with room, or at most a worker of its own.
   - Starting extra copies of a consumer-group member needs an app-declared replicable manifest and a way to generate ids, since ids are unique. It's in [would-like](../would-like.md).
   - In M3h's measurement a worker per processor did all 50 files a second, so placement alone covers the Firefox case.
4. **The backlog trigger.**
   - An isolate is behind when its reported backlog is higher at the end of a 10 s window than at its start, and isn't zero. A steady, non-zero queue doesn't trigger.
   - The balancer moves the isolate that's behind out of its pool, under the 60 % placement rule and the worker cap, like any other move. The reason is `backlog`.
5. **A group's backlog.** The backlog of a consumer group's topic belongs to the group, so the app reports it on every member. When several members are behind, the balancer moves one at a time, starting with the one in the busiest pool.
   - **Pacing** (amended 2026-11-17, M3i, to match isoloop#214): one backlog move per fresh 10 s window, across the balancer. Rising compares the latest report with one taken at least 10 s before it, both since the isolate's last move and since the last backlog move, rather than a report against now.
   - **Where it goes:** a pool of its own if the cap allows, else the balancer pool with the least load that stays under `headroom` with it and has less load than its pool-mates. An isolate already alone in its pool is `behind` instead.
6. **A stale report** (none for 10 s) counts as no signal: it doesn't trigger a move and doesn't block packing back. An app that stops reporting gets today's behaviour.
7. **Names:**
   - `balancer.report(id, { backlog })`;
   - the MoveReasons `backlog` and `pack`;
   - `balancer.on('behind', { id, pool, backlog })` when an isolate is behind but can't get more CPU, because it already has a pool to itself or the balancer has no pool or worker to give it. It fires at most every 30 s per isolate (amended 2026-11-17, M3i, to match isoloop#214).
   - Added with isoloop#214 (amended 2026-11-17, M3i): `on('spike', { id, pool, lagMs, action })`, with `action` `noted` for a first spike and `quarantined` for one that sends the member to the quarantine; and `on('arrived', { id, from, to, reason, costMs })`, which follows each `move` with its cost (decision 10).

### Packing back

8. **A steady member rejoins another pool.**
   - Steady means 60 s with no spike, crash, sustained or full trigger, and no growing backlog.
   - The move must empty the member's pool, so it frees a worker.
   - The combined predicted load must stay under 40 %, below the 60 % placement bar, so the pool it joins doesn't trip at once.
   - Never into a pool whose members have a backlog above zero, or one with a member moving or in trouble in the last 60 s (amended 2026-11-17, M3i, to match isoloop#214).
   - At most one pack every 60 s, across the balancer.
   - Never a held member, one whose backlog is above zero, or one the quarantine keeps apart.
   - The reason is `pack`.
9. **On by default, visual isolates included.** A packed visual widget goes blank until it redraws, behind the interactive pages' "Moving…" overlay, and frees a worker. `pack: { enabled: false }` turns it off. The plant and markets interactive pages keep the default.

### Fewer moves

10. **Three rules:**
    - A move only happens if it's predicted to end its trigger, meaning the source pool drops back under its threshold. Otherwise the isolate stays put.
    - Each isolate gets at most 3 moves per 5 minutes. After that it stays where it is until the window has passed.
      - **Exemptions** (amended 2026-11-17, M3i, to match isoloop#214): quarantine moves (`spike`, `crash`) and `bisect` moves aren't limited, since they protect the other members, though they count toward the 3. Leaving the quarantine is limited, so an isolate that has used its budget can stay in the quarantine longer than its quiet window.
    - Each move's cost is measured, from the stop until the first beat in the new place. `move` fires before the cost is known, so it comes in `arrived`, which follows each move with `costMs` (amended 2026-11-17, M3i, to match isoloop#214).
11. **A first spike is only reported** (`spike`, action `noted`; amended 2026-11-17 to match isoloop#214). A second spike from the same isolate within 60 s sends it to the quarantine.
    - This reverses M3h's instant quarantine on a single spike, decided on 2026-11-16.
    - The balancer only sees a spike after the long task has ended, since the beat that reports it arrives late. A one-off block is already over by then, and when the cause is the data, as with the processor's poison files, the next block hits a different member. An isolate that blocks again is caught on its second spike.
    - The cost: neighbours take one hit from a one-off block before anything moves.

### Workers

12. **The allowance's default stays as it is,** `max(2, navigator.hardwareConcurrency − 2)`. In a container, `hardwareConcurrency` can report the host's threads rather than the cores the container may use: 16 on the bench server, which pins 4. The balancer guide says to set `maxWorkers` there. The bench run sets `maxWorkers: 2`, what the default gives a real 4-core machine.

### The Playground

13. **What it gains:**
    - A **Jobs/s** slider on each task: jobs arrive at that rate, each costing what its CPU slider says, so a queue builds when the task can't keep up.
    - The task card shows its backlog.
    - The move log shows `backlog` and `pack` moves, `behind` events and each move's cost.
    - A **Calm** button sets every slider back to idle, to watch tasks pack back after 60 s.
    - **E2E tests:** a growing backlog is moved within about 15 s, a quiet task packs back after about 60 s, and a single spike doesn't quarantine while a second one does.

### Measured

14. **The File processor again,** with M3h's method: 80 runs, Chromium and Firefox, interleaved pairs against `own` and `one`, on a new `next` prerelease run by the user. That prerelease also ships isoloop#206, #208 and #209.
    - Each processor's load, its backlog and each move's cost are recorded, so no "why" is left open.
    - A third mix, **faults, then calm** (60 s of each), shows whether workers come back down.
    - The balancer runs with `maxWorkers: 2`, so at most 3 workers with the quarantine. The Firefox case has to be handled within that.
    - It's reported whatever it shows. The write-up says plainly whether the Firefox case was handled. The E2E tests are the pass/fail checks, not the figures.
    - [#211](https://github.com/isoloop/isoloop/issues/211) is still open, so the processor still puts held files back when it's stopped. The write-up separates the work that workaround repeats from what any restart repeats.

### Release

15. **`processor-v0.1.0` is M3h as it stands.** M3i ships as `processor-v0.2.0` with its own write-up. The plant and markets interactive pages pick it up in their next minors. The user pushes the tags.

## Tasks

| # | Task | Repo | Review |
| --- | --- | --- | --- |
| 1 | This plan, the roadmap row, the would-like entries, and the ADR 0017 amendment (decisions 2–11) | isoloop | User |
| 2 | `@isoloop/balancer`: `report` and the backlog trigger, the stale rule and groups one member at a time, `behind`, the MoveReasons `backlog` and `pack`; the fewer-moves rules and each move's cost; the second-spike quarantine; packing back and `pack: { enabled }`; unit tests on the simulated kernel for each; the balancer guide and README (decisions 2–12) | isoloop | Self-merge on green, after task 1's amendment is accepted |
| 3 | A `next` prerelease with task 2 and #206, #208 and #209 | isoloop | Run by the user |
| 4 | The Playground: the Jobs/s slider, backlog on the card, the move log's new entries and move cost, the Calm button; E2E (decision 13) | web | Self-merge on green, after task 3 |
| 5 | The File processor reports each group's backlog on every member; the comparison records each processor's load, its backlog and each move's cost, adds the "faults, then calm" mix, and runs the balancer with `maxWorkers: 2` (decision 14) | web | Self-merge on green, after task 3 |
| 6 | The bench-server run | web | Self-merge on green, after task 5 |
| 7 | The write-up, in the results page layout (findings first, then the tables, then details) | web | User |
| 8 | Roadmap: M3i done; `processor-v0.2.0` and the plant and markets minors | isoloop, web | User pushes the tags |

Tasks 4 and 5 can run in parallel.

## Risks

- **The backlog is only as good as the app's report.** A count that doesn't reflect the work (items of very different sizes, a queue the app can't see) can move the wrong isolate, or none. The predicted-load rule and the move budget bound the cost of a wrong report.
- **Packing back and moving out can flap.** The 40 % bar against 60 %, the 60 s steady window and one pack per minute keep them apart, but a load that swings on a timescale near a minute can still cause a move each way.
- **A second spike is a second hit.** A neighbour of an isolate that blocks takes one long task before anything moves, where M3h moved at once.
- **Moves are still restarts.** Fewer of them doesn't make each one cheaper; a make-before-break `kernel.move()` stays in would-like.

## Follow-ups

- **Replicas**, the balancer starting extra copies of a consumer-group member, are in [would-like](../would-like.md).
- A **bus lag read** for consumer groups could feed `report` automatically, if the bus gains one.
- [#211](https://github.com/isoloop/isoloop/issues/211)'s fix lets the processor drop its put-back workaround, and so the extra work it adds to each move.
