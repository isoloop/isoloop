// The contracts after `saved.v1` was replaced by `saved.v2` (bus.test.ts, M2b
// task 19): v1's files are still on disk, so the bus reports it as orphaned.
// (A bus with no persistent topic at all doesn't open the files.)
import base, { count, notes, report, saved, small } from './contracts';

const savedV2: typeof saved = { ...saved, name: 'saved.v2' };
const topics: typeof base.topics = [count, notes, report, small, savedV2];

const list: typeof base = {
  '~isoloop': 'contracts',
  topics,
  get: (name) => topics.find((t) => t.name === name),
};
export default list;
