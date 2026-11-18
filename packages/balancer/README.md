# @isoloop/balancer

**Experimental.** Automatic placement for [Isoloop](https://github.com/isoloop/isoloop) isolates. Spawn through the balancer instead of naming a pool: it places each isolate in a pool with room by measured load, moves one out when its pool lags or is full, and keeps one that blocks or crashes in a quarantine pool until it's quiet again ([ADR 0017](https://github.com/isoloop/isoloop/blob/main/docs/adr/0017-opt-in-balancer.md)).

```sh
npm install @isoloop/balancer@next @isoloop/host@next
```

```ts
import { createKernel } from '@isoloop/host';
import { createBalancer } from '@isoloop/balancer';

const kernel = createKernel({ /* … */ });
const balancer = createBalancer(kernel, { maxWorkers: 4 });

balancer.spawn({ id: 'task-1', src: taskUrl });   // no `pool`: the balancer picks one
balancer.on('move', (e) => console.log(e.id, e.from, '→', e.to, e.reason));
```

It also reacts when work piles up, if the app says how much is queued (M3i):

```ts
// Once a second or so, per isolate; for a consumer group, the group's backlog on every member.
balancer.report('task-1', { backlog: queue.length });
balancer.on('behind', (e) => console.warn(e.id, 'is behind and has nowhere to go'));
balancer.on('arrived', (e) => console.log(e.id, 'moved in', e.costMs, 'ms'));
```

- **Backlog:** a backlog that rose over two 10 s windows in a row, and is above 0, moves the isolate somewhere with more CPU: a pool of its own if the cap allows, else a pool with less load than its pool-mates. One such move per fresh 10 s window, so a group's members move one at a time. A report older than 10 s counts as none. With nowhere to go, it emits `behind` (at most every 30 s).
- **Fewer moves:** a move for load is made only if the moves it starts are predicted to bring the pool back under its line, and each isolate gets at most 3 of them in 5 minutes. Spike, crash and bisect moves protect the others and aren't limited. A never-measured isolate's way out of the quarantine, where it starts, doesn't count.
- **Spikes:** a first long task is only reported (`spike`, action `noted`); a second from the same isolate within 60 s sends it to quarantine. Its own fatal error still does at once.
- **Packing back:** a pool whose isolates have all been steady for 60 s empties into another of the balancer's pools if both together stay under 40 % of a core, one isolate per pack and at most one pack every 60 s, which frees a worker once the last one is in. Turn it off with `pack: { enabled: false }`.
- **Move cost:** `arrived` follows each `move` with `costMs`, the time from stopping the isolate to its first beat in the new pool.

And when its busy time misses work, or the kernel gives up on an isolate (M3j):

```ts
// Work timed by the app, as a running total since the isolate started: for slices resumed after `await`.
balancer.report('task-1', { backlog: queue.length, busyMs: workMsSoFar });
balancer.on('failed', (e) => console.warn(e.id, 'was given up on in', e.pool, e.reason));
```

- **Reported busy time:** the balancer takes the total's difference over its 3 s window and uses the larger of that and the beats' `busyMs`, wherever it reads a load.
- **Packing** goes ahead while a backlog holds steady; only a backlog that rose over the 60 s window blocks it.
- **The quarantine:** an offender's quiet window is capped at 2 minutes, and offences wear off with each quiet window back in a pool. A bisect starts only with a quarantine pool of its own, never alongside offenders; with none free, the pool's members are `behind`.
- **Given up:** an isolate past the kernel's restart limit is `failed`. It leaves its pool's load and any bisect, and no move restarts it; after `kernel.restart(id)` it's placed again as new.

One balancer per kernel at a time (`dispose()` frees the kernel for another); its pools are named `balancer-…`, which the host reserves. The API, the triggers, the quarantine and what `busyMs` measures are in the [balancer guide](https://github.com/isoloop/isoloop/blob/main/docs/guide/balancer.md).
