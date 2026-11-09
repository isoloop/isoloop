# Worker pools

By default every isolate gets its own worker ([ADR 0001](../adr/0001-one-worker-per-isolate.md)): its own thread, heap and copy of the runtime, so one isolate that blocks or crashes affects only itself. A **pool** puts several headless isolates in one worker instead. It saves memory and start-up time, and gives up isolation between the members.

```ts
kernel.spawn({ id: 'feed-t1', src: feedUrl, pool: 'machine-t1' });
kernel.spawn({ id: 'stats-t1', src: statsUrl, pool: 'machine-t1' });
kernel.spawn({ id: 'alerts', src: alertsUrl }); // its own worker
```

Placement belongs to the host: the isolate's code is the same either way, and an isolate can't ask for a pool or refuse one. The pool's worker starts with its first member and goes away after its last.

## What it saves

Measured for 20 small headless isolates, own workers against one pool ([bench/pools](../../bench/pools/README.md), 2026-11-08): 71–86% less memory and 2–3 times faster start-up on Chromium, Firefox and WebKit. Each worker's fixed cost (thread, engine instance, loaded code) is paid once per pool instead of once per isolate. Isolates with large state of their own save a smaller share, because that state costs the same in a pool. CI reports these numbers on every bench run.

## What members share

- **An event loop.** A member that runs a long computation delays every other member's records and timers. Keep heavy work in its own worker.
- **Fate.** If a member stops responding or its worker errors (an exception from a timer, say), every member crashes with it and the pool restarts in a new worker. Each member's `isolate:crash` names the `pool`, and the message names the member that caused it. Each member then reads on from its committed offsets, so records it had read but not committed come again (at least once, as after any restart). A member's own fatal error (`start()` throwing, a ready timeout, a version mismatch) crashes only that member.
- **Globals.** Members run in the same realm. A pool worker freezes the built-ins before its first member loads, so `Array.prototype.x = …` throws instead of changing arrays for the neighbours; overriding an inherited property on your own objects (`this.name = 'MyError'`) still works. Other globals (`globalThis.foo`, caches in shared libraries) are still shared.
- **Grants, in effect.** Each member keeps its own grants on the bus, but code in one member can reach the others' bus ports, so treat a pool as holding the union of its members' grants. `kernel.pools()` lists that union with the members.
- **Leftovers.** When one member is stopped or restarted alone, the pool stops routing messages and records to it, but timers it started keep running in the shared worker until they end. Clear them in `ctx.onShutdown`.
- **Suspension.** A pool suspends only as a whole: when every member asks for `suspend` and all of them are idle. A record or `kernel.resume` for any member wakes the whole pool. Registering a member that asks for `suspend` next to one that never suspends warns once.

## When to pool

| Pool | Keep in its own worker |
|---|---|
| Small headless isolates: feeds, adapters, light transforms, state managers | Heavy computation (it holds up the whole pool) |
| Isolates that belong together and can fail together (one machine's feeds, one feature) | Code you trust less than its neighbours, or from another team |
| Many isolates that each do little, where the worker count adds up | Isolates whose crash must not take others down |

Group by what fails together: a pool is a unit of failure. Visual isolates can't join a pool yet: `spawn` rejects one with `pools_headless_only` ([M2d](../plans/m2d-visual-pools.md) adds visual pools).

## Inspecting pools

- `kernel.isolates()`: each member's `pool`.
- `kernel.pools()`: each pool's members, whether its worker runs, and its effective grants.
- A pool counts as one worker against `workers.budget`.
