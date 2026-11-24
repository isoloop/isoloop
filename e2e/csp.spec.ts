/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { HARNESS, ISOLATES_CORS } from './servers';

// A page that shows surfaces runs under `style-src 'self'`, with no
// 'unsafe-inline' (ADR 0010, amended 2026-11-24; #357): the host writes the
// `style` an isolate renders through the CSSOM, which CSP doesn't govern. The
// devtools panel is on the page too: it styles its own page elements.

const CONTRACTS = new URL('contracts.js', ISOLATES_CORS).href;
const STYLED = new URL('styled.js', ISOLATES_CORS).href;
const PANEL = new URL('devtools-panel.js', ISOLATES_CORS).href;
const POLICY = "style-src 'self'";
// The harness server sends POLICY as a header on this URL (e2e/harness/vite.config.ts).
const STRICT = new URL('?csp=strict', HARNESS).href;

test("isolate styles apply under style-src 'self', with no violation", async ({ page }) => {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.assign(window, { violations });
    document.addEventListener(
      'securitypolicyviolation',
      (e) => violations.push(`${e.effectiveDirective}: ${e.sample || e.blockedURI}`),
      true,
    );
  });

  const response = await page.goto(STRICT);
  expect(response?.headers()['content-security-policy']).toBe(POLICY);
  await expect(page.locator('body[data-ready]')).toBeAttached();

  await page.evaluate(
    async ({ contracts, styled, panel }) => {
      const kernel = await window.harness.createBusKernel(contracts);
      const surface = document.createElement('section');
      document.getElementById('root')?.append(surface);
      kernel.spawn({ id: 'styled', src: styled, surface });
      await window.harness.connectDevtools(kernel, { src: panel });
    },
    { contracts: CONTRACTS, styled: STYLED, panel: PANEL },
  );

  const probe = (name: string) => page.locator(`iso-surface [data-probe="${name}"]`);
  await expect(probe('later')).toHaveAttribute('data-done', '');
  const button = page.locator('[data-isoloop-devtools] button[data-health]');
  await expect(button).toBeVisible();

  const style = (name: string, props: string[]) =>
    probe(name).evaluate(
      (el, ps) => ps.map((p) => getComputedStyle(el).getPropertyValue(p)),
      props,
    );
  expect(await style('property', ['color', 'margin-left'])).toEqual(['rgb(1, 2, 3)', '7px']);
  expect(await style('attribute', ['color', 'padding-top'])).toEqual(['rgb(4, 5, 6)', '9px']);
  expect(await style('svg', ['fill'])).toEqual(['rgb(7, 8, 9)']);
  expect(await style('later', ['color'])).toEqual(['rgb(10, 11, 12)']);

  // The devtools surface on the page: fixed over the viewport, set inline.
  const surface = await page
    .locator('div[data-isoloop-devtools]')
    .evaluate((el) => [getComputedStyle(el).position, getComputedStyle(el).zIndex]);
  expect(surface).toEqual(['fixed', '2147483647']);
  // The panel's own button, rendered by its isolate through the applier.
  expect(await button.evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer');

  const violations: unknown = await page.evaluate((): unknown => Reflect.get(window, 'violations'));
  expect(violations).toEqual([]);
});
