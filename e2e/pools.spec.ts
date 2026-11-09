/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import './harness-types';
import { HARNESS, ISOLATES_CORS } from './servers';

/*
 * Worker pools (M2c task 8, the done-when): a pool of three headless members,
 * a second pool and own-worker isolates side by side. A member that hangs or
 * takes its worker down restarts its whole pool, each member replaying from
 * its committed offset; a member that throws in start() fails alone; the
 * other pool and the own workers never notice.
 */

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS);
  await expect(page.locator('body[data-ready]')).toBeAttached();
});

type Fault = 'hang' | 'kill' | 'throw';
type Report = { id: string; instance: string; seen: number[] };
type Out = {
  crashes: { id: string; reason: string; pool?: string }[];
  /** Start instances per isolate, in order. */
  instances: Record<string, string[]>;
  /** What each isolate's latest instance saw. */
  latest: Record<string, number[]>;
  states: Record<string, string>;
};

const run =
  (fault: Fault) =>
  ({ page }: { page: import('@playwright/test').Page }) =>
    page.evaluate(
      async ({ src, contracts, which }): Promise<Out> => {
        const kernel = await window.harness.createBusKernel(contracts, {
          heartbeat: { blockedAfterMs: 200, killAfterMs: 800 },
          supervisor: { strategy: which === 'throw' ? 'never' : 'one-for-one' },
        });
        const crashes: Out['crashes'] = [];
        kernel.on('isolate:crash', (e) => crashes.push(e));
        const reports: Report[] = [];
        kernel.subscribe(
          { name: 'pooled.v1' },
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fixture's shape
          (r) => reports.push(r.value as Report),
          { from: 'earliest' },
        );
        const grants = { publish: ['pooled.v1'], subscribe: ['feed.v1'] };
        const isolates: [string, string | undefined, unknown][] = [
          ['A', 'p', { fault: which }],
          ['B', 'p', {}],
          ['C', 'p', {}],
          ['Q1', 'q', {}],
          ['Q2', 'q', {}],
          ['O1', undefined, {}],
          ['O2', undefined, {}],
        ];
        for (const [id, pool, config] of isolates)
          kernel.spawn({ id, src, config, grants, ...(pool === undefined ? {} : { pool }) });
        // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page, must be self-contained
        const wait = async (ok: () => boolean, ms: number, what: string): Promise<void> => {
          const until = performance.now() + ms;
          while (!ok()) {
            if (performance.now() > until) throw new Error(`timed out: ${what}`);
            // oxlint-disable-next-line no-await-in-loop -- polling
            await new Promise((r) => setTimeout(r, 20));
          }
        };
        const lastOf = (id: string): Report | undefined => {
          for (let i = reports.length - 1; i >= 0; i--)
            if (reports[i]?.id === id) return reports[i];
          return undefined;
        };
        const instancesOf = (id: string) => [
          ...new Set(reports.filter((r) => r.id === id).map((r) => r.instance)),
        ];
        const healthy = ['B', 'C', 'Q1', 'Q2', 'O1', 'O2'];
        await wait(() => healthy.every((id) => instancesOf(id).length >= 1), 8000, 'start');
        // Records before the fault, read by every member.
        for (const value of [1, 2, 3]) void kernel.publish({ name: 'feed.v1' }, { value });
        const sawAll = (id: string, n: number) =>
          reports.some((r) => r.id === id && r.seen.length >= n);
        await wait(() => healthy.every((id) => sawAll(id, 3)), 8000, 'first records');
        if (which === 'throw') {
          await wait(() => crashes.length > 0, 8000, 'the throw');
          await new Promise((r) => setTimeout(r, 1500));
        } else {
          // The pool restarts: B and C come back as new instances.
          await wait(
            () => instancesOf('B').length >= 2 && instancesOf('C').length >= 2,
            10_000,
            'pool restart',
          );
          await new Promise((r) => setTimeout(r, 300));
        }
        // Records after the fault: each member reads on from its committed offset.
        for (const value of [4, 5]) void kernel.publish({ name: 'feed.v1' }, { value });
        await wait(
          () =>
            healthy.every((id) => {
              const last = lastOf(id);
              return last !== undefined && last.seen.includes(5);
            }),
          8000,
          'later records',
        );
        const out: Out = { crashes, instances: {}, latest: {}, states: {} };
        for (const [id] of isolates) {
          out.instances[id] = instancesOf(id);
          out.latest[id] = lastOf(id)?.seen ?? [];
        }
        for (const s of kernel.isolates()) out.states[s.id] = s.state;
        await kernel.destroy();
        return out;
      },
      {
        src: new URL('pool-member.js', ISOLATES_CORS).href,
        contracts: new URL('contracts.js', ISOLATES_CORS).href,
        which: fault,
      },
    );

/**
 * A restarted member reads on from its committed offset: it gets 4 and 5,
 * nothing is lost or reordered, and records it read but hadn't committed when
 * the pool went down come again (at least once, design §5). So what the new
 * instance saw is a tail of 1…5 that includes 4 and 5.
 */
const replayedFromCommitted = (seen: number[], id: string): void => {
  expect(seen.length, id).toBeGreaterThanOrEqual(2);
  expect(seen, id).toEqual([1, 2, 3, 4, 5].slice(5 - seen.length));
};

const untouched = (out: Out): void => {
  for (const id of ['Q1', 'Q2', 'O1', 'O2']) {
    expect(out.instances[id], id).toHaveLength(1);
    expect(out.latest[id], id).toEqual([1, 2, 3, 4, 5]);
  }
  expect(out.crashes.filter((c) => ['Q1', 'Q2', 'O1', 'O2'].includes(c.id))).toEqual([]);
};

test('a member that hangs restarts its pool; the members replay from their committed offsets', async ({
  page,
}) => {
  const out = await run('hang')({ page });
  for (const id of ['A', 'B', 'C'])
    expect(
      out.crashes.find((c) => c.id === id),
      id,
    ).toMatchObject({ reason: 'unresponsive', pool: 'p' });
  // A new instance of B and C, which read on from where they committed:
  // 4 and 5 after the restart, nothing lost.
  for (const id of ['B', 'C']) {
    expect(out.instances[id]?.length, id).toBeGreaterThanOrEqual(2);
    replayedFromCommitted(out.latest[id] ?? [], id);
  }
  untouched(out);
});

test('a member that takes the worker down (an uncaught error) restarts its pool', async ({
  page,
}) => {
  const out = await run('kill')({ page });
  for (const id of ['B', 'C'])
    expect(
      out.crashes.find((c) => c.id === id),
      id,
    ).toMatchObject({ reason: 'worker-error', pool: 'p' });
  for (const id of ['B', 'C']) {
    expect(out.instances[id]?.length, id).toBeGreaterThanOrEqual(2);
    replayedFromCommitted(out.latest[id] ?? [], id);
  }
  untouched(out);
});

test('a member that throws in start() fails alone; the rest of its pool keeps running', async ({
  page,
}) => {
  const out = await run('throw')({ page });
  expect(out.crashes).toEqual([expect.objectContaining({ id: 'A', reason: 'error', pool: 'p' })]);
  expect(out.states['A']).toBe('failed');
  for (const id of ['B', 'C']) {
    expect(out.instances[id], id).toHaveLength(1);
    expect(out.latest[id], id).toEqual([1, 2, 3, 4, 5]);
  }
  untouched(out);
});
