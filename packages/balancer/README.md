# @isoloop/balancer

**Experimental.** Automatic placement for [Isoloop](https://github.com/isoloop/isoloop) isolates: spawn through the balancer instead of naming a pool, and it places, moves and quarantines each isolate by measured load.

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

The triggers, the quarantine, packing back, the move budget, `report()` and what `busyMs` measures are in the [balancer guide](https://github.com/isoloop/isoloop/blob/main/docs/guide/balancer.md).
