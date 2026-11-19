/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import './harness-types';
import { HARNESS, ISOLATES_CORS } from './servers';

// The devtools panel's isolates view and controls (M4b task 8), on the harness
// page: a headless isolate, two pool members, and the panel itself, as built
// for the E2E isolate server (e2e/build-adapters.ts).

const CONTRACTS = new URL('contracts.js', ISOLATES_CORS).href;
const HEADLESS = new URL('headless.js', ISOLATES_CORS).href;
const MEMBER = new URL('pool-member.js', ISOLATES_CORS).href;
const PANEL = new URL('devtools-panel.js', ISOLATES_CORS).href;

async function openPage(page: Page): Promise<void> {
  await page.goto(HARNESS);
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await page.evaluate(
    async ({ contracts, headless, member, panel }) => {
      const kernel = await window.harness.createBusKernel(contracts, {
        supervisor: { backoff: { initialMs: 50 } },
        heartbeat: { everyMs: 100, blockedAfterMs: 400, killAfterMs: 6_000 },
      });
      window.kernel = kernel;
      kernel.spawn({
        id: 'headless',
        src: headless,
        grants: { publish: ['headless.v1'], subscribe: [] },
      });
      for (const id of ['member-a', 'member-b']) {
        kernel.spawn({
          id,
          src: member,
          pool: 'p',
          grants: { publish: ['pooled.v1'], subscribe: ['feed.v1'] },
        });
      }
      await window.harness.connectDevtools(kernel, { src: panel });
    },
    { contracts: CONTRACTS, headless: HEADLESS, member: MEMBER, panel: PANEL },
  );
}

const row = (page: Page, id: string) =>
  page.locator(`[data-isoloop-devtools] tr[data-isolate="${id}"]`);

const restartsOf = (page: Page, id: string) =>
  page.evaluate((i) => window.kernel.isolates().find((x) => x.id === i)?.restarts ?? -1, id);

test.describe('devtools: isolates view (M4b task 8)', () => {
  test.beforeEach(async ({ page }) => {
    await openPage(page);
    await page.locator('[data-isoloop-devtools] button[data-health]').click();
    await expect(page.locator('[data-isoloop-devtools] [data-view="isolates"]')).toBeVisible();
  });

  test('lists every isolate, itself marked as devtools, and the pool with its members', async ({
    page,
  }) => {
    await Promise.all(
      ['headless', 'member-a', 'member-b', 'isoloop-devtools'].map((id) =>
        expect(row(page, id)).toHaveAttribute('data-state', 'running'),
      ),
    );
    await expect(row(page, 'isoloop-devtools').locator('[data-devtools-self]')).toHaveText(
      'devtools',
    );
    await expect(row(page, 'headless').locator('[data-devtools-self]')).toHaveCount(0);
    await expect(row(page, 'member-a')).toContainText('pool p');
    const pool = page.locator('[data-isoloop-devtools] tr[data-pool="p"]');
    await expect(pool).toContainText('member-a');
    await expect(pool).toContainText('member-b');
    // Lag comes from beats; the column fills in once one has arrived.
    await expect(row(page, 'headless').locator('[data-lag]')).toHaveText(/\d+ ms/);
  });

  test('Restart restarts the isolate', async ({ page }) => {
    await page.evaluate(() => {
      const seen: string[] = [];
      Reflect.set(window, 'headlessStates', seen);
      window.kernel.on('isolate:state', (e) => {
        if (e.id === 'headless') seen.push(e.state);
      });
    });
    await row(page, 'headless').locator('[data-control="restart"]').click();
    // A restart asked for isn't a crash: the isolate loads again, and
    // `restarts` (crash restarts) stays as it was.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const seen: unknown = Reflect.get(window, 'headlessStates');
          return Array.isArray(seen) ? seen.map(String) : [];
        }),
      )
      .toContain('loading');
    await expect(row(page, 'headless')).toHaveAttribute('data-state', 'running');
    await expect(
      page.locator('[data-isoloop-devtools] [data-isoloop-devtools-status]'),
    ).toHaveCount(0);
  });

  test("Kill crashes a pool member's worker, so every member restarts", async ({ page }) => {
    await row(page, 'member-a').locator('[data-control="kill"]').click();
    await expect.poll(() => restartsOf(page, 'member-a')).toBe(1);
    await expect.poll(() => restartsOf(page, 'member-b')).toBe(1);
    await expect(row(page, 'member-b').locator('[data-restarts]')).toHaveText('1');
    await expect(row(page, 'member-b')).toHaveAttribute('data-state', 'running');
  });

  test('Block makes the isolate late, and the panel shows it blocked, then running', async ({
    page,
  }) => {
    await row(page, 'headless').locator('[data-control="block"]').click();
    await expect(row(page, 'headless')).toHaveAttribute('data-state', 'blocked');
    await expect(page.locator('[data-isoloop-devtools] button[data-health]')).toHaveCount(0);
    await expect(row(page, 'headless')).toHaveAttribute('data-state', 'running', {
      timeout: 10_000,
    });
    expect(await restartsOf(page, 'headless')).toBe(0);
  });
});
