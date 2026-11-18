/// <reference lib="dom" />
import { createReadStream, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import './harness-types';

/*
 * Memory per isolate (ADR 0020, decision 4, M4b task 5b): on a cross-origin
 * isolated page in Chromium, the host measures each worker with
 * `performance.measureUserAgentSpecificMemory()` and gives the figure to its
 * isolate, a pool's to every member as shared. The page is the E2E harness's
 * build, served here twice, with and without COOP and COEP, the isolate from
 * the same origin. Full Chromium (the headless shell lacks the API), asked to
 * measure at once instead of at its next garbage collection, so the test
 * doesn't wait.
 */

const ROOT = join(import.meta.dirname, '..');
const FILES: Record<string, string> = {
  '/isolates/': join(ROOT, 'e2e/isolates'),
  '/': join(ROOT, 'e2e/harness/dist'),
};
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

const servers: Server[] = [];

/** Serves the harness and the isolates; `isolated` adds COOP and COEP. */
async function serve(isolated: boolean): Promise<string> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const [prefix, dir] = Object.entries(FILES).find(([p]) => path.startsWith(p)) ?? ['', ''];
    const rel = path.slice(prefix.length) || 'index.html';
    const file = normalize(join(dir, rel));
    if (isolated) {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    }
    if (!file.startsWith(dir) || !existsSync(file)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
    createReadStream(file).pipe(res);
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  return `http://localhost:${typeof address === 'object' && address ? address.port : 0}`;
}

test.afterAll(() => {
  for (const s of servers.splice(0)) s.close();
});

type Seen = { id: string; state: string; bytes?: number; shared?: boolean }[];

/** Runs in the page: two own isolates and a pool of two, then one measurement. */
const spawnAndMeasure = async ({
  src,
}: {
  src: string;
}): Promise<{ isolated: boolean; seen: Seen }> => {
  const kernel = window.harness.createKernel();
  const spawns: [string, number, string | undefined][] = [
    ['big', 24, undefined],
    ['small', 1, undefined],
    ['p1', 4, 'p'],
    ['p2', 4, 'p'],
  ];
  for (const [id, mb, pool] of spawns)
    kernel.spawn({ id, src, config: { mb }, ...(pool === undefined ? {} : { pool }) });
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page, must be self-contained
  const until = async (ok: () => boolean, ms: number): Promise<void> => {
    const end = performance.now() + ms;
    // oxlint-disable-next-line no-await-in-loop -- polling, one wait at a time
    while (!ok() && performance.now() < end) await new Promise((r) => setTimeout(r, 50));
  };
  await until(() => kernel.isolates().every((i) => i.state === 'running'), 10_000);
  const inspector = kernel.inspect();
  let got = false;
  inspector.on((m) => {
    if (m.t === 'memory') got = true;
  });
  await until(() => got, crossOriginIsolated ? 20_000 : 2_000);
  const seen: Seen = [];
  for (const i of inspector.snapshot().isolates) {
    const s: Seen[number] = { id: i.id, state: i.state };
    if (i.memory) s.bytes = i.memory.bytes;
    if (i.memory?.shared) s.shared = true;
    seen.push(s);
  }
  inspector.close();
  await kernel.destroy();
  return { isolated: crossOriginIsolated, seen };
};

test('gives each worker its own figure, and a pool’s to every member', async ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'measureUserAgentSpecificMemory is Chromium only');
  test.setTimeout(60_000);
  const browser = await chromium.launch({
    channel: 'chromium',
    args: ['--enable-blink-features=ForceEagerMeasureMemory'],
  });
  try {
    const origin = await serve(true);
    const page = await browser.newPage();
    await page.goto(`${origin}/`);
    await expect(page.locator('body[data-ready]')).toBeAttached();
    const src = `${origin}/isolates/memory.js`;
    const { isolated, seen } = await page.evaluate(spawnAndMeasure, { src });
    expect(isolated).toBe(true);
    expect(seen.map((x) => x.state)).toEqual(['running', 'running', 'running', 'running']);
    const by = Object.fromEntries(seen.map((s) => [s.id, s]));
    const MB = 2 ** 20;
    expect(by['big']?.bytes).toBeGreaterThan(by['small']?.bytes ?? Infinity);
    expect((by['big']?.bytes ?? 0) - (by['small']?.bytes ?? 0)).toBeGreaterThan(10 * MB);
    expect(by['big']?.shared).toBeUndefined();
    expect(by['p1']?.bytes).toBeGreaterThan(0);
    expect(by['p1']?.bytes).toBe(by['p2']?.bytes);
    expect(by['p1']?.shared).toBe(true);
  } finally {
    await browser.close();
  }
});

test('shows no memory where the page isn’t cross-origin isolated', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Chromium is where it could be measured at all');
  const origin = await serve(false);
  await page.goto(`${origin}/`);
  await expect(page.locator('body[data-ready]')).toBeAttached();
  const { isolated, seen } = await page.evaluate(spawnAndMeasure, {
    src: `${origin}/isolates/memory.js`,
  });
  expect(isolated).toBe(false);
  expect(seen.map((x) => x.state)).toEqual(['running', 'running', 'running', 'running']);
  expect(seen.every((x) => x.bytes === undefined)).toBe(true);
});
