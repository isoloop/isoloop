// Contracts for the agent-tool tests (ADR 0018), built by hand like
// contracts.ts: host may not import @isoloop/bus. `json` schemas implement
// Standard JSON Schema (`~standard.jsonSchema`), as Zod ≥ 4.2 does.
type Std<T> = {
  version: 1;
  vendor: string;
  validate: (v: unknown) => { value: T } | { issues: { message: string; path: [] }[] };
  types?: { input: T; output: T };
  jsonSchema?: { input: (o: unknown) => object; output: (o: unknown) => object };
};
type Schema<T> = { '~standard': Std<T> };

const plain = <T>(ok: (v: unknown) => v is T): Schema<T> => ({
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (v) => (ok(v) ? { value: v } : { issues: [{ message: 'bad value', path: [] }] }),
  },
});

const json = <T>(ok: (v: unknown) => v is T, js: object): Schema<T> => ({
  '~standard': {
    ...plain(ok)['~standard'],
    jsonSchema: { input: () => ({ ...js, in: true }), output: () => ({ ...js, out: true }) },
  },
});

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export type Ask = { q: string; crash?: boolean };
export type Answer = { echo: unknown; from: string; id: string; via: string | null; by: string };

type Topic<T = unknown, R = unknown> = {
  name: string;
  schema: Schema<T>;
  reply?: Schema<R>;
  retention: { kind: 'last-n'; n: number };
  tool?: {
    title?: string;
    description: string;
    readOnly: boolean;
    consequential?: boolean;
    untrustedContent?: boolean;
  };
};

const last = { kind: 'last-n', n: 100 } as const;

/** Exposable: reply, tool, JSON Schema. */
export const ask: Topic<Ask, Answer> & { reply: Schema<Answer> } = {
  name: 'agents.ask.v1',
  schema: json((v): v is Ask => isObject(v) && typeof v.q === 'string', { type: 'object' }),
  reply: json((v): v is Answer => isObject(v), { type: 'object', title: 'answer' }),
  retention: last,
  tool: { title: 'Ask', description: 'Echoes the question', readOnly: true },
};

/** A second exposable tool, consequential. */
export const act: Topic<Ask, Answer> & { reply: Schema<Answer> } = {
  name: 'agents.act.v1',
  schema: json((v): v is Ask => isObject(v) && typeof v.q === 'string', { type: 'object' }),
  reply: json((v): v is Answer => isObject(v), { type: 'object' }),
  retention: last,
  tool: {
    description: 'Does something',
    readOnly: false,
    consequential: true,
    untrustedContent: true,
  },
};

/** Requestable, but no `tool`. */
export const untooled: Topic<Ask, Answer> = {
  name: 'other.untooled.v1',
  schema: json((v): v is Ask => isObject(v), { type: 'object' }),
  reply: json((v): v is Answer => isObject(v), { type: 'object' }),
  retention: last,
};

/** A `tool`, but schemas without Standard JSON Schema. */
export const nojson: Topic<Ask, Answer> = {
  name: 'other.nojson.v1',
  schema: plain((v): v is Ask => isObject(v)),
  reply: plain((v): v is Answer => isObject(v)),
  retention: last,
  tool: { description: 'No JSON Schema', readOnly: true },
};

/** Not requestable. */
export const told: Topic<number> = {
  name: 'other.told.v1',
  schema: json((v): v is number => typeof v === 'number', { type: 'number' }),
  retention: last,
};

const topics: Topic<any, any>[] = [ask, act, untooled, nojson, told];

const list: {
  '~isoloop': 'contracts';
  topics: Topic<any, any>[];
  get(name: string): Topic<any, any> | undefined;
} = {
  '~isoloop': 'contracts',
  topics,
  get: (name) => topics.find((t) => t.name === name),
};
export default list;
