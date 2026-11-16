/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import './harness-types';
import { HARNESS, ISOLATES_CORS } from './servers';

/*
 * Busy time (ADR 0017) through the kernel, with production builds: two React
 * widgets in one pool, one spinning 3 ms per render, the other not. Their
 * renders change nothing in the DOM, so the heavy one's renders reach its
 * `busyMs` only through react-dom calling the commit hook the runtime installs.
 */

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS);
  await expect(page.locator('body[data-ready]')).toBeAttached();
});

for (const major of [18, 19]) {
  test(`a heavy React ${major} widget's renders are its busy time, not its neighbour's`, async ({
    page,
  }) => {
    const sums = await page.evaluate(
      async ({ base, src }) => {
        const kernel = window.harness.createKernel();
        const layout = [
          ['heavy', { burnMs: 3, everyMs: 23 }],
          ['light', { burnMs: 0, everyMs: 17 }],
        ] as const;
        for (const [id, config] of layout) {
          const surface = document.createElement('section');
          document.getElementById('root')?.append(surface);
          kernel.spawn({ id, src: new URL(src, base).href, config, surface, pool: 'p' });
        }
        // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        await wait(800);
        const out: Record<string, number> = { heavy: 0, light: 0 };
        // Each beat's `busyMs` covers one interval: count each beat once.
        const counted: Record<string, number> = {};
        const until = performance.now() + 2000;
        while (performance.now() < until) {
          // oxlint-disable-next-line no-await-in-loop -- reads faster than the 100 ms beat
          await wait(30);
          for (const s of kernel.isolates()) {
            if (counted[s.id] === s.lastBeatAt) continue;
            counted[s.id] = s.lastBeatAt;
            out[s.id] = (out[s.id] ?? 0) + (s.busyMs ?? 0);
          }
        }
        await kernel.destroy();
        return out;
      },
      { base: ISOLATES_CORS, src: `adapter-busy-widget-react-${major}.js` },
    );
    // About 85 renders of 3 ms each; without the hook, close to 0.
    expect(sums['heavy']).toBeGreaterThan(80);
    expect(sums['light'] ?? 0).toBeLessThan((sums['heavy'] ?? 0) / 2);
  });
}
