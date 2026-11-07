// The contracts after `saved.v1` was replaced by `saved.v2` (bus.test.ts, M2b
// task 19): v1's files are still on disk, so the bus reports it as orphaned.
// (A bus with no persistent topic at all doesn't open the files.)
import { count, notes, report, saved, small } from './contracts';

const savedV2 = { ...saved, name: 'saved.v2' };
const topics = [count, notes, report, small, savedV2];

export default {
  '~isoloop': 'contracts' as const,
  topics,
  get: (name: string) => topics.find((t) => t.name === name),
};
