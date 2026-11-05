// A contracts module for host tests, built by hand: host may not import
// @isoloop/bus, and the bus worker only checks the `contracts()` brand.
type Schema<T> = {
  '~standard': {
    version: 1;
    vendor: string;
    validate: (v: unknown) => { value: T } | { issues: { message: string; path: [] }[] };
    types?: { input: T; output: T };
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

export const notes: Topic<string> = {
  name: 'notes.v1',
  schema: schema((v): v is string => typeof v === 'string'),
  retention: { kind: 'compacted' },
};

/** What the test bootstrap reports about itself. */
export type Report = { id: string; resets: Record<string, number>; ports: number; seen: number };

export const report: Topic<Report> = {
  name: 'report.v1',
  schema: schema((v): v is Report => typeof v === 'object' && v !== null),
  retention: { kind: 'last-n', n: 1000 },
};

/** A short log: five records while suspended lose two (ADR 0001 gap). */
export const small: Topic<number> = {
  name: 'small.v1',
  schema: schema((v): v is number => typeof v === 'number'),
  retention: { kind: 'last-n', n: 3 },
};

const topics = [count, notes, report, small];

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
