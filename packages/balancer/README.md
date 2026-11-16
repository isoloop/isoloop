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

One balancer per kernel at a time (`dispose()` frees the kernel for another); its pools are named `balancer-…`, which the host reserves. The API, the triggers, the quarantine and what `busyMs` measures are in the [balancer guide](https://github.com/isoloop/isoloop/blob/main/docs/guide/balancer.md).
