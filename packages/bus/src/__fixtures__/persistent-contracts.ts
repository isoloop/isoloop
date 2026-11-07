import { contracts, topic, unchecked, type Contracts, type TopicDef } from '../topic';

/** A persistent topic and a memory one (worker.browser.test.ts, M2b). */
export const kept: TopicDef<number> = topic('kept.v1', {
  schema: unchecked<number>(),
  retention: { kind: 'last-n', n: 100 },
  durability: 'persistent',
});

export const passing: TopicDef<number> = topic('passing.v1', {
  schema: unchecked<number>(),
  retention: { kind: 'last-n', n: 100 },
});

const list: Contracts = contracts(kept, passing);
export default list;
