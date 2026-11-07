import { checkDomUsage } from '@isoloop/dom/testing';
import { inject, test } from 'vitest';

// ADR 0010: what this Preact major calls must be in the subset, and the
// committed log must match, so a framework update that calls something new
// fails its Dependabot PR. `pnpm dom:usage` rewrites the logs.
test('the subset has every DOM member this Preact major uses', async () => {
  const worker = new Worker(new URL('./__fixtures__/usage.worker.tsx', import.meta.url), {
    type: 'module',
  });
  await checkDomUsage(
    worker,
    `packages/dom/usage/preact-${inject('major')}.json`,
    inject('writeUsage'),
  );
});
