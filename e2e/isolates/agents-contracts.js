// Contracts for the dev MCP suite (M4a task 8), served from the isolate origin
// with CORS. Built by hand like contracts.js, plus the Standard JSON Schema
// interface (`~standard.jsonSchema`) that a tool needs (ADR 0018, decision 3).

/**
 * @param {(v: unknown) => boolean} ok
 * @param {Record<string, unknown>} json
 */
const schema = (ok, json) => ({
  '~standard': {
    version: 1,
    vendor: 'e2e',
    validate: (/** @type {unknown} */ value) =>
      ok(value) ? { value } : { issues: [{ message: 'bad value', path: [] }] },
    jsonSchema: { input: () => json, output: () => json },
  },
});

const isObject = (/** @type {unknown} */ v) => typeof v === 'object' && v !== null;

/** A read-only tool the answerer isolate replies to. */
export const answer = {
  name: 'answer.v1',
  schema: schema((v) => isObject(v) && typeof Reflect.get(v, 'q') === 'string', {
    type: 'object',
    properties: { q: { type: 'string' } },
    required: ['q'],
  }),
  reply: schema((v) => isObject(v) && typeof Reflect.get(v, 'a') === 'string', {
    type: 'object',
    properties: { a: { type: 'string' }, via: { type: ['string', 'null'] } },
    required: ['a'],
  }),
  retention: { kind: 'last-n', n: 100 },
  tool: { description: 'Answers a question with an echo', readOnly: true },
};

/** Plain records, for isoloop_publish and isoloop_records. */
export const log = {
  name: 'log.v1',
  schema: schema((v) => typeof v === 'string', { type: 'string' }),
  retention: { kind: 'last-n', n: 100 },
};

const topics = [answer, log];

export default {
  '~isoloop': 'contracts',
  topics,
  get: (/** @type {string} */ name) => topics.find((t) => t.name === name),
};
