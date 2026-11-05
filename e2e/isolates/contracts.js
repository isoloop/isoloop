// A contracts module for E2E tests, served from the isolate origin with CORS.
// Built by hand: the bus worker only checks the contracts() brand.

/** @param {(v: unknown) => boolean} ok */
const schema = (ok) => ({
  '~standard': {
    version: 1,
    vendor: 'e2e',
    validate: (/** @type {unknown} */ value) =>
      ok(value) ? { value } : { issues: [{ message: 'bad value', path: [] }] },
  },
});

export const notes = {
  name: 'notes.v1',
  schema: schema((v) => typeof v === 'string'),
  retention: { kind: 'last-n', n: 100 },
};

const topics = [notes];

export default {
  '~isoloop': 'contracts',
  topics,
  get: (/** @type {string} */ name) => topics.find((t) => t.name === name),
};
