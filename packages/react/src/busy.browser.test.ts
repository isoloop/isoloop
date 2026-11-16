/*
 * Busy time for React members in a pool (ADR 0017): React's scheduler is
 * shared by the pool's members, and its tasks are billed to the members
 * whose roots committed in them, through the devtools hook the runtime
 * installs and the container the adapter claims.
 */
import { afterEach, expect, it } from 'vitest';
import { busyWorker, stopBusyWorkers } from './__fixtures__/busy-worker';

afterEach(() => {
  stopBusyWorkers();
});

it("bills a heavy React member's renders to it, not its light neighbour", async () => {
  const w = busyWorker(
    new Worker(new URL('./__fixtures__/busy-bootstrap.worker.ts', import.meta.url), {
      type: 'module',
    }),
    new URL('./__fixtures__/busy-member.tsx', import.meta.url).href,
    [
      // Its renders change nothing in the DOM: only the commit hook names it.
      { name: 'heavy', config: { burnMs: 3, everyMs: 23, quiet: true } },
      { name: 'light', config: { burnMs: 0, everyMs: 17 } },
    ],
  );
  await w.settle(600);
  const sums = await w.sum(1500);
  const heavy = sums.get('heavy') ?? 0;
  const light = sums.get('light') ?? 0;
  // About 65 renders of 3 ms each. A task that renders both (when their
  // updates land together, more often on a loaded machine) splits equally.
  expect(heavy).toBeGreaterThan(60);
  expect(light).toBeLessThan(heavy / 2);
});
