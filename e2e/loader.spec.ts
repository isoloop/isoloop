/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import './harness-types';
import { HARNESS, ISOLATES_CORS, ISOLATES_NO_CORS } from './servers';

// Loader hardening (plan m1-kernel, task 3), on the blank harness page.

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS);
  await expect(page.locator('body[data-ready]')).toBeAttached();
});

/** Spawns `src` into a fresh kernel and resolves with the first ready or crash. */
const spawnOne = (src: string) =>
  new Promise<{ ok: true; text: string } | { ok: false; reason: string; message: string }>(
    (resolve) => {
      const kernel = window.harness.createKernel({ supervisor: { strategy: 'never' } });
      const surface = document.createElement('section');
      document.getElementById('root')?.append(surface);
      kernel.on('isolate:crash', ({ reason, message }) => {
        resolve({ ok: false, reason, message });
      });
      kernel.on('isolate:ready', () => {
        const read = () => {
          const text = surface
            .querySelector('iso-surface')
            ?.shadowRoot?.querySelector('.hello')?.textContent;
          if (text) resolve({ ok: true, text });
          else requestAnimationFrame(read);
        };
        read();
      });
      kernel.spawn({ id: 'X', src, surface });
    },
  );

test('an isolate from another origin with CORS loads', async ({ page }) => {
  const src = new URL('hello.js', ISOLATES_CORS).href;
  const out = await page.evaluate(spawnOne, src);
  expect(out).toEqual({ ok: true, text: 'hello from :4795' });
});

test('without CORS it crashes with a clear reason', async ({ page }) => {
  const src = new URL('hello.js', ISOLATES_NO_CORS).href;
  const out = await page.evaluate(spawnOne, src);
  expect(out).toMatchObject({ ok: false, reason: 'error' });
  expect(out.ok || out.message).toContain(`Could not import ${src}`);
  expect(out.ok || out.message).toContain('needs CORS headers');
});

test('a visual manifest with a pool is accepted (ADR 0015)', async ({ page }) => {
  const code = await page.evaluate(() => {
    const kernel = window.harness.createKernel();
    try {
      const surface = document.createElement('div');
      kernel.spawn({ id: 'P', src: './nowhere.js', surface, pool: 'light' });
      return 'spawned';
    } catch (err) {
      return err instanceof Error && 'code' in err ? err.code : 'unknown';
    }
  });
  expect(code).toBe('spawned');
});

test('spawning past the budget warns once and still starts every isolate', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' && m.text().includes('budget')) warnings.push(m.text());
  });
  const hello = new URL('hello.js', ISOLATES_CORS).href;
  const running = await page.evaluate(
    (src) =>
      new Promise<number>((resolve) => {
        const kernel = window.harness.createKernel({ budget: 2 });
        let ready = 0;
        kernel.on('isolate:ready', () => {
          if (++ready === 4) resolve(kernel.isolates().filter((s) => s.state === 'running').length);
        });
        for (const id of ['A', 'B', 'C', 'D']) kernel.spawn({ id, src });
      }),
    hello,
  );
  expect(running).toBe(4);
  expect(warnings).toHaveLength(1);
});
