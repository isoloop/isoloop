/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
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
    // Lag comes from beats; the column fills in once one has arrived.
    await expect(row(page, 'headless').locator('[data-lag]')).toHaveText(/\d+ ms/);
    // The pools are on their own sub-tab, under Isolates.
    await page.locator('[data-isoloop-devtools] [data-subtab="pools"]').click();
    const pool = page.locator('[data-isoloop-devtools] tr[data-pool="p"]');
    await expect(pool).toContainText('member-a');
    await expect(pool).toContainText('member-b');
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

test.describe('devtools: bus view (M4b task 9)', () => {
  test.beforeEach(async ({ page }) => {
    await openPage(page);
    await page.locator('[data-isoloop-devtools] button[data-health]').click();
    await page.locator('[data-isoloop-devtools] [data-tab="bus"]').click();
    await expect(page.locator('[data-isoloop-devtools] [data-view="bus"]')).toBeVisible();
  });

  test('shows topics, subscriptions with lag and credit, and rejected publishes', async ({
    page,
  }) => {
    const bus = page.locator('[data-isoloop-devtools] [data-view="bus"]');
    await expect(bus.locator('[data-bus-state]')).toHaveAttribute('data-bus-state', 'running');
    const rejected = await page.evaluate(async () => {
      await Promise.all(
        [1, 2, 3].map((value) => window.kernel.publish({ name: 'feed.v1' }, value)),
      );
      try {
        await window.kernel.publish({ name: 'feed.v1' }, 'not a number');
        return 'accepted';
      } catch (e) {
        return e instanceof Error && 'code' in e ? String(e.code) : 'threw';
      }
    });
    expect(rejected).toBe('invalid');

    // Metrics come about once a second.
    const topic = bus.locator('tr[data-topic="feed.v1"]');
    await expect(topic.locator('[data-head]')).toHaveText('3');
    await expect(topic.locator('[data-retained]')).toHaveText('3');
    // Subscriptions and rejected publishes are sub-tabs of their own.
    await page.locator('[data-isoloop-devtools] [data-subtab="subscriptions"]').click();
    await expect(bus.locator('tr[data-subscription="feed.v1"]')).not.toHaveCount(0);
    await expect(bus.locator('tr[data-subscription="feed.v1"] [data-lag]').first()).toHaveText(
      /^\d+$/,
    );
    await expect(bus.locator('tr[data-subscription="feed.v1"] [data-credit]').first()).toHaveText(
      /^\d+$/,
    );
    await page.locator('[data-isoloop-devtools] [data-subtab="rejected"]').click();
    await expect(bus.locator('[data-rejected="invalid"]')).toContainText('1');
  });

  test('arrow keys move between the tabs', async ({ page }) => {
    const busTab = page.locator('[data-isoloop-devtools] [data-tab="bus"]');
    await busTab.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('[data-isoloop-devtools] [data-tab="isolates"]')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-isoloop-devtools] [data-view="isolates"]')).toBeVisible();
    await expect(page.locator('[data-isoloop-devtools] [data-tab="isolates"]')).toBeFocused();
  });
});

// The pool members publish on `pooled.v1` after each record they read, so
// rows are picked by topic.
const log = (page: Page, topic = 'feed.v1') =>
  page.locator(`[data-isoloop-devtools] [data-log-table] tbody tr[data-log-topic="${topic}"]`);
const rows = (page: Page) => page.locator('[data-isoloop-devtools] [data-log-table] tbody tr');
const publish = (page: Page, topic: string, value: unknown) =>
  page.evaluate(([t, v]) => window.kernel.publish({ name: t }, v), [topic, value] as const);

test.describe('devtools: live record log (M4b task 10)', () => {
  test.beforeEach(async ({ page }) => {
    await openPage(page);
    await page.locator('[data-isoloop-devtools] button[data-health]').click();
    await page.locator('[data-isoloop-devtools] [data-tab="messages"]').click();
    await expect(page.locator('[data-isoloop-devtools] [data-view="messages"]')).toBeVisible();
  });

  test('shows records as they are appended, newest first, and filters by topic', async ({
    page,
  }) => {
    await publish(page, 'feed.v1', 41);
    await publish(page, 'feed.v1', 42);
    await expect(log(page)).toHaveCount(2);
    // Newest first.
    await expect(log(page).first()).toContainText('42');
    await expect(log(page).nth(1)).toContainText('41');

    await page.locator('[data-isoloop-devtools] [data-log-filter]').fill('notes.*');
    await page.locator('[data-isoloop-devtools] [data-log-apply]').click();
    await expect(page.locator('[data-isoloop-devtools] [data-view="messages"]')).toContainText(
      'Tapping notes.*',
    );
    await publish(page, 'feed.v1', 777);
    await publish(page, 'notes.v1', 'hello');
    await expect(rows(page).first()).toContainText('hello');
    await expect(rows(page).first()).toHaveAttribute('data-log-topic', 'notes.v1');
    await expect(log(page).filter({ hasText: '777' })).toHaveCount(0);
  });

  test('keeps logging through a bus restart', async ({ page }) => {
    await publish(page, 'feed.v1', 1);
    await expect(log(page)).toHaveCount(1);
    await page.evaluate(async () => {
      const ready = new Promise<void>((resolve) => {
        const off = window.kernel.on('bus:ready', (e) => {
          if (!e.first) {
            off();
            resolve();
          }
        });
      });
      window.kernel.debug.crashBus();
      await ready;
    });
    await publish(page, 'feed.v1', 31_337);
    await expect(log(page).first()).toContainText('31337');
    await expect(log(page)).toHaveCount(2);
  });

  test('counts the records left out over the cap, from zero each time it opens', async ({
    page,
  }) => {
    const counter = page.locator('[data-isoloop-devtools] [data-log-skipped]');
    await expect(counter).toHaveText('50/s cap · 0 skipped');
    await page.evaluate(() =>
      Promise.all(
        Array.from({ length: 200 }, (_, i) => window.kernel.publish({ name: 'notes.v1' }, `n${i}`)),
      ),
    );
    await expect
      .poll(async () => Number(await counter.getAttribute('data-log-skipped')), { timeout: 10_000 })
      .toBeGreaterThan(0);
    // Leaving the tab ends the tap; reopening starts the count again.
    await page.locator('[data-isoloop-devtools] [data-tab="bus"]').click();
    await page.locator('[data-isoloop-devtools] [data-tab="messages"]').click();
    await expect(counter).toHaveText('50/s cap · 0 skipped');
  });
});
