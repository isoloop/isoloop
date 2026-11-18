// A contracts module as an app writes one: Zod schemas, a requestable topic
// that's a tool, one with a default, one whose schemas are the same in and
// out, and an unchecked one. Zod's output schema for an object adds
// `additionalProperties: false`, so object topics export input and output.
import { contracts, topic, unchecked } from '@isoloop/bus';
import { z } from 'zod';

const last10 = { kind: 'last-n', n: 10 } as const;

export const quote = topic('markets.quote.v1', {
  schema: z.object({ symbol: z.string() }),
  reply: z.object({ price: z.number(), change: z.number() }),
  retention: last10,
  tool: {
    title: 'Quote',
    description: 'The latest price for a symbol.',
    readOnly: true,
  },
});

/** `size` has a default: optional going in, always there coming out. */
export const order = topic('orders.placed.v1', {
  schema: z.object({ id: z.string(), size: z.number().default(1) }),
  retention: last10,
});

/** Same schema in and out (no object strictness, no default). */
export const ping = topic('ping.v1', { schema: z.string(), reply: z.number(), retention: last10 });

export const raw = topic('raw.events.v1', {
  schema: unchecked<{ any: unknown }>(),
  retention: last10,
});

export default contracts(quote, order, ping, raw);
