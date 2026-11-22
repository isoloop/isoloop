# @isoloop/host

The kernel of [Isoloop](https://isoloop.dev): it runs the parts of your app as isolates, keeps them running, and draws their UI on the page.

## What you get

- **Contained failures:** each isolate runs on its own worker by default, so one that blocks or crashes doesn't freeze the others.
- **Supervision:** blocked and crashed isolates restart, and one that keeps failing shows a fallback with Retry.
- **Placement as a switch:** add `pool` to a spawn to share a worker and save memory and start-up time. The isolate's code stays the same.
- **UI from workers:** isolates render in their workers, and the kernel applies their changes to the page once per frame.
- **Grants:** each isolate publishes and subscribes only to the topics you allow.
- **A view of it all:** events, state per isolate and pool, and publish and subscribe from the page.

## Install

```sh
npm install @isoloop/host@next @isoloop/runtime@next @isoloop/bus@next
npm install -D @isoloop/vite@next
```

## Example

```ts
import { createKernel } from '@isoloop/host';
import workers from 'virtual:isoloop/workers';
import list from './contracts';
import contractsUrl from './contracts?isolate';
import cart from './cart?isolate';

const kernel = createKernel({ contracts: { url: contractsUrl, list }, workers });

kernel.spawn({
  id: 'cart',
  src: cart,
  surface: document.querySelector('#cart')!,
  grants: { publish: ['cart.items.v1'], subscribe: ['cart.items.v1'] },
});
```

## Learn more

- [Getting started](https://isoloop.dev/docs/getting-started/)
- [Supervision and restarts](https://isoloop.dev/docs/supervision/) and [worker pools](https://isoloop.dev/docs/pools/)
- [Hosting](https://isoloop.dev/docs/hosting/) and [what Isoloop can't hide](https://isoloop.dev/docs/limits/)
- [API reference](https://isoloop.dev/docs/api/host/)
