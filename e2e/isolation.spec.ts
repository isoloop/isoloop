/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import './harness-types';
import { HARNESS, ISOLATES_CORS } from './servers';

// The M1 done-criterion (plan m1-kernel, task 12): a blocked or crashed
// isolate never affects the others. Invariants from design §8.

const ALL = ['A', 'B', 'C', 'D'];
const pane = (page: Page, id: string) => page.locator(`section[data-isolate="${id}"]`);
const status = (page: Page, id: string) => pane(page, id).locator('.status');

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await Promise.all(
    ALL.map((id) => expect(status(page, id)).toContainText('loop ok', { timeout: 10_000 })),
  );
  // Every first render has been painted: nothing left in any compositor queue.
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.kernel.isolates().every((s) => (s.surface?.queued ?? 0) === 0 && s.surface),
      ),
    )
    .toBe(true);
  // Every state change from here on, per isolate.
  await page.evaluate(() => {
    const log: { id: string; state: string }[] = [];
    window.kernel.on('isolate:state', ({ id, state }) => log.push({ id, state }));
    Object.assign(window, { stateLog: log });
  });
}

type StateEntry = { id: string; state: string };
const isStateLog = (x: unknown): x is StateEntry[] => Array.isArray(x);
const statesOf = async (page: Page): Promise<StateEntry[]> => {
  const log: unknown = await page.evaluate((): unknown => Reflect.get(window, 'stateLog'));
  if (!isStateLog(log)) throw new Error('no state log');
  return log;
};

test.describe('four-loops', () => {
  test('I2: blocking C for 3 s, B keeps ticking and the main thread keeps its frame rate', async ({
    page,
  }) => {
    await open(page);
    // Frames per second on the page over `ms`, with B's clock before and after.
    const sample = (ms: number) =>
      page.evaluate(async (window_) => {
        const big = document
          .querySelector('section[data-isolate="B"] iso-surface')
          ?.shadowRoot?.querySelector('.big');
        const clock = () => Number.parseFloat(big?.textContent ?? 'NaN');
        const t0 = performance.now();
        const b0 = clock();
        let frames = 0;
        await new Promise<void>((resolve) => {
          const tick = (now: number) => {
            frames++;
            if (now - t0 < window_) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
        const seconds = (performance.now() - t0) / 1000;
        return { advanced: clock() - b0, fps: frames / seconds };
      }, ms);

    // What this browser manages here with nothing blocked.
    const baseline = await sample(1500);
    await pane(page, 'C').getByRole('button', { name: 'Block this loop 3s' }).click();
    // Sample for 2.8 s while C is blocked.
    const during = await sample(2800);
    await expect(status(page, 'C')).toContainText('blocked');
    expect(during.advanced).toBeGreaterThanOrEqual(2.5);
    // I2 asks for 55 fps. Some headless engines on CI runners can't reach 60
    // with nothing blocked; there, blocking C must not cost more than 10 %.
    const floor = baseline.fps >= 58 ? 55 : baseline.fps * 0.9;
    expect(during.fps, `baseline ${baseline.fps.toFixed(1)} fps`).toBeGreaterThanOrEqual(floor);
  });

  test('I3 and I1: four crashes fail C; A, B and D stay running, responsive and untouched', async ({
    page,
  }) => {
    await open(page);
    // I1: record every DOM write into A's and D's surfaces while C crashes and restarts.
    await page.evaluate(() => {
      const writes: string[] = [];
      for (const id of ['A', 'D']) {
        const root = document.querySelector(
          `section[data-isolate="${id}"] iso-surface`,
        )?.shadowRoot;
        if (!root) throw new Error(`no surface for ${id}`);
        new MutationObserver((records) => {
          for (const r of records) writes.push(`${id} ${r.type}`);
        }).observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
      }
      Object.assign(window, { surfaceWrites: writes });
    });

    for (let i = 1; i <= 4; i++) {
      // oxlint-disable-next-line no-await-in-loop -- each crash waits for the restart
      await expect(status(page, 'C')).toContainText('loop ok', { timeout: 5_000 });
      // oxlint-disable-next-line no-await-in-loop
      await pane(page, 'C').getByRole('button', { name: 'Crash' }).click();
      if (i < 4) {
        // oxlint-disable-next-line no-await-in-loop
        await expect(pane(page, 'C').locator('.restarts')).toHaveText(`restarts: ${i}`, {
          timeout: 5_000,
        });
      }
    }
    await expect(status(page, 'C')).toHaveText('failed', { timeout: 3_000 });
    await expect(pane(page, 'C').locator('.iso-fallback')).toBeVisible();

    const writes: unknown = await page.evaluate((): unknown =>
      Reflect.get(window, 'surfaceWrites'),
    );
    expect(writes).toEqual([]);
    const others = (await statesOf(page)).filter((e) => e.id !== 'C');
    expect(others).toEqual([]);

    // Click-to-paint on A, with C failed: every click paints within 100 ms
    // (a loose E2E bound; bench/click-to-paint measures the real overhead).
    const times = await page.evaluate(async () => {
      const root = document.querySelector('section[data-isolate="A"] iso-surface')?.shadowRoot;
      const button = root?.querySelector('button');
      const big = root?.querySelector('.big');
      if (!button || !big) throw new Error('A is not rendered');
      const out: number[] = [];
      for (let i = 0; i < 20; i++) {
        const before = big.textContent;
        const t0 = performance.now();
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
        // oxlint-disable-next-line no-await-in-loop -- one click at a time
        await new Promise<void>((resolve) => {
          const check = () => {
            if (big.textContent !== before) resolve();
            else requestAnimationFrame(check);
          };
          check();
        });
        out.push(performance.now() - t0);
      }
      return out;
    });
    const sorted = [...times];
    sorted.sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length * 0.95)]).toBeLessThan(100);
  });

  test('kill path: C in an infinite loop is killed after killAfterMs and restarted', async ({
    page,
  }) => {
    await open(page, '?killAfterMs=1500');
    await page.evaluate(() => {
      const crashes: { id: string; reason: string }[] = [];
      window.kernel.on('isolate:crash', ({ id, reason }) => crashes.push({ id, reason }));
      Object.assign(window, { crashes });
    });
    await pane(page, 'C').getByRole('button', { name: 'Hang' }).click();
    await expect(status(page, 'C')).toContainText('blocked', { timeout: 2_000 });
    await expect(pane(page, 'C').locator('.restarts')).toHaveText('restarts: 1', {
      timeout: 5_000,
    });
    await expect(status(page, 'C')).toContainText('loop ok', { timeout: 5_000 });
    const crashes = await page.evaluate(() => Reflect.get(window, 'crashes') as unknown);
    expect(crashes).toEqual([{ id: 'C', reason: 'unresponsive' }]);
    expect((await statesOf(page)).filter((e) => e.id !== 'C')).toEqual([]);
  });
});

test('headless: supervised like any isolate, no DOM writes, measure answers no_surface', async ({
  page,
}) => {
  await page.goto(HARNESS);
  await expect(page.locator('body[data-ready]')).toBeAttached();
  const out = await page.evaluate(async (src) => {
    const writes: string[] = [];
    new MutationObserver((records) => {
      for (const r of records) writes.push(r.type);
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    const kernel = window.harness.createKernel({
      heartbeat: { blockedAfterMs: 200, killAfterMs: 800 },
    });
    const states: string[] = [];
    const reports: unknown[] = [];
    const crashes: string[] = [];
    kernel.on('isolate:state', ({ state }) => states.push(state));
    kernel.on('isolate:crash', ({ reason }) => crashes.push(reason));
    kernel.on('bus:publish', ({ topic, value }) => {
      if (topic === 'headless') reports.push(value);
    });
    kernel.spawn({ id: 'H', src, config: { hangAfterMs: 300 } });
    // Up, blocked, killed, restarted and up again.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`states: ${states.join(' → ')}`)), 8000);
      const poll = () => {
        if (states.filter((s) => s === 'running').length >= 2) {
          clearTimeout(t);
          resolve();
        } else setTimeout(poll, 20);
      };
      poll();
    });
    await kernel.destroy();
    return {
      states,
      reports,
      crashes,
      writes,
      surfaces: document.querySelectorAll('iso-surface').length,
    };
  }, new URL('headless.js', ISOLATES_CORS).href);

  expect(out.states.slice(0, 7)).toEqual([
    'loading',
    'running',
    'blocked',
    'crashed',
    'restarting',
    'loading',
    'running',
  ]);
  expect(out.crashes[0]).toBe('unresponsive');
  expect(out.reports[0]).toEqual({ root: 'none', document: 'undefined', measure: 'no_surface' });
  expect(out.surfaces).toBe(0);
  expect(out.writes).toEqual([]);
});
