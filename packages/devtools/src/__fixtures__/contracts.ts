// Contracts for the devtools tests, built by hand like the host's: the bus
// worker only checks the `contracts()` brand.
type Schema<T> = {
  '~standard': {
    version: 1;
    vendor: string;
    validate: (v: unknown) => { value: T } | { issues: { message: string; path: [] }[] };
  };
};

const schema = <T>(ok: (v: unknown) => v is T): Schema<T> => ({
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (v) => (ok(v) ? { value: v } : { issues: [{ message: 'bad value', path: [] }] }),
  },
});

type Topic<T> = {
  name: string;
  schema: Schema<T>;
  retention: { kind: 'last-n'; n: number } | { kind: 'compacted' };
};

export const count: Topic<number> = {
  name: 'count.v1',
  schema: schema((v): v is number => typeof v === 'number'),
  retention: { kind: 'last-n', n: 100 },
};

const topics = [count];

const list: {
  '~isoloop': 'contracts';
  topics: Topic<unknown>[];
  get(name: string): Topic<unknown> | undefined;
} = {
  '~isoloop': 'contracts',
  topics,
  get: (name) => topics.find((t) => t.name === name),
};
export default list;
