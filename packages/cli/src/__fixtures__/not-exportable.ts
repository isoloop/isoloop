// A contracts module with schemas that can't be made into JSON Schema: a
// Standard Schema without `~standard.jsonSchema`, and a Zod transform.
import { contracts, topic, type StandardSchemaV1 } from '@isoloop/bus';
import { z } from 'zod';

const last10 = { kind: 'last-n', n: 10 } as const;

const plain: StandardSchemaV1<string, string> = {
  '~standard': {
    version: 1,
    vendor: 'hand-made',
    validate: (value) =>
      typeof value === 'string' ? { value } : { issues: [{ message: 'not a string' }] },
  },
};

export const ok = topic('ok.v1', { schema: z.string(), retention: last10 });
export const bare = topic('bare.v1', { schema: plain, retention: last10 });
export const lookup = topic('lookup.v1', {
  schema: z.string(),
  reply: z.string().transform((s) => s.length),
  retention: last10,
});

export default contracts(ok, bare, lookup);
