/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import './harness-types';
import { HARNESS, ISOLATES_CORS } from './servers';

// The adapter conformance suite (M3a task 13, the epic's done-criterion): one
// fixture app per adapter and major (e2e/isolates/adapters, built by
// e2e/build-adapters.ts), through the same checks on the harness page.

const MAJORS = [
  ['preact', 10],
  ['preact', 11],
  ['react', 18],
  ['react', 19],
] as const;

const el = (page: Page, cls: string) => page.locator(`section[data-id="F"] iso-surface .${cls}`);

async function setup(page: Page, src: string): Promise<void> {
  await page.goto(HARNESS);
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await page.evaluate(
    async ({ base, src: file }) => {
      const kernel = await window.harness.createBusKernel(new URL('contracts.js', base).href, {
        heartbeat: { blockedAfterMs: 5000 },
      });
      window.kernel = kernel;
      const surface = document.createElement('section');
      surface.dataset['id'] = 'F';
      document.getElementById('root')?.append(surface);
      kernel.spawn({
        id: 'F',
        src: new URL(file, base).href,
        surface,
        grants: { publish: ['notes.v1'], subscribe: ['notes.v1'], navigate: true },
      });
    },
    { base: ISOLATES_CORS, src },
  );
}

for (const [fw, major] of MAJORS) {
  test.describe(`${fw} ${major}`, () => {
    test.beforeEach(async ({ page }) => {
      await setup(page, `adapter-${fw}-${major}.js`);
      await expect(el(page, 'fw')).toHaveText(new RegExp(`^${fw} ${major}\\.`));
    });

    test('renders, and events round-trip through the bus', async ({ page }) => {
      await expect(el(page, 'count')).toHaveText('0');
      await el(page, 'inc').click();
      await expect(el(page, 'count')).toHaveText('1');
      await el(page, 'inc').click();
      await expect(el(page, 'count')).toHaveText('2');
    });

    test('host-owned inputs keep what the user types', async ({ page }) => {
      const text = 'typed fast';
      await el(page, 'field').pressSequentially(text, { delay: 10 });
      await expect(el(page, 'echo')).toHaveText(text.toUpperCase());
      await expect(el(page, 'field')).toHaveValue(text);
    });

    test('a crash restarts the isolate, which replays its state from the log', async ({ page }) => {
      await el(page, 'inc').click();
      await el(page, 'inc').click();
      await expect(el(page, 'count')).toHaveText('2');
      await el(page, 'crash').click();
      await expect
        .poll(() => page.evaluate(() => window.kernel.isolates().find((s) => s.id === 'F')))
        .toMatchObject({ state: 'running', restarts: 1 });
      await expect(el(page, 'count')).toHaveText('2');
      await el(page, 'inc').click();
      await expect(el(page, 'count')).toHaveText('3');
    });

    test('a route change reaches the component', async ({ page }) => {
      await expect(el(page, 'path')).toHaveText('/');
      await el(page, 'go').click();
      await expect(page).toHaveURL(`${HARNESS}next`);
      await expect(el(page, 'path')).toHaveText('/next');
    });
  });
}
