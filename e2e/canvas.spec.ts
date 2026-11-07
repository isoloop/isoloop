/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import './harness-types';
import { HARNESS, ISOLATES_CORS } from './servers';

// requestCanvas (M3a task 14, design §4.7): an isolate draws on the canvas
// the host rendered for it, from its worker.

test('a canvas isolate draws a red square', async ({ page }) => {
  await page.goto(HARNESS);
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await page.evaluate((src) => {
    const kernel = window.harness.createKernel();
    const surface = document.createElement('section');
    document.getElementById('root')?.append(surface);
    kernel.spawn({ id: 'C', src, surface });
  }, new URL('canvas.js', ISOLATES_CORS).href);
  await expect(page.locator('iso-surface .done')).toHaveText('drawn');
  await expect(page.locator('iso-surface .square')).toHaveScreenshot('red-square.png');
});
