/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import './harness-types';

// The proof of concept's guarantees, checked against the built demo. These
// become the I2/I3 regression tests in M1 (plan m0-foundations, task 8).

const pane = (page: Page, id: string) => page.locator(`section[data-isolate="${id}"]`);
const status = (page: Page, id: string) => pane(page, id).locator('.status');
const counter = (page: Page) => pane(page, 'A').locator('.big');
const seconds = async (page: Page): Promise<number> =>
  Number.parseFloat((await pane(page, 'B').locator('.big').textContent()) ?? '');

const ALL = ['A', 'B', 'C', 'D'];

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await Promise.all(
    ALL.map((id) => expect(status(page, id)).toContainText('loop ok', { timeout: 10_000 })),
  );
});

test('(a) all four isolates reach loop ok', async ({ page }) => {
  await Promise.all(
    ALL.flatMap((id) => [
      expect(status(page, id)).toHaveText(/^loop ok · lag \d+ms$/),
      expect(pane(page, id).locator('.restarts')).toHaveText(''),
    ]),
  );
});

test('(b) blocking C leaves B ticking and A responsive', async ({ page }) => {
  await pane(page, 'C').getByRole('button', { name: 'Block this loop 3s' }).click();
  await expect(status(page, 'C')).toContainText('blocked', { timeout: 2_000 });

  const before = await seconds(page);
  await pane(page, 'A').getByRole('button', { name: 'Increment' }).click();
  await expect(counter(page)).toHaveText('1', { timeout: 1_000 });
  await expect.poll(() => seconds(page), { timeout: 2_000 }).toBeGreaterThan(before + 0.5);
  await expect(status(page, 'C')).toContainText('blocked');

  // C comes back on its own and gets what queued up while it was blocked.
  await expect(status(page, 'C')).toContainText('loop ok', { timeout: 5_000 });
  await expect(pane(page, 'C')).toContainText('blocked for 3000 ms');
  await expect(pane(page, 'C')).toContainText('Last count from A: 1.');
});

const crashC = async (page: Page) => {
  await expect(status(page, 'C')).toContainText('loop ok', { timeout: 5_000 });
  await pane(page, 'C').getByRole('button', { name: 'Crash' }).click();
};

test('(c) a crash in C restarts it after the backoff; the others never notice', async ({
  page,
}) => {
  await crashC(page);
  await expect(pane(page, 'C').locator('.restarts')).toHaveText('restarts: 1', { timeout: 3_000 });
  await expect(status(page, 'C')).toContainText('loop ok', { timeout: 5_000 });
  await expect(pane(page, 'C').locator('.crash-overlay')).toBeHidden();
  await expect(pane(page, 'C')).toContainText('nothing yet');
  await Promise.all(
    ['A', 'B', 'D'].flatMap((id) => [
      expect(status(page, id)).toContainText('loop ok'),
      expect(pane(page, id).locator('.restarts')).toHaveText(''),
    ]),
  );
});

test('(d) a note typed in D appears in A', async ({ page }) => {
  const input = pane(page, 'D').getByPlaceholder('Send a note to A');
  await input.fill('hello from D');
  await input.press('Enter');
  await expect(pane(page, 'A')).toContainText('D says: hello from D');
  await expect(pane(page, 'D').locator('.log li').first()).toHaveText('D note: hello from D');
  await expect(input).toHaveValue('');
});

test('(f) I7: bus records travel worker to worker; none crosses the main thread', async ({
  page,
}) => {
  await pane(page, 'A').getByRole('button', { name: 'Increment' }).click();
  const input = pane(page, 'D').getByPlaceholder('Send a note to A');
  await input.fill('note one');
  await input.press('Enter');
  await expect(pane(page, 'A')).toContainText('D says: note one');
  await expect(pane(page, 'D').locator('.log')).toContainText('A count = 1');
  const counts: Record<string, number> = await page.evaluate(() => window.__isoloop.messages());
  // What the main thread saw from isolate workers and the bus control port.
  expect(counts['beat']).toBeGreaterThan(0);
  expect(counts['patch']).toBeGreaterThan(0);
  for (const t of ['publish', 'deliver', 'subscribe', 'commit', 'x-pub', 'x-sub'])
    expect(counts[t] ?? 0).toBe(0);
});

test('(e) the fourth crash within 60 s fails C and shows the fallback; Retry brings it back', async ({
  page,
}) => {
  for (let i = 1; i <= 3; i++) {
    // Sequential on purpose: each crash waits for the restart before the next.
    // oxlint-disable-next-line no-await-in-loop
    await crashC(page);
    // oxlint-disable-next-line no-await-in-loop
    await expect(pane(page, 'C').locator('.restarts')).toHaveText(`restarts: ${i}`, {
      timeout: 5_000,
    });
  }
  await crashC(page);
  await expect(status(page, 'C')).toHaveText('failed', { timeout: 3_000 });
  const fallback = pane(page, 'C').locator('.iso-fallback');
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText('"C" stopped working');
  await expect(fallback).toContainText('Isolate C threw on purpose');
  await Promise.all(['A', 'B', 'D'].map((id) => expect(status(page, id)).toContainText('loop ok')));

  await fallback.getByRole('button', { name: 'Retry' }).click();
  await expect(status(page, 'C')).toContainText('loop ok', { timeout: 5_000 });
  await expect(fallback).toBeHidden();
});
