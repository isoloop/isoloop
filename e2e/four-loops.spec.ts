import { expect, test, type Page } from '@playwright/test';

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

test('(c) a crash in C shows the overlay, then C restarts once', async ({ page }) => {
  await pane(page, 'C').getByRole('button', { name: 'Crash' }).click();
  const overlay = pane(page, 'C').locator('.crash-overlay');
  await expect(overlay).toBeVisible({ timeout: 2_000 });
  await expect(overlay).toContainText('Federate C threw on purpose');
  await expect(overlay).toContainText('supervisor restarting');
  await expect(status(page, 'C')).toHaveText('crashed');

  await expect(status(page, 'C')).toContainText('loop ok', { timeout: 5_000 });
  await expect(overlay).toBeHidden();
  await expect(pane(page, 'C').locator('.restarts')).toHaveText('restarts: 1');
  // The others never noticed.
  await Promise.all(['A', 'B', 'D'].map((id) => expect(status(page, id)).toContainText('loop ok')));
});

test('(d) a note typed in D appears in A', async ({ page }) => {
  const input = pane(page, 'D').getByPlaceholder('Send a note to A');
  await input.fill('hello from D');
  await input.press('Enter');
  await expect(pane(page, 'A')).toContainText('D says: hello from D');
  await expect(pane(page, 'D').locator('.log li').first()).toHaveText('me → note: hello from D');
  await expect(input).toHaveValue('');
});
