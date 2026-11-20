// The example app's own topics, which the guides' isolate fences import as
// `./topics`: a counter, as in isoloop/web's `apps/samples`.
import { contracts, topic } from '@isoloop/bus';
import { z } from 'zod';

export const count = topic('count.v1', {
  schema: z.number().int().nonnegative(),
  retention: { kind: 'last-n', n: 100 },
});

export default contracts(count);
