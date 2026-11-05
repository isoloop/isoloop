// A contracts module, as a host would serve it to the bus worker.
import { z } from 'zod';
import { contracts, topic, type Contracts, type TopicDef } from '../topic';

type Note = { text: string; by: string };

export const notes: TopicDef<{ text: string; by?: string | undefined }, Note> = topic('notes.v1', {
  schema: z.object({ text: z.string(), by: z.string().default('anon') }),
  retention: { kind: 'last-n', n: 100 },
});

export const counts: TopicDef<number> = topic('counts.v1', {
  schema: z.number().int(),
  retention: { kind: 'compacted' },
});

const list: Contracts = contracts(notes, counts);
export default list;
