# The plant dashboard's `one` placement: slow app code and slow recovery

**Status:** investigation, 2026-11-11. Follows [plant-cpu.md](plant-cpu.md), which left two `one` readings unexplained.

**Answer:**

1. **The app's own code runs 1.4–2.5× slower in every pool, because of the pool's frozen built-ins.** The cost isn't `Object.freeze`. It's one accessor: the pool worker turns `Array.prototype[Symbol.iterator]` into a getter, as it does every inherited data property (M2c task 7, ADR 0001 "M2c as built"). V8 then leaves its fast path for `for…of`, spread and destructuring over arrays. The plant's feeds and engines use those on every record. This is fixable in `packages/runtime/src/freeze.ts` without giving up frozen built-ins.
2. **`one` recovers more slowly after a long hold because its restart replays more history, all on one thread.** After a restart, every member that subscribes from `'earliest'` gets the whole retained topic again: 5 minutes of slow signals and of health. In `one` those replays run on the same thread as the feeds and FFT engines, ahead of their live data. So every machine's spectra resume 2.4–2.6 s later after 5–10 minutes than after 20 s. The pool's restart itself takes the same ~0.4 s at every hold. The volume is fixable, by replaying only the tail a member needs. Sharing one thread across every member is what `one` is.

## How it was measured

On the benchmark server: AMD Ryzen 7 5825U, 4 physical cores pinned (`--cpuset-cpus=2,4,6,8`) and fixed at 2.0 GHz, other containers paused. Playwright's image `v1.64.1-noble` (Chromium 156), isoloop/examples at `8f22ce0` with `@isoloop/*@0.0.0-next.61245db`. The probes are in [assets/plant-one-pool/](assets/plant-one-pool/), and their outputs in its `results/`.

## 1. Frozen built-ins slow the app's own code

### The reading

[plant-cpu.md](plant-cpu.md) found the app's feeds and engines at 96 ms/s in `one` at 5 kHz, against 62 on native's main thread. In its saved profiles the gap shows up by name. In the pooled builds, the V8 samples show `push` (the stats engine's window), `hash01` and `gauss` (the generator's noise), `spectrumOf` and `summarize` as their own frames, at 5–42 ms/s each. In native and native + workers, those functions don't appear, and their time sits inside `vibChunk` and `fft`, as inlined code would (`fns.mjs`).

### The benchmark

The plant's real feed and engine code for eight machines (`vibChunk`, `scalarsAt` and `runMachineEngines` on the native build's `Store`) was driven flat out in one dedicated worker, warmed up first, with or without the pool's freeze. The work is the same in every variant, and the variants ran in alternating order (`freeze-bench.ts`, `freeze-run.mjs`).

| Variant, 5 kHz | ms per simulated second, 8 machines | × plain |
| --- | --- | --- |
| plain worker | 39.5 | 1.00 |
| `freezeBuiltins()` as built | 61.0 | **1.54** |
| `Object.freeze` everything, no accessors | 39.5 | 1.00 |
| accessors everywhere, no `Object.freeze` | 61.1 | 1.55 |
| accessors on `Array.prototype` only | 60.0 | 1.52 |
| accessors on `Map`/`Set`, typed arrays, or `Object`/`Function` only | 39.5–39.6 | 1.00 |

With 60 s of warm-up and measurement instead of 30 s, so that the 60 s stats windows are full, the gap is wider: 42.0 against 99.0 ms per simulated second at 5 kHz (×2.36), and 9.2 against 22.9 at 1 kHz (×2.50). Every variant's spread across rounds was under 2%.

Then one `Array.prototype` property at a time, measured as ratios on the development machine (`keys-bench.ts`):

| Accessor on | × plain |
| --- | --- |
| every property | 1.41–1.43 |
| `Symbol.iterator` | **1.40** |
| `values`, `push`, `shift`, `splice`, `slice`, `indexOf`, `includes`, `map`, `forEach`, `reduce`, `filter`, `sort`, `at`, `fill` | 0.98–1.00 |

**Cause:** V8 iterates arrays fast in `for…of`, spread and destructuring only while `Array.prototype[Symbol.iterator]` is still the original function, a check V8 keeps as a "protector". `tameOverrides` replaces it with an accessor that returns the same function, and that alone is enough to lose the fast path. The plant iterates small arrays on every record, for example `for (const k of SCALARS)` and `for (const m of MACHINES)`, and so does any code written the usual way. `Object.freeze` on its own costs nothing measurable.

### Why `matched` didn't show it in the profile

`matched`'s data pools are pools too, so they're frozen. The benchmark says they should pay the same factor, yet [plant-cpu.md](plant-cpu.md)'s per-module split had `matched`'s feeds and engines equal to native + workers (57 against 57 ms/s). The raw samples disagree with that split: pooled builds show the separate non-inlined frames above, in `matched` as much as in `one`. The likeliest explanation is that splitting each thread's JS time by sample share mis-weighted the lightly loaded data-pool threads. That's not verified. The re-measurement after the fix should take the per-module figure for `matched` from the same benchmark, not only from the profile.

### Fix

- **Change:** keep `Object.freeze` on every intrinsic, and narrow `tameOverrides`. Leave the iteration protocol as data properties: `Symbol.iterator` on `Array.prototype` and `%TypedArray%.prototype`, and `next` on the array, map, set and string iterator prototypes. More generally, tame only the names code commonly assigns on instances (`toString`, `valueOf`, `toLocaleString`, `toJSON`, `constructor`, `name`, `message`), as Hardened JS's "moderate" override taming does, rather than every data property.
- **What stays:** patching a built-in prototype still fails, which is what M2c task 7's freeze is for.
- **What changes:** in strict code, assigning an inherited property that isn't on the list, for example `arr[Symbol.iterator] = f` or `obj.push = f` where `obj` inherits from `Array.prototype`, throws instead of defining an own property: the "override mistake" for those names. It's a small cut to a feature, so under the agreed rule it goes to the user on its own.
- **Estimated saving:** the app's feeds and engines in `one` from about 96 to about 62 ms/s at 5 kHz, about −34 ms/s or 3 percentage points of one core. Something similar applies in every other pool. Other pooled JS that iterates arrays, such as widgets, React in workers and the runtime's own code, should gain too, but that isn't measured.
- **ADR:** [ADR 0001](../adr/0001-one-worker-per-isolate.md)'s "M2c as built" says inherited data properties are all turned into accessors. That line would change. [ADR 0015](../adr/0015-visual-pools.md) decision 6 refers to the frozen built-ins and is unaffected.

## 2. Recovery after a long hold

### The reading

In the comparison's 10-minute sessions, `one` recovered from the 3 s block in 5.5 s, with a 5.6–5.9 s data gap on every machine, against 3.4–3.5 s early in a run. Both happened before and after the timings fix. The other placements didn't change.

### The probe

`one`, 1 kHz, Chromium. After holds of 20 s, 2, 5 and 10 minutes:
- the probe counted each topic's retained records through a host subscription from `'earliest'`
- it blocked T3's gauges for 3 s
- it logged the kernel's `isolate:crash`, `isolate:ready` and `isolate:state` events
- it noted when each machine's spectra resumed

One run per hold, plus a second at 20 s and at 10 min (`restart-probe.mjs`). Times are from the click.

| Hold | Pool killed | 105 members ready | Spectra resume (all 8 machines) | Ready → spectra | T3 scalars retained | T3 health retained | Alarms / events retained |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 20 s | 2.03–2.07 s | 2.44–2.47 s | 3.43–3.65 s | 1.0–1.2 s | 94 | 18 | 0–8 / 0–8 |
| 2 min | 2.07 s | 2.55 s | 4.12 s | 1.6 s | 594 | 118 | 14 / 14 |
| 5 min | 2.02 s | 2.43 s | 6.05 s | 3.6 s | 1,493 | 298 | 12 / 19 |
| 10 min | 2.07–2.08 s | 2.46–2.48 s | 5.89–6.14 s | 3.4–3.7 s | 1,524 | 305 | 48–69 / 62–75 |

What the figures show:
- **The pool's restart doesn't change with the hold.** The kernel kills it after its 2 s heartbeat limit, and all 105 isolates are running again 0.4 s later.
- **What grows is the time from ready to the first spectrum.** It's 1.0–1.2 s at 20 s, and about one second of that is the FFT filling its 1,024-sample window at 1 kHz. It grows with the slow-signal and health topics and stops growing once they reach their 5-minute retention. Raw vibration and spectra are full at 30 s, and alarms and events stay small, so neither tracks it.
- **Where the replays go:** after a restart, the members that subscribe from `'earliest'` receive everything retained:
  - each machine's stats engine and temperature trend: all 5 minutes of `scalars`
  - the fleet engine: all 5 minutes of each machine's `health`
  - the fleet and alarm widgets: their topics' history

  At 5 minutes that's about 24,000 scalar rows and 2,400 health records. That's about 26,000 more replayed records than after 20 s, for about 2.5 s more, roughly 95 µs per record, all on the one pool thread, ahead of the feeds' and FFT engines' live records. In `matched`, a block restarts only the widgets' pool, and the feeds and engines keep running in theirs, so spectra never stop.
- **Most of the replay isn't needed:**
  - the stats engine keeps a 60 s window (`STATS_WINDOW_MS`) but receives 5 minutes
  - the trend keeps 600 rows (2 minutes) of 1,524
  - the fleet engine keeps 2 minutes (`FLEET_WINDOW_MS`) of 5 minutes of health
- **Frozen built-ins also slow the replay,** since the stats engine's handler is one of the slowed paths (finding 1).

(The probe's own recovery reading came back empty because its selectors don't reach into the widgets' shadow roots. The spectra and kernel events above don't depend on it.)

### Fix

- **Replay only the tail a member needs.** Add a start position by age, for example `from: { since: 60_000 }` for "records from the last 60 s", and possibly by count, `{ last: 600 }`.
  - **Why it's cheap:** time-retained topics are in time order, so the broker can find the start without reading the rest.
  - **The app's side:** stats would ask for 60 s, the trend for 600 rows, and the fleet engine for 2 minutes.
  - **Estimated saving:** at 5 minutes, about 26,500 replayed records fall to about 8,200, so spectra would resume about 1.7 s sooner, at about 4.3 s instead of 6.0 s. With finding 1's fix, each record is also cheaper.
  - **It loses nothing:** a member gets exactly the history it keeps.
  - **The protocol side:** it's a new `StartPosition` (`packages/protocol/src/bus.ts:30`), an addition to the bus's subscribe options and to `ctx.bus.subscribe`, so it needs an ADR. The bus's start positions are recorded with the routing ([ADR 0002](../adr/0002-host-owns-routing.md)) and supervision ([ADR 0007](../adr/0007-bus-worker-supervision.md)) decisions.
- **App-only alternative:** shorten `scalars` and `health` retention to what the widgets show (2 minutes). That's smaller, has no library change, and keeps less history for every subscriber.
- **Not proposed:** giving live records priority over replays inside a pool, so a restart's catch-up can't delay a feed. That would change the order in which the bus client hands a pool its deliveries, which is a larger change than the tail start, and the tail start removes most of the delay on its own.
- **What stays inherent:** in `one`, a block stops and restarts every machine's feed and engines. That's the blast radius of putting everything in one pool. The comparison already reports it, as the data gap on every machine, which native has too.

### The app-only fix, measured

The user chose the app-only alternative: `scalars` and `health` keep 2 minutes, the longest window any reader needs (examples [#64](https://github.com/isoloop/examples/pull/64), `d5391e4`). Its `retention.test.ts` ties the retention to the trend's, the stats engine's and the fleet engine's windows, so it can't drop below them unnoticed. The library's tail start (`{ since }`) is left for M3e.

Same probe and settings as above, on the benchmark server: 4 physical cores fixed at 2.0 GHz, `@isoloop/*@0.0.0-next.d028bc1`. The runs alternated between examples `origin/main` before the fix (`4614a4a`) and the fix branch (`41a3a75`), 3 rounds each, every run after a 5-minute hold. Times are from the click (`results/retention-2min/`, `retention-2min-run.sh.txt`).

| | Pool killed | 105 members ready | Spectra resume (all 8 machines) | Kill → spectra | T3 scalars retained | T3 health retained |
| --- | --- | --- | --- | --- | --- | --- |
| Before (5 min) | 2.02–2.06 s | 2.43–2.80 s | 5.70–5.76 s | 3.6–3.7 s | 1,493–1,494 | 298 |
| After (2 min) | 2.04–2.09 s | 2.48–2.66 s | 4.02–4.09 s | 1.9–2.0 s | 624–625 | 124–125 |

- **Spectra resume about 1.7 s sooner,** 4.0–4.1 s against 5.7–5.8 s, as the estimate above expected. The rounds don't overlap.
- **The restart itself is unchanged:** the kill comes at about 2.0–2.1 s, and all 105 members are ready again 0.35–0.75 s later.
- **The replay is what shrank:** T3's retained `scalars` fell from about 1,494 rows to 624, and `health` from 298 to 125. That's the same for every machine.
- **What's left** is mostly the FFT filling its 1,024-sample window (about 1 s at 1 kHz) and 2 minutes of replay. The tail start would take the stats engine down to 60 s of it.
