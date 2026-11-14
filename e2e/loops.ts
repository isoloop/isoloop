/// <reference lib="dom" />
import { expect, type Page } from '@playwright/test';
import './harness-types';
import { HARNESS, ISOLATES_CORS } from './servers';

// The proof of concept's page, mounted on the harness: the four-loops
// isolates (e2e/isolates/loops, built by e2e/build-adapters.ts into
// e2e/isolates/loops-*.js) served cross-origin with CORS, each in a
// `section[data-isolate]` with its surface inside, plus the headless store S.
// The four-loops, replay and isolation suites run against it. Where the demo's
// page showed an isolate's state and restarts, the tests read
// `kernel.isolates()` instead.

/** The visual isolates, in the demo's order, with exactly the topics each uses (I4). */
const VISUAL = [
  {
    id: 'A',
    file: 'loops-counter.js',
    grants: { publish: ['count.v1'], subscribe: ['count.v1', 'note.v1'] },
  },
  { id: 'B', file: 'loops-ticker.js', grants: { publish: [], subscribe: [] } },
  {
    id: 'C',
    file: 'loops-heavy.js',
    grants: { publish: ['primes.v1'], subscribe: ['count.v1'] },
  },
  {
    id: 'D',
    file: 'loops-messages.js',
    grants: { publish: ['note.v1'], subscribe: ['count.v1', 'note.v1', 'primes.v1', 'store.v1'] },
  },
  {
    id: 'P',
    file: 'loops-votes-preact.js',
    grants: { publish: ['vote.v1'], subscribe: ['vote.v1'] },
  },
  {
    id: 'R',
    file: 'loops-votes-react.js',
    grants: { publish: ['vote.v1'], subscribe: ['vote.v1'] },
  },
];

/** S: folds count.v1 and note.v1 into store.v1, with no surface. */
const STORE = {
  id: 'S',
  file: 'loops-store.js',
  grants: { publish: ['store.v1'], subscribe: ['count.v1', 'note.v1', 'store.v1'] },
};

/** The isolates the suites wait for before each test, as the demo's did. */
export const ALL = ['A', 'B', 'C', 'D'];

export type LoopsOptions = {
  /** Shortens the hang limit, for the kill-path test. */
  killAfterMs?: number;
};

export const pane = (page: Page, id: string) => page.locator(`section[data-isolate="${id}"]`);

/** Creates the kernel and spawns every isolate on the already loaded harness page. */
export async function mountLoops(page: Page, opts: LoopsOptions = {}): Promise<void> {
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await page.evaluate(
    async ({ base, visual, store, killAfterMs }) => {
      // The real supervisor's defaults: backoff 250 ms × 2ⁿ, and the fourth
      // crash within 60 s fails the isolate, which then shows the fallback.
      const kernel = await window.harness.createBusKernel(
        `${base}loops-contracts.js`,
        killAfterMs ? { heartbeat: { killAfterMs } } : {},
      );
      window.kernel = kernel;
      window.__isoloop = kernel.debug;
      const root = document.getElementById('root');
      if (!root) throw new Error('the harness has no #root');
      for (const { id, file, grants } of visual) {
        const section = document.createElement('section');
        section.dataset['isolate'] = id;
        const body = document.createElement('div');
        section.append(body);
        root.append(section);
        kernel.spawn({ id, src: `${base}${file}`, surface: body, grants });
      }
      kernel.spawn({ id: store.id, src: `${base}${store.file}`, grants: store.grants });
    },
    { base: ISOLATES_CORS, visual: VISUAL, store: STORE, killAfterMs: opts.killAfterMs },
  );
}

/** Opens the harness, mounts the loops and waits until A–D are running. */
export async function openLoops(page: Page, opts: LoopsOptions = {}): Promise<void> {
  await page.goto(HARNESS);
  await mountLoops(page, opts);
  await Promise.all(ALL.map((id) => expectState(page, id, 'running', 10_000)));
}

type Snapshot = { state: string; restarts: number; lagMs: number } | undefined;

export const snapshotOf = (page: Page, id: string): Promise<Snapshot> =>
  page.evaluate((id_) => {
    const s = window.kernel.isolates().find((x) => x.id === id_);
    return s ? { state: s.state, restarts: s.restarts, lagMs: s.lagMs } : undefined;
  }, id);

export const stateOf = async (page: Page, id: string): Promise<string | undefined> =>
  (await snapshotOf(page, id))?.state;

export const restartsOf = async (page: Page, id: string): Promise<number | undefined> =>
  (await snapshotOf(page, id))?.restarts;

/** Waits until `id` is in `state` (what the demo's pane showed as its status). */
export const expectState = (page: Page, id: string, state: string, timeout = 5_000) =>
  expect.poll(() => stateOf(page, id), { timeout, message: `${id} ${state}` }).toBe(state);

/** Waits until `id` has restarted `n` times (the demo's "restarts: n"). */
export const expectRestarts = (page: Page, id: string, n: number, timeout = 5_000) =>
  expect.poll(() => restartsOf(page, id), { timeout, message: `${id} restarts` }).toBe(n);
