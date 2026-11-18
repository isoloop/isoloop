/// <reference lib="dom" />
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, test, type Page } from '@playwright/test';
import './harness-types';
import { HARNESS, ISOLATES_CORS } from './servers';

// The dev MCP end to end (M4a task 8): the official MCP SDK client ↔ the real
// `isoloop mcp` CLI ↔ a real page running `connectDevMCP`. Chromium only: the
// CLI and the page side are the same code in every engine, and the browser
// suites cover the page side's kernel calls.

const CONTRACTS = new URL('agents-contracts.js', ISOLATES_CORS).href;
const ANSWERER = new URL('answerer.js', ISOLATES_CORS).href;
const HEADLESS = new URL('headless.js', ISOLATES_CORS).href;
const TOKEN = 'e2e-dev-mcp-token-0123456789';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = fileURLToPath(new URL('../packages/cli/dist/cli.js', import.meta.url));

test.describe.configure({ mode: 'serial' });

test.beforeAll(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'the dev MCP suite runs in Chromium');
  // The e2e job doesn't build the packages; the CLI runs from its build.
  execFileSync('pnpm', ['--filter', 'isoloop...', 'build'], { cwd: ROOT, stdio: 'ignore' });
});

type Text = { type: string; text?: string };
type CallResult = { content: Text[]; structuredContent?: unknown; isError?: boolean };

/** Starts `isoloop mcp` on `port` with an SDK client on its stdio. */
async function startCli(port: number, allowWrite: boolean): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, 'mcp', '--port', String(port), ...(allowWrite ? ['--allow-write'] : [])],
    env: { ...process.env, ISOLOOP_MCP_TOKEN: TOKEN },
    stderr: 'ignore',
  });
  const client = new Client({ name: 'e2e', version: '0' });
  await client.connect(transport);
  return client;
}

/** The harness page with an answerer, a headless isolate, and connectDevMCP to `port`. */
async function openPage(page: Page, port: number): Promise<void> {
  await page.goto(HARNESS);
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await page.evaluate(
    async ({ contracts, answerer, headless, token, url }) => {
      const kernel = await window.harness.createBusKernel(contracts, {
        agents: { expose: ['answer.v1'] },
        heartbeat: { everyMs: 100, blockedAfterMs: 400, killAfterMs: 1_500 },
      });
      window.kernel = kernel;
      await new Promise<void>((resolve) => kernel.on('bus:ready', () => resolve()));
      const ready = (id: string) =>
        new Promise<void>((resolve) => {
          const off = kernel.on('isolate:ready', (e) => {
            if (e.id !== id) return;
            off();
            resolve();
          });
        });
      const a = ready('answerer');
      kernel.spawn({
        id: 'answerer',
        src: answerer,
        grants: { publish: [], subscribe: ['answer.v1'] },
      });
      const h = ready('victim');
      kernel.spawn({
        id: 'victim',
        src: headless,
        grants: { publish: ['headless.v1'], subscribe: [] },
      });
      await Promise.all([a, h]);
      await window.harness.connectDevMCP(kernel, { token, url });
    },
    {
      contracts: CONTRACTS,
      answerer: ANSWERER,
      headless: HEADLESS,
      token: TOKEN,
      url: `ws://127.0.0.1:${port}`,
    },
  );
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the SDK's result type for tools/call
  (await client.callTool({ name, arguments: args })) as CallResult;

/** A tool's JSON text, as the shape the test expects (the assertions check it). */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- names the shape at each call
const json = <T>(r: CallResult): T =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the expect calls check the shape
  JSON.parse(r.content[0]?.text ?? 'null') as T;

/** Waits until a page is connected to the CLI. */
async function connected(client: Client): Promise<void> {
  await expect
    .poll(async () => {
      const pages = json<{ pages: unknown[] }>(await call(client, 'isoloop_pages'));
      return pages.pages.length;
    })
    .toBe(1);
}

test('reads the page and calls its tools; writes need --allow-write', async ({ page }) => {
  const client = await startCli(4807, false);
  try {
    await openPage(page, 4807);
    await connected(client);

    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'isoloop_pages',
        'isoloop_isolates',
        'isoloop_topics',
        'isoloop_records',
        'isoloop_events',
        'answer.v1',
      ]),
    );
    for (const w of [
      'isoloop_restart',
      'isoloop_kill',
      'isoloop_block',
      'isoloop_publish',
      'isoloop_request',
    ])
      expect(names).not.toContain(w);

    // The app's tool, through kernel.request with via 'mcp'.
    const answered = await call(client, 'answer.v1', { q: 'hi' });
    expect(answered.isError).toBeFalsy();
    expect(answered.structuredContent).toEqual({ a: 'echo:hi', via: 'mcp' });

    const isolates = json<{
      isolates: { id: string; state: string }[];
    }>(await call(client, 'isoloop_isolates'));
    expect(isolates.isolates.map((i) => [i.id, i.state])).toEqual(
      expect.arrayContaining([
        ['answerer', 'running'],
        ['victim', 'running'],
      ]),
    );

    // The request record is in the topic's log, with its via.
    const records = json<{
      records: { preview: string; req?: { via?: string } }[];
    }>(await call(client, 'isoloop_records', { topic: 'answer.v1', last: 5 }));
    expect(records.records.at(-1)?.preview).toContain('hi');
    expect(records.records.at(-1)?.req?.via).toBe('mcp');

    const events = json<{ events: { event: string }[] }>(await call(client, 'isoloop_events'));
    expect(events.events.map((e) => e.event)).toContain('isolate:state');

    await expect
      .poll(async () => {
        const t = json<{ topics: { topic: string }[] }>(await call(client, 'isoloop_topics'));
        return t.topics.map((x) => x.topic);
      })
      .toContain('answer.v1');

    // A write without --allow-write is refused, not sent.
    const refused = await call(client, 'isoloop_kill', { id: 'victim' });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toContain('--allow-write');
  } finally {
    await client.close();
  }
});

test('with --allow-write: publish, request, and block shows blocked then a restart', async ({
  page,
}) => {
  const client = await startCli(4808, true);
  try {
    await openPage(page, 4808);
    await connected(client);

    const published = await call(client, 'isoloop_publish', { topic: 'log.v1', value: 'from mcp' });
    expect(published.isError).toBeFalsy();
    const records = json<{
      records: { preview: string }[];
    }>(await call(client, 'isoloop_records', { topic: 'log.v1' }));
    expect(records.records.map((r) => r.preview)).toContain('"from mcp"');

    const reply = json<{ reply: { a: string; via: string } }>(
      await call(client, 'isoloop_request', { topic: 'answer.v1', value: { q: 'raw' } }),
    );
    expect(reply.reply).toEqual({ a: 'echo:raw', via: 'mcp' });

    // A bad value is the bus's `invalid`, as a tool error.
    const bad = await call(client, 'isoloop_publish', { topic: 'log.v1', value: 42 });
    expect(bad.isError).toBe(true);
    expect(bad.content[0]?.text).toContain('invalid');

    const blocked = await call(client, 'isoloop_block', { id: 'victim', ms: 3_000 });
    expect(blocked.isError).toBeFalsy();
    const state = async (): Promise<{ state: string; restarts: number } | undefined> => {
      const r = json<{
        isolates: { id: string; state: string; restarts: number }[];
      }>(await call(client, 'isoloop_isolates'));
      return r.isolates.find((i) => i.id === 'victim');
    };
    await expect.poll(async () => (await state())?.state, { timeout: 5_000 }).toBe('blocked');
    await expect
      .poll(async () => (await state())?.restarts ?? 0, { timeout: 10_000 })
      .toBeGreaterThan(0);
    await expect.poll(async () => (await state())?.state, { timeout: 10_000 }).toBe('running');

    const events = json<{
      events: { event: string; data: { id?: string } }[];
    }>(await call(client, 'isoloop_events', { last: 200 }));
    expect(events.events.some((e) => e.event === 'isolate:crash' && e.data.id === 'victim')).toBe(
      true,
    );
  } finally {
    await client.close();
  }
});
