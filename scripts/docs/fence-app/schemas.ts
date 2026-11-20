// The example app's schemas, which the guides' fences import as `./schemas`.
import { z } from 'zod';

export const quoteRequest = z.object({ symbol: z.string() });
export const quoteReply = z.object({ symbol: z.string(), vwap: z.number().nullable() });
export const alertRule = z.object({ symbol: z.string(), above: z.number() });
export const alertCreated = z.object({ id: z.string(), created: z.boolean() });
