// The contracts after `saved.v1` was replaced by `saved.v2` (bus.test.ts, M2b
// task 19): v1's files are still on disk, so the bus reports it as orphaned.
// (A bus with no persistent topic at all doesn't open the files.)
import { count, notes, report, saved, small } from './contracts';

const savedV2: typeof saved = { ...saved, name: 'saved.v2' };
const topics: (typeof count | typeof notes | typeof report | typeof small)[] = [
  count,
  notes,
  report,
  small,
  savedV2,
];

const list: {
  '~isoloop': 'contracts';
  topics: typeof topics;
  get(name: string): (typeof topics)[number] | undefined;
} = {
  '~isoloop': 'contracts',
  topics,
  get: (name) => topics.find((t) => t.name === name),
};
export default list;
