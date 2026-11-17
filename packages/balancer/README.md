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

- **Backlog:** a backlog higher at the end of a 10 s window than at its start, and above 0, moves the isolate somewhere with more CPU: a pool of its own if the cap allows, else a pool with less load than its pool-mates. One such move per fresh 10 s window, so a group's members move one at a time. A report older than 10 s counts as none. With nowhere to go, it emits `behind` (at most every 30 s).
- **Fewer moves:** a move for load is made only if the moves it starts are predicted to bring the pool back under its line, and each isolate gets at most 3 of them in 5 minutes. Spike, crash and bisect moves protect the others and aren't limited.
- **Spikes:** a first long task is only reported (`spike`, action `noted`); a second from the same isolate within 60 s sends it to quarantine. Its own fatal error still does at once.
- **Packing back:** an isolate alone in its pool and quiet for 60 s joins another of the balancer's pools if both stay under 40 % of a core, which frees a worker; at most one every 60 s. Turn it off with `pack: { enabled: false }`.
- **Move cost:** `arrived` follows each `move` with `costMs`, the time from stopping the isolate to its first beat in the new pool.

One balancer per kernel at a time (`dispose()` frees the kernel for another); its pools are named `balancer-…`, which the host reserves. The API, the triggers, the quarantine and what `busyMs` measures are in the [balancer guide](https://github.com/isoloop/isoloop/blob/main/docs/guide/balancer.md).
