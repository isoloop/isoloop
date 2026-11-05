/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import './harness-types';
import { HARNESS, ISOLATES_CORS } from './servers';

// The isoloop.route.v1 system topic, navigate and links (plan m2-bus task 10,
// ADR 0002), with route.js isolates on the harness page.

type Setup = {
  /** Grant `navigate` to the R isolate. */
  navigate?: boolean;
  /** R's config. */
  config?: { to?: string; link?: string };
  basePath?: string;
  /** `throws`: onNavigate throws; otherwise the default history hook. */
  onNavigate?: 'throws';
  /** Also spawn N, which never subscribes to the route. */
  bystander?: boolean;
};

const surface = (page: Page, id: string) => page.locator(`section[data-id="${id}"] iso-surface`);
const text = (page: Page, cls: string, id = 'R') => surface(page, id).locator(`.${cls}`);

async function setup(page: Page, o: Setup = {}): Promise<void> {
  await page.goto(HARNESS);
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await page.evaluate(
    async ({ base, o: opts }) => {
      const kernel = await window.harness.createBusKernel(new URL('contracts.js', base).href, {
        ...(opts.basePath === undefined ? {} : { basePath: opts.basePath }),
        ...(opts.onNavigate === 'throws'
          ? {
              onNavigate: () => {
                throw new Error('router broke');
              },
            }
          : {}),
      });
      window.kernel = kernel;
      const errors: unknown[] = [];
      kernel.on('route:navigate_error', (e) => errors.push(e));
      Object.assign(window, { navigateErrors: errors });
      const spawn = (id: string, config: unknown, navigate: boolean) => {
        const el = document.createElement('section');
        el.dataset['id'] = id;
        document.getElementById('root')?.append(el);
        kernel.spawn({
          id,
          src: new URL('route.js', base).href,
          surface: el,
          config,
          grants: { publish: [], subscribe: [], navigate },
        });
      };
      spawn('R', opts.config ?? {}, opts.navigate ?? false);
      if (opts.bystander) spawn('N', { subscribe: false }, false);
    },
    { base: ISOLATES_CORS, o },
  );
  // The harness is served at `/`, outside any other base: `path` is null there.
  await expect(text(page, 'path')).toHaveText(o.basePath ? '(outside)' : '/');
}

test('an isolate renders the current path from the route topic', async ({ page }) => {
  await setup(page);
  await expect(text(page, 'seen')).toHaveText('1');
});

test('with the grant, navigate updates the URL, and the route record is in the log before it resolves', async ({
  page,
}) => {
  await setup(page, { navigate: true });
  await text(page, 'go').click();
  await expect(text(page, 'result')).toHaveText('true');
  await expect(page).toHaveURL(`${HARNESS}x`);
  await expect(text(page, 'path')).toHaveText('/x');
  await expect(text(page, 'committed')).toHaveText('yes');
});

test('without the grant, navigate rejects with forbidden', async ({ page }) => {
  await setup(page);
  await text(page, 'go').click();
  await expect(text(page, 'result')).toHaveText('forbidden');
  await expect(page).toHaveURL(HARNESS);
});

test('navigate to another origin rejects with cross_origin', async ({ page }) => {
  await setup(page, { navigate: true, config: { to: 'https://other.example/' } });
  await text(page, 'go').click();
  await expect(text(page, 'result')).toHaveText('cross_origin');
  await expect(page).toHaveURL(HARNESS);
});

test('a throwing onNavigate rejects with navigate_failed and emits route:navigate_error', async ({
  page,
}) => {
  await setup(page, { navigate: true, onNavigate: 'throws' });
  await text(page, 'go').click();
  await expect(text(page, 'result')).toHaveText('navigate_failed');
  const errors: unknown = await page.evaluate((): unknown => Reflect.get(window, 'navigateErrors'));
  expect(errors).toEqual([{ from: 'R', href: `${HARNESS}x`, error: 'router broke' }]);
});

test('a host pushState and syncRoute reach subscribed isolates and nothing else', async ({
  page,
}) => {
  await setup(page, { bystander: true });
  await expect(text(page, 'path', 'N')).toHaveText('…');
  await page.evaluate(() => {
    history.pushState({ from: 'host' }, '', '/orders/7');
    window.kernel.syncRoute();
  });
  await expect(text(page, 'path')).toHaveText('/orders/7');
  await expect(text(page, 'seen')).toHaveText('2');
  // N never subscribed: the bus delivers it nothing.
  await expect(text(page, 'seen', 'N')).toHaveText('0');
});

test('a link click navigates without the navigate grant', async ({ page }) => {
  await setup(page);
  await text(page, 'link').click();
  await expect(page).toHaveURL(`${HARNESS}linked`);
  await expect(text(page, 'path')).toHaveText('/linked');
});

test('a Ctrl-click is not intercepted and opens the rewritten href', async ({ page, context }) => {
  await setup(page, { basePath: '/app/' });
  const link = text(page, 'link');
  await expect(link).toHaveAttribute('href', `${HARNESS}app/linked`);
  const opened = context.waitForEvent('page');
  await link.click({ modifiers: ['ControlOrMeta'] });
  const tab = await opened;
  await tab.waitForLoadState('domcontentloaded').catch(() => {});
  expect(tab.url()).toBe(`${HARNESS}app/linked`);
  await expect(page).toHaveURL(HARNESS);
});

test('after a bus crash, subscribers get one reset, then the current route', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    history.pushState(null, '', '/before-crash');
    window.kernel.syncRoute();
  });
  await expect(text(page, 'path')).toHaveText('/before-crash');
  await page.evaluate(() => {
    window.kernel.debug.crashBus();
  });
  await expect(text(page, 'resets')).toHaveText('1');
  await expect(text(page, 'seen')).toHaveText('3');
  await expect(text(page, 'path')).toHaveText('/before-crash');
});
