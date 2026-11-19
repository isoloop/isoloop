# M3j: Balancer gaps

**Status:** in progress (grilled 2026-11-17; decisions 14–17 added 2026-11-18, 18–21 after the bench run the same day, and 22–25 after the re-run on 2026-11-19). An amendment to [ADR 0017](../adr/0017-opt-in-balancer.md) was accepted on 2026-11-17, a second (decisions 14–16) on 2026-11-18, and a third (decision 22) is proposed. An amendment to [ADR 0016](../adr/0016-fewer-messages-per-record.md) (decision 18) was accepted on 2026-11-18 and shipped in `0.1.0-next.3`. The balancer change is built in `isoloop/isoloop`, and the processor changes and the measurement in `isoloop/web`. M3j ships as a `0.1.0-next.N` prerelease, then `processor-v0.3.0`, tagged by the user.

**Goal:** `@isoloop/balancer` sees work its busy time misses, packs quiet members back while work keeps arriving, lets members out of the quarantine, and stops placing or reviving an isolate the kernel has given up on.

**Why:** M3i's measurement of the File processor ([write-up](https://github.com/isoloop/web/tree/main/apps/processor/comparison/v0.2.0)) found three gaps in the balancer itself. It was run on 4 cores at 2.0 GHz, with 50 files a second, `maxWorkers: 2` and 116 runs:
- **Most of a processor's work is out of the busy time's sight.**
  - A processor resumes each slice of a file after `await`. `busyMs` doesn't count promise continuations ([ADR 0017](../adr/0017-opt-in-balancer.md) decision 2, point 7), so each processor measured 0 to 8 % of a core. `own` used 139 % of CPU across threads on Chromium.
  - The full-pool trigger (80 % of a core) never fired. A slow pool's lag wasn't explained by its members' busy time (the 50 % rule), so the balancer bisected instead.
  - With faults, a run had a median of 13 moves on Chromium and 25 on Firefox, mostly bisects and quarantine moves.
- **Packing back never happened:** 0 packs in 36 runs. After 60 s of faults and 60 s of calm, the balancer still used 4 workers, and 4 to 7 of the 8 processors were still in quarantine pools. Three things kept them there:
  - The 60 s calm was shorter than packing can act in. An offender's quiet window doubles with each offence and never comes down (`steadyFor`, `packages/balancer/src/balancer.ts`). After that, packing needs another 60 s of steady running.
  - Packing only moves a member out of a balancer pool, never out of a quarantine pool (`pack`, same file).
  - Packing skips a member or pool whose backlog is above 0, and a group with files arriving rarely has a backlog of exactly 0.
- **3 of the 23 runs with faults lost files** (989, 262 and 1,067 files without a result). In each, the kernel had given up on 2 to 6 processors. `own` and `one` lost none.
  - The kernel gives up on an isolate at its 4th crash within 60 s (`maxRestarts: 3`, `withinMs: 60_000`, `packages/host/src/supervisor/machine.ts`).
  - When a pool's worker stops responding or errors, every member of that pool crashes and counts it (`poolFate`, `packages/host/src/kernel.ts`). A poison file in a shared pool gets that worker killed about every 10.5 s, so every member in it is given up on within about 32 s.
  - At the worker cap, a bisect has no quarantine pool of its own to use, so it keeps adding suspects to `balancer-quarantine-1` (`search`, `balancer.ts`). That pool held 5 to 7 of the 8 processors at some point in each of the three runs.
  - The balancer doesn't listen to `isolate:failed`. A given-up member stays in its pool's load and in a bisect's suspects, and a later move (`stop`, then `spawn`) silently restarts it.
  - That run was on `0.0.0-next.800569e`, which still had [#211](https://github.com/isoloop/isoloop/issues/211), a group commit that could cover a redelivered record. #211 is the likely cause of the loss, and `0.1.0-next.0` fixes it. That's not proven: the run didn't record which processors were given up on.

As in M3i, the balancer is `@experimental`, outside the core, and builds only on the public kernel API. Everything here is inside the balancer and the processor example. The kernel, protocol and bus don't change.

**Done when:**
- `report(id, { busyMs })`, packing while the backlog is steady, offence decay, bisects only with their own quarantine pool, and the handling of `isolate:failed` are in `@isoloop/balancer`, with unit tests on the simulated kernel.
- The processor's Playground shows each task's busy time both ways and the `failed` state, with E2E tests for each.
- The File processor with faults on the balancer leaves no file without a result, in an E2E test and on the bench server.
- The File processor is measured again on the bench server, on `0.1.0-next.N` without the #211 workarounds, with a 5-minute calm phase. It's reported whatever it shows.

**Depends on:** [M3i](m3i-balancer-scaling.md): the backlog report, packing back and the move budget.

**Comes before:** [M4](m4-devtools-release.md). It doesn't block 0.1: the balancer is experimental and the core doesn't change. It can run alongside [M4a](m4a-agents.md).

## Decisions (grilling, 2026-11-17)

### Scope

1. **A small epic, alongside M4a.** Only `@isoloop/balancer` and `apps/processor` change, with an [ADR 0017](../adr/0017-opt-in-balancer.md) amendment for the user. It ends with a re-run of the File processor measurement.

### Busy time

2. **The app reports the busy time it measures:** `balancer.report(id, { backlog, busyMs })`.
   - The processor already times each slice of a file, so it knows its work time even when the runtime doesn't.
   - The balancer uses the larger of the beat's `busyMs` and the reported figure for the same window.
   - A sustained-lag bisect (the 50 % rule) runs only when the reported time can't explain the lag either.
   - **Not taken: the kernel counting promise continuations.** It would need `AsyncContext` to carry the member across `await`, and no browser ships it. It's in [would-like](../would-like.md).
3. **`busyMs` in a report is a running total:** milliseconds of work since the isolate started.
   - The balancer takes its difference over the 3 s window, like the beat's.
   - A running total survives a late or missed report, where a figure per interval would lose that interval's work.
   - As with the backlog, a report with nothing new for 10 s counts as no signal.

### Packing back

4. **"No backlog" becomes "a backlog that isn't rising".**
   - A member can pack, and a pool can take one, when the backlog didn't rise during the 60 s steady window. Today the backlog has to be exactly 0.
   - The 40 % bar, one pack a minute and the move budget still guard against moving back and forth.
5. **Leaving the quarantine:**
   - **Offences decay.** A member loses one offence for each quiet window it completes, so a member that stays quiet goes back to the 30 s window.
   - **The quiet window is capped at 2 minutes.** Today it doubles without limit: 30, 60, 120 s and so on.
   - **Members a bisect moved leave when the bisect ends,** whether the culprit was found or the bisect was forgotten.
   - **Packing also takes members leaving the quarantine:** a pool whose only members are free to leave counts as a source. The member joins a pool that fits, so the quarantine worker can be freed.

### The quarantine and given-up isolates

6. **The kernel stays as it is.** When a pool's worker is killed, every member really does restart, so counting it against each is right. The balancer avoids the pile-up instead (decision 7).
7. **A bisect only with a quarantine pool to itself.**
   - A bisect starts only when the quarantine is empty, or the cap leaves room for a new quarantine pool.
   - Suspects never join a quarantine pool that holds offenders.
   - With no room, the pool stays as it is and the balancer reports `behind` for it.
   - With decision 2's reported busy time, most slowdowns have a named culprit, so bisects should be rare.
8. **The balancer handles `isolate:failed`.**
   - A member the kernel gave up on gets the `failed` state in `placements()`.
   - It leaves its pool's load, the quarantine and any bisect.
   - A move never restarts it.
   - `on('failed', { id, pool, reason })` reports it. Restarting it is the app's choice (`kernel.restart(id)`), and the balancer then places it again as new.

### Lost files

9. **Settled by test first.**
   - An E2E test runs the File processor with faults on the balancer, on `0.1.0-next.N` without the #211 workarounds (removed in web#151), and expects no file without a result.
   - The bench re-run (decision 11) checks the same and records which processors were given up on.
   - If files are still lost there, a diagnosis task blocks M3j from closing.
   - The task also checks the job topic's retention, since a backlog that outlasts it loses files by design.

### The Playground

10. **What it gains:**
    - **An "after await" switch** on each task: its CPU runs in slices resumed after `await`, like the processor's. The task then reports its own busy time.
    - **The task card shows both busy times:** the beat's and the reported one.
    - **The move log shows `failed`.**
    - **E2E tests:**
      - an "after await" task that reports its busy time is moved by the full-pool trigger;
      - an offender leaves the quarantine within 2 minutes;
      - a task packs back while jobs keep arriving at a steady rate;
      - a failed task shows `failed` and no move brings it back;
      - the File processor with faults leaves no file without a result (decision 9).

### Measured

11. **The File processor again**, with M3i's method and mixes, on `0.1.0-next.N`:
    - without the #211 workarounds;
    - with the processor reporting `busyMs`;
    - with a 5-minute calm phase in "faults, then calm", so packing back has time to act;
    - recording the workers once a second, and which processors the kernel gave up on, and their kind.
    - It's reported whatever it shows.

### Release

12. **`processor-v0.2.0` is M3i as it stands,** once the user has reviewed its write-up (web#150). M3j ships as `processor-v0.3.0`. The user pushes the tags.
13. **Tasks follow M3i's shape** (below). Tasks 4 and 5 can run in parallel. Web PRs need a changeset or the `no-changeset` label, plus a "Site impact:" line ([web ADR 0004](https://github.com/isoloop/web/blob/main/docs/adr/0004-publishing-and-governance.md)).

### Found before the bench run (2026-11-18)

Tasks 4 and 5 were done on 2026-11-18 (web#155, web#158). A local smoke run of the comparison's "faults, then calm" mix on the balancer (`@isoloop/*@0.1.0-next.1`, Chromium via Playwright on a dev machine, `maxWorkers=2`, one run, not a measurement) lost no files and gave up on no processors. But it showed three things in `@isoloop/balancer` that the bench would have measured again:

- A processor stayed in the quarantine for about 250 s, past decision 5's 2-minute cap. Its way out after its first measurement at boot counted toward the move budget, so one `full` move and one spike quarantine used it up.
- No pack in 5 minutes of calm: two pools of 4 processors at about 16 % each, and packing only moves an isolate alone in its pool.
- Backlog moves kept coming at a steady 50 files a second (at 209 s, 220 s and 306 s, in the calm), each restarting the 60 s steady clock packing needs.

14. **A never-measured isolate's way out of the quarantine doesn't count toward the move budget.** Its next moves count as usual, and one that offends in the quarantine before it's measured loses the exemption.
15. **Packing empties whole pools:** a pool whose members are all steady and packable empties into the fullest other pool that stays under 40 % with all of it, one member per pack (the lightest first), finishing a merge before starting another. The existing checks stay: a backlog not rising and 60 s steady on both sides, one pack a minute and the move budget. If it flaps, the bench shows it.
16. **A backlog move needs the backlog to rise over two 10 s windows in a row,** so a queue that jumps once and holds doesn't move anything. A move now comes about 20 s after a backlog starts growing, not 10 s.
17. **Fixed before the bench run,** so one run measures them: a balancer PR (task 2b), a `0.1.0-next.2` prerelease run by the user (task 3b), and web on it (task 5b).

### Found by the bench run (2026-11-18)

Task 6 ran on hauseserver from 10:13 to 13:58 UTC on web `601bfb8` (`@isoloop/*@0.1.0-next.2`, 4 cores at 2.0 GHz, `maxWorkers=2`, Chromium and Firefox). All 98 pages ran. The normal mix lost no file in any configuration. With faults, the balancer lost files in all 16 of its runs: about 480 a run, and about 4,450 in the calm runs. `own` and `one` gave up on no processor. In every balancer run the kernel gave up on both image processors, within about 10 s (in one Firefox run, on both hash processors too), and no image file got a result after that. The results weren't published.

The diagnosis ran on the same server (`~/bench/diag-run.sh`). Without bench mode, at full clock speed, it didn't reproduce; at 2.0 GHz it did, on every run:
- The corrupt file `1-74` crashed image-2 about 2 s in, as corrupt files do once their result is out. Then it came back, to image-1 and to image-2 in turn, 8 or 9 crashes in about 8 s, until the kernel gave up on both (4 crashes within 60 s each).
- The cause is ADR 0016's point 12: a group commit covers a delivery only once all its records are settled. Running behind, the processors got their files in batches, and `1-74` was settled first in its batch. Its commit covered nothing, so the batch went back to the group.
- The balancer made it likely without causing it: it starts every never-measured processor in one quarantine pool ([ADR 0017](../adr/0017-opt-in-balancer.md), decision 5), so for about 3 s eight processors share one worker and fall behind. Any placement that falls behind enough to get batches can hit it. A processor's own crash stays its own (`poolFate` restarts the pool only for a worker that stops beating or errors), so its neighbours weren't taken down.

18. **The bus fix:** a commit also covers the settled first records of a partly settled delivery (ADR 0016, point 17, amended). In `@isoloop/protocol`, `@isoloop/bus` and `@isoloop/runtime`, with a test that fails without it (task 2c).
19. **A record that crashes every member before it's settled** still comes back to each of them until the kernel gives up on all of them (ADR 0016, point 18). A known limitation, with a dead-letter topic in [would-like](../would-like.md); not M3j.
20. **The balancer's start stays as it is:** never-measured processors share one quarantine pool until they're measured. The bus fix alone stops the loss. If the re-run shows harm at start-up, it's a follow-up.
21. **The bench runs again in full** on `0.1.0-next.3` (task 6b), about 3.5 h, so v0.3.0 is one run. The write-up (task 7) reports that run, and this one and its bug in its details.

### Found by the re-run (2026-11-18)

Task 6b ran on hauseserver from 16:48 to 20:04 UTC on web `2b7e4d6` (`@isoloop/*@0.1.0-next.3`), set up as before. All 98 pages ran.

- **No file was lost.** In all 16 balancer runs with faults (10 fault runs and 6 faults-then-calm runs), on both engines, every file produced got a result, and the corrupt file was reported each time. In the faults-then-calm runs the balancer did 50.1 files a second on 3 or 4 workers, against `own`'s 9, with a p95 of 66 to 124 ms against `own`'s 37 to 51 ms.
- **The fault runs were slow:** a p95 of 8.5 to 20 s, against `own`'s 0.4 to 0.6 s, with up to 722 files queued when the generator stopped and up to 31 s to drain them. On next.2 the files behind the given-up processors never finished, so they weren't in its p95.
- **The cause is the cap, not the work.** The corrupt file crashes each image processor once, so both go to quarantine. The quarantine lags, and a bisect gives image-2 a second quarantine pool, which counts toward `maxWorkers: 2`. With `balancer-1`, that fills the cap. The other processors are left sharing one worker (all six of them in 4 of the 10 fault runs) and fall behind: their backlog peaks between 38 and 457, and the balancer reports them `behind` 4 to 12 times a run, with nowhere to move them. On next.2 this was hidden: the given-up image processors freed their workers.
- **One `ready-timeout`:** in 1 of the 16 runs (Firefox, faults), a restarted image processor sent no `ready` within 10 s, alone in its pool, and the kernel gave up on it. The other image processor did every file.

22. **A rising backlog outranks a second quarantine worker** ([ADR 0017](../adr/0017-opt-in-balancer.md), decision 5, amended): a quarantine pool of offenders beyond the first folds into the first, with the move reason `room`, and for 10 s no new quarantine pool takes a freed worker. A bisect's suspects never fold in with offenders (task 2d).
23. **The `ready-timeout` is a spike, later:** seen once in 16 runs, its cause isn't clear from this data. It doesn't block M3j. The inspection feed (M4b) can show what the worker was doing.
24. **The dead-letter topic stays in [would-like](../would-like.md)** (decision 19). The write-up names the limitation.
25. **Release `0.1.0-next.4` and re-run only the fault mixes** (tasks 3d, 5d, 6c), about 2.5 h. The normal and faults-then-calm runs on next.3 had no losses and no trouble, so the write-up reports them from task 6b and the fault runs from task 6c.

## Tasks

| # | Task | Repo | Review |
| --- | --- | --- | --- |
| 1 | This plan, the roadmap row, the would-like entry, and the ADR 0017 amendment (decisions 2–8) | isoloop | User |
| 2 | `@isoloop/balancer`: `busyMs` in `report`, the max with the beat's and the stale rule; the 50 % rule using it; packing on a backlog that isn't rising; offence decay, the 2-minute cap, bisect members leaving when it ends, and packing out of the quarantine; bisects only with their own quarantine pool, else `behind`; `isolate:failed`, the `failed` state and event; unit tests on the simulated kernel for each; the balancer guide and README; a changeset (decisions 2–8) | isoloop | Self-merge on green, after task 1's amendment is accepted |
| 3 | A `0.1.0-next.N` prerelease with task 2 | isoloop | Run by the user |
| 4 | The Playground: the "after await" switch, both busy times on the card, `failed` in the move log; the File processor reports each processor's `busyMs`; E2E (decisions 9–10) | web | Self-merge on green, after task 3 |
| 5 | The comparison: a 5-minute calm phase, workers once a second, the given-up processors and their kind; the job topic's retention checked (decisions 9, 11) | web | Self-merge on green, after task 3 |
| 2b | `@isoloop/balancer`: decisions 14–16, with unit tests, the guide, README and a changeset | isoloop | Self-merge on green, after the amendment is accepted |
| 3b | A `0.1.0-next.2` prerelease with task 2b | isoloop | Run by the user |
| 5b | web on `0.1.0-next.2`; the Playground's backlog E2E allows for two windows | web | Self-merge on green, after task 3b |
| 6 | The bench-server run | web | Self-merge on green, after tasks 4, 5 and 5b |
| 2c | The bus fix: a commit covers the settled first records of a partly settled delivery, with tests and a changeset (decision 18, [#256](https://github.com/isoloop/isoloop/pull/256)) | isoloop | Self-merge on green, after the ADR 0016 amendment is accepted |
| 3c | A `0.1.0-next.3` prerelease with task 2c | isoloop | Run by the user |
| 5c | web on `0.1.0-next.3` | web | Self-merge on green, after task 3c |
| 6b | The bench-server run again, in full (decision 21) | web | Self-merge on green, after task 5c |
| 2d | `@isoloop/balancer`: decision 22, with unit tests on the simulated kernel, the guide and a changeset ([#268](https://github.com/isoloop/isoloop/pull/268)) | isoloop | Self-merge on green |
| 3d | A `0.1.0-next.4` prerelease with task 2d | isoloop | Run on the user's word |
| 5d | web on `0.1.0-next.4` | web | Self-merge on green, after task 3d |
| 6c | The bench-server run of the fault mixes only (decision 25) | web | Self-merge on green, after task 5d |
| 7 | The write-up, in the results page layout (findings first, then the tables, then details) | web | User |
| 8 | Roadmap: M3j done; `processor-v0.3.0` | isoloop, web | User pushes the tag |

## Risks

- **A reported busy time is only as good as the app's timing.** An app that times too little looks light, as today. One that times too much looks heavy and moves more. The predicted-load rule and the move budget bound the cost of a wrong report.
- **Decay lets a repeat offender back sooner.** A member that offends once every few minutes now returns after 30 s each time, where it used to wait longer each time. `kept-apart` after the fourth offence still applies while the offences last.
- **Packing with a backlog can bounce.** A packed member whose queue then rises triggers a backlog move out. The 40 % bar, the 60 s steady window and the move budget keep that to a move each way at most a few times in 5 minutes.
- **Fewer bisects can mean slower culprit-finding.** With no quarantine pool free, a slow pool waits as `behind`, rather than being split.
- **The lost files may not be #211's.** If the E2E test or the re-run still loses files, M3j stays open for a diagnosis task. (They weren't: the bench run found ADR 0016's point 12, decision 18.)
- **The re-run may still lose files.** If it does, M3j stays open for another diagnosis. (It didn't: task 6b lost none.)
- **Folding the quarantine puts offenders together.** One that blocks takes the others in the first quarantine down with it, and each counts a crash. That was already so for offenders sharing it; the fold only adds those from a second pool.
- **A `ready-timeout` may come back** under load (decision 23). If it does more than once, it moves up.

## Follow-ups

- **The `ready-timeout` spike** (decision 23).
- **The kernel counting promise continuations** with `AsyncContext`, once browsers ship it ([would-like](../would-like.md)).
- **Replicas**, which M3i left for later, are still in [would-like](../would-like.md).
- **Restart settings per isolate** ([would-like](../would-like.md), Supervision) would let an app give pool members a looser crash-loop guard. M3j doesn't need it.
