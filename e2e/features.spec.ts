/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import './harness-types';
import { HARNESS } from './servers';

// The browser feature check (plan m1-kernel, task 3b) passes in every engine CI runs.

test('createKernel finds every feature it needs', async ({ page }) => {
  await page.goto(HARNESS);
  await expect(page.locator('body[data-ready]')).toBeAttached();
  const out = await page.evaluate(async () => {
    try {
      await window.harness.createKernel().destroy();
      return 'ok';
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  });
  expect(out).toBe('ok');
});
