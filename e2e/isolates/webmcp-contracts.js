// Contracts for the WebMCP suite (M4a task 9), built by hand like
// agents-contracts.js, with the Standard JSON Schema interface a tool needs
// (ADR 0018, decision 3).

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
const question = schema((v) => isObject(v) && typeof Reflect.get(v, 'q') === 'string', {
  type: 'object',
  properties: { q: { type: 'string' } },
  required: ['q'],
});
const answer = schema((v) => isObject(v) && typeof Reflect.get(v, 'a') === 'string', {
  type: 'object',
  properties: { a: { type: 'string' }, via: { type: ['string', 'null'] } },
  required: ['a'],
});

/** A read-only tool with a title. */
export const ask = {
  name: 'webmcp.ask.v1',
  schema: question,
  reply: answer,
  retention: { kind: 'last-n', n: 100 },
  tool: { title: 'Ask', description: 'Answers a question with an echo', readOnly: true },
};

/** A tool that changes something, consequential, with third-party text in its reply. */
export const act = {
  name: 'webmcp.act.v1',
  schema: question,
  reply: answer,
  retention: { kind: 'last-n', n: 100 },
  tool: {
    description: 'Acts on a question',
    readOnly: false,
    consequential: true,
    untrustedContent: true,
  },
};

/** A tool no `expose` pattern in the suite matches. */
export const hidden = {
  name: 'other.hidden.v1',
  schema: question,
  reply: answer,
  retention: { kind: 'last-n', n: 100 },
  tool: { description: 'Not exposed', readOnly: true },
};

const topics = [ask, act, hidden];

export default {
  '~isoloop': 'contracts',
  topics,
  get: (/** @type {string} */ name) => topics.find((t) => t.name === name),
};
