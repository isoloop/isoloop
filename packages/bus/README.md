# @isoloop/bus

The [Isoloop](https://isoloop.dev) bus: a log of typed topics in its own worker, through which the parts of your app share data and catch up after a restart.

## What you get

- **Contracts:** topics with schemas from any [Standard Schema](https://standardschema.dev) library, typed where you use them and checked on every publish.
- **Retention:** keep the newest records, a span of time, or the latest record for each key.
- **Replay:** a subscriber that starts late, or restarts, reads what it needs from the log.
- **Backpressure:** records wait in the log for a busy subscriber, within the topic's retention.
- **History that lasts:** a persistent topic's records and committed positions survive a reload and a restart of the bus.
- **Request and reply** (experimental): ask on a topic and get a typed answer.
- **Contract tests:** `testContracts` from `@isoloop/bus/testing` checks your schemas against samples.

## Install

```sh
npm install @isoloop/bus zod
```

## Example

```ts
import { contracts, topic } from '@isoloop/bus';
import { z } from 'zod';

export const cartItems = topic('cart.items.v1', {
  schema: z.object({ sku: z.string(), qty: z.number().int().positive() }),
  retention: { kind: 'compacted' },
});

export default contracts(cartItems);
```

## Learn more

- [The bus](https://isoloop.dev/docs/bus/)
- [Contracts and grants](https://isoloop.dev/docs/contracts/)
- [API reference](https://isoloop.dev/docs/api/bus/)
