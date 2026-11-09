/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import './harness-types';
import { HARNESS, ISOLATES_CORS } from './servers';

/*
 * Visual pools (M2d task 6, ADR 0015): two pools of three React widgets, a
 * mixed pool (a headless member and two widgets), a pool mixing a React and
 * a Preact widget, and an own-worker widget, side by side on one page.
 *
 * - A widget that hangs or takes its worker down restarts its whole pool,
 *   whose surfaces redraw; nothing else notices.
 * - A widget that throws while rendering is caught at its own root and
 *   crashes alone (decision 8); its pool keeps drawing.
 * - A headless member that hangs restarts its mixed pool's widgets too.
 * - The kernel reports each isolate's pool.
 */

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS);
  await expect(page.locator('body[data-ready]')).toBeAttached();
});

type Fault = 'hang' | 'kill' | 'throw';
type Report = { id: string; instance: string; seen: number[] };
type Out = {
  crashes: { id: string; reason: string; pool?: string }[];
  instances: Record<string, string[]>;
  /** The value each surface shows at the end. */
  shown: Record<string, string | undefined>;
  pools: Record<string, string | undefined>;
  states: Record<string, string>;
};

/** id, pool, which build (`react`, `preact`, `headless`). */
const LAYOUT: [string, string | undefined, 'react' | 'preact' | 'headless'][] = [
  ['P1', 'p', 'react'],
  ['P2', 'p', 'react'],
  ['P3', 'p', 'react'],
  ['Q1', 'q', 'react'],
  ['Q2', 'q', 'react'],
  ['Q3', 'q', 'react'],
  ['MF', 'm', 'headless'],
  ['M1', 'm', 'react'],
  ['M2', 'm', 'react'],
  ['XR', 'x', 'react'],
  ['XP', 'x', 'preact'],
  ['O1', undefined, 'react'],
];

const run = (page: import('@playwright/test').Page, faulty: string, fault: Fault): Promise<Out> =>
  page.evaluate(
    async ({ base, layout, faulty: who, fault: which }): Promise<Out> => {
      const kernel = await window.harness.createBusKernel(new URL('contracts.js', base).href, {
        heartbeat: { blockedAfterMs: 200, killAfterMs: 800 },
        // A member that throws isn't restarted, as in the M2c pools suite: the
        // test is that it fails alone. (Restarting a pool member twice in the
        // same worker stalls the worker on WebKit; found here, tracked apart.)
        supervisor: { strategy: which === 'throw' ? 'never' : 'one-for-one' },
      });
      const crashes: Out['crashes'] = [];
      kernel.on('isolate:crash', (e) => crashes.push(e));
      const reports: Report[] = [];
      kernel.subscribe(
        { name: 'pooled.v1' },
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fixtures' shape
        (r) => reports.push(r.value as Report),
        { from: 'earliest' },
      );
      const grants = { publish: ['pooled.v1'], subscribe: ['feed.v1'] };
      const surfaces: Record<string, HTMLElement> = {};
      for (const [id, pool, kind] of layout) {
        const src = new URL(
          kind === 'headless' ? 'pool-member.js' : `adapter-pool-widget-${kind}.js`,
          base,
        ).href;
        const config = id === who ? { fault: which } : {};
        let surface: HTMLElement | undefined;
        if (kind !== 'headless') {
          surface = document.createElement('section');
          surface.dataset['id'] = id;
          document.getElementById('root')?.append(surface);
          surfaces[id] = surface;
        }
        kernel.spawn({
          id,
          src,
          config,
          grants,
          ...(surface ? { surface } : {}),
          ...(pool === undefined ? {} : { pool }),
        });
      }
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page, must be self-contained
      const wait = async (ok: () => boolean, ms: number, what: string): Promise<void> => {
        const until = performance.now() + ms;
        while (!ok()) {
          if (performance.now() > until) throw new Error(`timed out: ${what}`);
          // oxlint-disable-next-line no-await-in-loop -- polling
          await new Promise((r) => setTimeout(r, 20));
        }
      };
      const instancesOf = (id: string) => [
        ...new Set(reports.filter((r) => r.id === id).map((r) => r.instance)),
      ];
      const shown = (id: string) =>
        surfaces[id]?.querySelector('iso-surface')?.shadowRoot?.querySelector('.v')?.textContent ??
        undefined;
      const all = layout.map(([id]) => id);
      const visual = layout.filter(([, , k]) => k !== 'headless').map(([id]) => id);
      await wait(() => all.every((id) => instancesOf(id).length >= 1), 10_000, 'start');
      for (const value of [1, 2, 3]) void kernel.publish({ name: 'feed.v1' }, { value });
      await wait(
        () => visual.every((id) => shown(id) === '3'),
        10_000,
        `first records (${JSON.stringify(Object.fromEntries(visual.map((id) => [id, shown(id)])))})`,
      );
      if (!layout.some(([id]) => id === who)) {
        // No fault: just let a few heartbeats pass.
        await new Promise((r) => setTimeout(r, 1500));
      } else if (which === 'throw') {
        await wait(() => crashes.length > 0, 8000, 'the throw');
        await new Promise((r) => setTimeout(r, 1500));
      } else {
        const pool = layout.find(([id]) => id === who)?.[1];
        const mates = layout.filter(([id, p]) => p === pool && id !== who).map(([id]) => id);
        await wait(() => mates.every((id) => instancesOf(id).length >= 2), 12_000, 'pool restart');
        await new Promise((r) => setTimeout(r, 300));
      }
      for (const value of [4, 5]) void kernel.publish({ name: 'feed.v1' }, { value });
      const healthy = visual.filter((id) => !(which === 'throw' && id === who));
      await wait(() => healthy.every((id) => shown(id) === '5'), 10_000, 'later records');
      const out: Out = { crashes, instances: {}, shown: {}, pools: {}, states: {} };
      for (const id of all) {
        out.instances[id] = instancesOf(id);
        out.shown[id] = shown(id);
      }
      for (const s of kernel.isolates()) {
        out.states[s.id] = s.state;
        out.pools[s.id] = s.pool;
      }
      await kernel.destroy();
      return out;
    },
    { base: ISOLATES_CORS, layout: LAYOUT, faulty, fault },
  );

const restartedTogether = (out: Out, ids: string[], pool: string): void => {
  for (const id of ids) {
    expect(
      out.crashes.find((c) => c.id === id),
      id,
    ).toMatchObject({ pool });
    expect(out.instances[id]?.length, id).toBeGreaterThanOrEqual(2);
  }
};

const untouched = (out: Out, ids: string[]): void => {
  for (const id of ids) {
    expect(out.instances[id], id).toHaveLength(1);
    expect(
      out.crashes.some((c) => c.id === id),
      id,
    ).toBe(false);
  }
};

const ELSEWHERE = ['Q1', 'Q2', 'Q3', 'MF', 'M1', 'M2', 'XR', 'XP', 'O1'];

test('a widget that hangs restarts its pool, whose surfaces redraw; nothing else notices', async ({
  page,
}) => {
  const out = await run(page, 'P1', 'hang');
  restartedTogether(out, ['P2', 'P3'], 'p');
  expect(out.crashes.find((c) => c.id === 'P2')?.reason).toBe('unresponsive');
  for (const id of ['P2', 'P3']) expect(out.shown[id], id).toBe('5');
  untouched(out, ELSEWHERE);
});

test('a widget that takes its worker down restarts its pool', async ({ page }) => {
  const out = await run(page, 'P1', 'kill');
  restartedTogether(out, ['P2', 'P3'], 'p');
  expect(out.crashes.find((c) => c.id === 'P2')?.reason).toBe('worker-error');
  untouched(out, ELSEWHERE);
});

test('a widget that throws while rendering crashes alone; its pool keeps drawing', async ({
  page,
}) => {
  const out = await run(page, 'P1', 'throw');
  expect(out.crashes.filter((c) => c.id !== 'P1')).toEqual([]);
  expect(out.crashes[0]).toMatchObject({ id: 'P1', pool: 'p', reason: 'error' });
  expect(out.states['P1']).toBe('failed');
  untouched(out, ['P2', 'P3', ...ELSEWHERE]);
  for (const id of ['P2', 'P3']) expect(out.shown[id], id).toBe('5');
});

test('a headless member that hangs restarts its mixed pool’s widgets too', async ({ page }) => {
  const out = await run(page, 'MF', 'hang');
  restartedTogether(out, ['M1', 'M2'], 'm');
  for (const id of ['M1', 'M2']) expect(out.shown[id], id).toBe('5');
  untouched(out, ['P1', 'P2', 'P3', 'Q1', 'Q2', 'Q3', 'XR', 'XP', 'O1']);
});

test('React and Preact widgets share a pool, and the kernel reports every pool', async ({
  page,
}) => {
  const out = await run(page, 'none', 'hang');
  expect(out.shown['XR']).toBe('5');
  expect(out.shown['XP']).toBe('5');
  expect(out.pools).toEqual({
    P1: 'p',
    P2: 'p',
    P3: 'p',
    Q1: 'q',
    Q2: 'q',
    Q3: 'q',
    MF: 'm',
    M1: 'm',
    M2: 'm',
    XR: 'x',
    XP: 'x',
    O1: undefined,
  });
  expect(out.crashes).toEqual([]);
});
