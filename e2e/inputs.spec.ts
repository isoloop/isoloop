/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import './harness-types';
import { HARNESS, ISOLATES_CORS } from './servers';

// EventBridge, default actions and host-owned inputs (plan m1-kernel, task 8),
// with an isoloop-dom isolate on the blank harness page.

const field = (page: Page) => page.locator('iso-surface .field');

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS);
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await page.evaluate((src) => {
    // No busy overlay during the 1 s block: the test types through it.
    const kernel = window.harness.createKernel({ heartbeat: { blockedAfterMs: 5000 } });
    const surface = document.createElement('section');
    document.getElementById('root')?.append(surface);
    kernel.spawn({ id: 'I', src, surface });
  }, new URL('inputs.js', ISOLATES_CORS).href);
  await expect(field(page)).toBeVisible();
});

test('typing fast while the isolate is blocked loses no characters and keeps the caret', async ({
  page,
}) => {
  const text = 'the quick brown fox';
  // Log every value the host writes into the input from now on.
  await field(page).evaluate((el: HTMLInputElement) => {
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const writes: string[] = [];
    Object.defineProperty(el, 'value', {
      configurable: true,
      get: (): unknown => proto?.get?.call(el),
      set: (v: string) => {
        writes.push(v);
        proto?.set?.call(el, v);
      },
    });
    Object.assign(window, { valueWrites: writes });
  });
  // Blocks the worker for 1 s; every keystroke queues behind it.
  await page.locator('iso-surface .block').click();
  await field(page).focus();
  await page.keyboard.type(text, { delay: 15 });
  await expect(field(page)).toHaveValue(text);
  // The isolate catches up and writes every intermediate value back,
  // upper-cased ("T", "TH", …): the host applies none of them while focused.
  await expect(page.locator('iso-surface .echo')).toHaveText(text, { timeout: 5000 });
  await expect(field(page)).toHaveValue(text);
  const writes: unknown = await page.evaluate((): unknown => Reflect.get(window, 'valueWrites'));
  expect(writes).toEqual([]);
  const caret = await field(page).evaluate((el: HTMLInputElement) => el.selectionStart);
  expect(caret).toBe(text.length);
});

test('a form submit never navigates the page, and the isolate still hears it', async ({ page }) => {
  const url = page.url();
  await page.locator('iso-surface button[type=submit]').click();
  await field(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('iso-surface .status')).toHaveText('submitted');
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => document.body.dataset['ready'])).toBe('true');
});
