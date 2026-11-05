/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import './harness-types';

// The M2 done-criterion (RFC 0001): a restarted isolate rebuilds its state
// from the log. Plan m2-bus task 12, against the four-loops demo.

const pane = (page: Page, id: string) => page.locator(`section[data-isolate="${id}"]`);
const status = (page: Page, id: string) => pane(page, id).locator('.status');
const d = (page: Page, cls: string) => pane(page, 'D').locator(`.${cls}`);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await Promise.all(
    ['A', 'B', 'C', 'D'].map((id) =>
      expect(status(page, id)).toContainText('loop ok', { timeout: 10_000 }),
    ),
  );
  await expect
    .poll(() => page.evaluate(() => window.kernel.isolates().find((s) => s.id === 'S')?.state))
    .toBe('running');
  // Five counts from A, two notes from D.
  const inc = pane(page, 'A').getByRole('button', { name: 'Increment' });
  for (let i = 1; i <= 5; i++) {
    // oxlint-disable-next-line no-await-in-loop -- in order on purpose
    await inc.click();
    // oxlint-disable-next-line no-await-in-loop -- in order on purpose
    await expect(pane(page, 'A').locator('.big')).toHaveText(String(i));
  }
  const input = pane(page, 'D').getByPlaceholder('Send a note to A');
  for (const text of ['first note', 'second note']) {
    // oxlint-disable-next-line no-await-in-loop -- in order on purpose
    await input.fill(text);
    // oxlint-disable-next-line no-await-in-loop -- in order on purpose
    await input.press('Enter');
    // oxlint-disable-next-line no-await-in-loop -- in order on purpose
    await expect(d(page, 'log')).toContainText(`D note: ${text}`);
  }
  await expect(d(page, 'replayed')).toHaveText('7 records read');
  await expect(d(page, 'store')).toHaveText('store: count 5, notes 2');
});

test('a crashed D replays its log and shows the same history, with no new events', async ({
  page,
}) => {
  const before = await d(page, 'log').textContent();
  await pane(page, 'D').getByRole('button', { name: 'Crash' }).click();
  await expect(pane(page, 'D').locator('.restarts')).toHaveText('restarts: 1', { timeout: 3_000 });
  await expect(status(page, 'D')).toContainText('loop ok', { timeout: 5_000 });
  // The new D read exactly the seven records from the log, nothing new.
  await expect(d(page, 'replayed')).toHaveText('7 records read');
  await expect(d(page, 'log')).toHaveText(before ?? '');
  await expect(d(page, 'store')).toHaveText('store: count 5, notes 2');
});

test('a restarted headless store rebuilds from its command topics; readers keep the latest state', async ({
  page,
}) => {
  // Sample D's view of store.v1 every frame while S restarts.
  await page.evaluate(() => {
    const seen: string[] = [];
    const tick = () => {
      const text =
        document
          .querySelector('section[data-isolate="D"] iso-surface')
          ?.shadowRoot?.querySelector('.store')?.textContent ?? '';
      if (!seen.includes(text)) seen.push(text);
      if (!Reflect.get(window, 'storeSamplesDone')) requestAnimationFrame(tick);
    };
    tick();
    Object.assign(window, { storeSamples: seen });
    void window.kernel.restart('S');
  });
  await expect
    .poll(() => page.evaluate(() => window.kernel.isolates().find((s) => s.id === 'S')?.state))
    .toBe('running');
  await page.waitForTimeout(500);
  const samples: unknown = await page.evaluate((): unknown => {
    Object.assign(window, { storeSamplesDone: true });
    return Reflect.get(window, 'storeSamples');
  });
  expect(samples).toEqual(['store: count 5, notes 2']);
  // The rebuilt store is live: a new count reaches it, and through it D.
  await pane(page, 'A').getByRole('button', { name: 'Increment' }).click();
  await expect(d(page, 'store')).toHaveText('store: count 6, notes 2');
  // I7: none of this crossed the main thread.
  const counts = await page.evaluate(() => window.__isoloop.messages());
  expect(counts['deliver'] ?? 0).toBe(0);
  expect(counts['publish'] ?? 0).toBe(0);
});
