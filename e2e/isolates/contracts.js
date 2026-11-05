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

/** What the headless isolate reports about itself (isolation suite). */
export const headless = {
  name: 'headless.v1',
  schema: schema((v) => typeof v === 'object' && v !== null),
  retention: { kind: 'last-n', n: 100 },
};

const topics = [notes, headless];

export default {
  '~isoloop': 'contracts',
  topics,
  get: (/** @type {string} */ name) => topics.find((t) => t.name === name),
};
