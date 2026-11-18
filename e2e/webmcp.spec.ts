/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import './harness-types';
import { HARNESS, ISOLATES_CORS } from './servers';
import { callTool, listTools } from './webmcp';

// `@isoloop/webmcp` end to end (M4a task 9, decision 15): a real page runs
// `connectWebMCP`, and Playwright calls its tools the way a browser agent
// would, through the browser's own WebMCP. Only the `chromium-webmcp`
// project launches Chromium with `--enable-features=WebMCP`; in the other
// projects WebMCP is missing, so only the "does nothing" case runs.

const CONTRACTS = new URL('webmcp-contracts.js', ISOLATES_CORS).href;
const ANSWERER = new URL('webmcp-answerer.js', ISOLATES_CORS).href;
const ASK = 'webmcp.ask.v1';
const ACT = 'webmcp.act.v1';

type Setup = {
  mode?: 'echo' | 'block' | 'crash-live' | 'die';
  timeoutMs?: number;
  strategy?: 'one-for-one' | 'never';
};

/**
 * The harness page with a kernel exposing `webmcp.*`, one answerer in `mode`
 * on both tools, and `connectWebMCP`. Resolves once the answerer is up (or,
 * for `die` without restarts, has failed). Collects the page's console.
 */
async function openPage(page: Page, s: Setup = {}): Promise<string[]> {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto(HARNESS);
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await page.evaluate(
    async ({ contracts, answerer, mode, timeoutMs, strategy, topics }) => {
      const kernel = await window.harness.createBusKernel(contracts, {
        agents: { expose: ['webmcp.*'], ...(timeoutMs === undefined ? {} : { timeoutMs }) },
        heartbeat: { everyMs: 100, blockedAfterMs: 400, killAfterMs: 1_500 },
        supervisor: { strategy, backoff: { initialMs: 50 } },
      });
      window.kernel = kernel;
      await new Promise<void>((resolve) => kernel.on('bus:ready', () => resolve()));
      const settled = new Promise<void>((resolve) => {
        kernel.on('isolate:ready', () => resolve());
        kernel.on('isolate:failed', () => resolve());
      });
      kernel.spawn({
        id: 'answerer',
        src: answerer,
        grants: { publish: [], subscribe: topics },
        config: { mode, topics },
      });
      await settled;
      window.disconnectWebMCP = await window.harness.connectWebMCP(kernel);
    },
    {
      contracts: CONTRACTS,
      answerer: ANSWERER,
      mode: s.mode ?? 'echo',
      timeoutMs: s.timeoutMs,
      strategy: s.strategy ?? 'one-for-one',
      topics: [ASK, ACT],
    },
  );
  return logs;
}

/** Whether the page's main thread still runs: two animation frames come back. */
const pageRuns = (page: Page): Promise<boolean> =>
  page.evaluate(
    () =>
      new Promise<boolean>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))),
      ),
  );

test.describe('with WebMCP', () => {
  test.beforeEach(() => {
    test.skip(
      test.info().project.name !== 'chromium-webmcp',
      'WebMCP needs the chromium-webmcp project',
    );
  });

  test('registers the exposed tools with their schemas and hints', async ({ page }) => {
    await openPage(page);
    const tools = await listTools(page);
    expect(new Set(tools.map((t) => t.name))).toEqual(new Set([ASK, ACT]));
    const ask = tools.find((t) => t.name === ASK);
    const act = tools.find((t) => t.name === ACT);
    const input = { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] };
    expect(ask).toMatchObject({
      description: 'Answers a question with an echo',
      inputSchema: input,
    });
    expect(ask?.annotations).toEqual({ readOnly: true });
    expect(act).toMatchObject({ description: 'Acts on a question', inputSchema: input });
    expect(act?.annotations).toEqual({ consequential: true, untrustedContent: true });
    // The title isn't in Playwright's listing; the page's own sees it.
    const titles = await page.evaluate(async () => {
      // Chromium's draft API, untyped in lib.dom.
      const mc: unknown = Reflect.get(document, 'modelContext');
      const getTools: unknown = mc && Reflect.get(Object(mc), 'getTools');
      if (typeof getTools !== 'function') return {};
      const listed: unknown = await Reflect.apply(getTools, mc, []);
      const named = Array.isArray(listed) ? listed : [];
      return Object.fromEntries(
        named.map((t: unknown) => [
          String(Reflect.get(Object(t), 'name')),
          Reflect.get(Object(t), 'title') ?? null,
        ]),
      );
    });
    expect(titles[ASK]).toBe('Ask');
    expect(titles[ACT]).toBeFalsy();
  });

  test('a call returns the reply, made with via webmcp', async ({ page }) => {
    await openPage(page);
    const r = await callTool(page, ASK, { q: 'hi' });
    expect(r).toMatchObject({ ok: true, value: { a: 'echo:hi', via: 'webmcp' } });
  });

  test('a blocked isolate makes the call time out, and the page keeps running', async ({
    page,
  }) => {
    const logs = await openPage(page, { mode: 'block', timeoutMs: 600 });
    const r = await callTool(page, ASK, { q: 'stuck' });
    expect(r.ok).toBe(false);
    expect(r.ms).toBeGreaterThanOrEqual(550);
    expect(r.ms).toBeLessThan(3_000);
    expect(await pageRuns(page)).toBe(true);
    // The browser tells the agent only that the tool failed; the page's
    // console has the kernel's BusError.
    await expect
      .poll(() => logs.find((l) => l.includes('BusError')))
      .toMatch(/webmcp\.ask\.v1 within 600 ms/);
  });

  test('a crash mid-call: the isolate restarts and the reply still arrives', async ({ page }) => {
    await openPage(page, { mode: 'crash-live', timeoutMs: 8_000 });
    const crashed = page.evaluate(
      () =>
        new Promise<string>((resolve) => window.kernel.on('isolate:crash', (e) => resolve(e.id))),
    );
    const r = await callTool(page, ASK, { q: 'again' });
    expect(r).toMatchObject({ ok: true, value: { a: 'echo:again', via: 'webmcp' } });
    expect(r.ms).toBeLessThan(8_000);
    expect(await crashed).toBe('answerer');
  });

  test('every responder failed: no_responder at once', async ({ page }) => {
    const logs = await openPage(page, { mode: 'die', strategy: 'never' });
    const r = await callTool(page, ASK, { q: 'anyone' });
    expect(r.ok).toBe(false);
    expect(r.ms).toBeLessThan(500);
    await expect
      .poll(() => logs.find((l) => l.includes('BusError')))
      .toMatch(/No isolate can answer webmcp\.ask\.v1/);
  });

  test('the returned function removes every tool', async ({ page }) => {
    await openPage(page);
    expect(await listTools(page)).toHaveLength(2);
    await page.evaluate(() => window.disconnectWebMCP?.());
    await expect.poll(async () => (await listTools(page)).length).toBe(0);
  });
});

test('without WebMCP, connectWebMCP does nothing', async ({ page }, info) => {
  test.skip(info.project.name === 'chromium-webmcp', 'this case needs WebMCP missing');
  await openPage(page);
  expect(await page.evaluate(() => 'modelContext' in document)).toBe(false);
  // The kernel still answers on its own.
  const reply = await page.evaluate(() =>
    window.kernel.request({ name: 'webmcp.ask.v1' }, { q: 'plain' }),
  );
  expect(reply).toMatchObject({ a: 'echo:plain' });
});
