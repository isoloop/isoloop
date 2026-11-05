// The demo's topics (ADR 0003). This module is the single source: the bus
// worker imports it by URL to validate, the host imports it for
// `contracts.list`, and isolates import only its types (see topics.ts).
import { contracts, topic } from '@isoloop/bus';
import { z } from 'zod';

/** A's counter value, each time it changes. */
export const count = topic('count.v1', {
  schema: z.number().int().nonnegative(),
  retention: { kind: 'last-n', n: 100 },
});

/** A note D sends to A. */
export const note = topic('note.v1', {
  schema: z.string().trim().min(1).max(200),
  retention: { kind: 'last-n', n: 50 },
});

/** C's prime sieve result. */
export const primes = topic('primes.v1', {
  schema: z.object({ count: z.number().int(), ms: z.number().nonnegative() }),
  retention: { kind: 'last-n', n: 20 },
});

export default contracts(count, note, primes);
