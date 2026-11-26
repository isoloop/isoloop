import { createKernel } from '@isoloop/host';
import { alerts, contracts } from './contracts';

// Calls whose arguments are already one per line: the options get a line of
// their own, and the comment above an argument stays where it is.
export async function seed(id: string): Promise<void> {
  const kernel = await createKernel({ contracts });
  await kernel.publish(
    // the broker reads only `name`
    { name: 'creator.specs.v1', schema: { '~standard': {} } } as never,
    { key: '$sync', value: { sync: 'flushed' } },
  );
  await kernel.publish(
    // the broker reads only `name`
    { name: 'creator.specs.v1', schema: { '~standard': {} } } as never,
    { value: { sync: 'flushed' } },
  );
  await kernel.publish(alerts, {
    key: id,
    value: {
      removed: false,
      id,
      symbol: 'ETH-USD',
      metric: 'price',
      op: 'above',
      threshold: 123456789,
    },
  });
}
