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
  // D clears its box with a forced value (M3a task 6): no blur, focus stays.
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await input.pressSequentially('next');
  await expect(input).toHaveValue('next');
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

test('(g) P (Preact) and R (React) share vote.v1, and a crashed R replays the tally', async ({
  page,
}) => {
  const tally = (id: string) => pane(page, id).locator('.tally');
  await expect(tally('P')).toHaveText('0 : 0');
  await pane(page, 'P').locator('.vote').click();
  await pane(page, 'R').locator('.vote').click();
  await pane(page, 'R').locator('.vote').click();
  await expect(tally('P')).toHaveText('1 : 2');
  await expect(tally('R')).toHaveText('1 : 2');
  await pane(page, 'R').locator('.crash').click();
  await expect(pane(page, 'R').locator('.restarts')).toHaveText('restarts: 1');
  await expect(tally('R')).toHaveText('1 : 2');
  await pane(page, 'R').locator('.vote').click();
  await expect(tally('P')).toHaveText('1 : 3');
});

test('(h) the persistent topics outlive a bus crash and a reload; memory ones start over', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit',
    "Playwright's WebKit has no OPFS: every topic runs in memory",
  );
  const inc = pane(page, 'A').getByRole('button', { name: 'Increment' });
  const store = pane(page, 'D').locator('.store');
  const tally = pane(page, 'P').locator('.tally');
  // oxlint-disable-next-line no-await-in-loop -- clicks, one after another
  for (let i = 0; i < 3; i++) await inc.click();
  const input = pane(page, 'D').getByPlaceholder('Send a note to A');
  await input.fill('kept');
  await input.press('Enter');
  await pane(page, 'P').locator('.vote').click();
  await expect(store).toHaveText('store: count 3, notes 1');
  await expect(tally).toHaveText('1 : 0');

  // The bus dies: nothing on the persistent topics is lost, and no isolate restarts.
  await page.getByRole('button', { name: 'Crash the bus' }).click();
  await inc.click();
  await expect(counter(page)).toHaveText('4');
  await expect(store).toHaveText('store: count 4, notes 1');
  await expect(pane(page, 'A').locator('.restarts')).toHaveText('');

  // A reload: the old page's bus lets go of the files a moment later.
  await page.reload();
  await Promise.all(
    ALL.map((id) => expect(status(page, id)).toContainText('loop ok', { timeout: 10_000 })),
  );
  await expect(counter(page)).toHaveText('4', { timeout: 10_000 });
  await expect(store).toHaveText('store: count 4, notes 1');
  await expect(pane(page, 'D').locator('.log')).toContainText('D note: kept');
  // vote.v1 is a memory topic: it starts over.
  await expect(tally).toHaveText('0 : 0');
  await inc.click();
  await expect(store).toHaveText('store: count 5, notes 1');
});
