import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, createServer, type Plugin, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isoloop } from './index';

// @isoloop/devtools in a Vite dev server: its default panel URL,
// `new URL('./panel.js', import.meta.url)`, has to reach the published
// panel.js. The app here installs a package laid out as the published one
// (dist/index.js and dist/panel.js) under node_modules, where Vite would
// pre-bundle it unless the plugin excludes it.

let root = '';
const servers: ViteDevServer[] = [];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'isoloop-vite-devtools-'));
  const pkg = join(root, 'node_modules', '@isoloop', 'devtools');
  mkdirSync(join(pkg, 'dist'), { recursive: true });
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({
      name: '@isoloop/devtools',
      version: '0.0.0',
      type: 'module',
      exports: { '.': { import: './dist/index.js' }, './panel': { import: './dist/panel.js' } },
    }),
  );
  writeFileSync(
    join(pkg, 'dist', 'index.js'),
    "export const panelUrl = () => new URL('./panel.js', import.meta.url).href;\n",
  );
  // Over Vite's 4 KB inline limit, as the real bundle (Preact included) is, so
  // a build emits it as a file rather than a data: URL.
  writeFileSync(
    join(pkg, 'dist', 'panel.js'),
    `export default { start() {} };\n/* ${'x'.repeat(5000)} */\n`,
  );
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><script type="module" src="/main.js"></script>\n',
  );
  writeFileSync(
    join(root, 'main.js'),
    "import { panelUrl } from '@isoloop/devtools';\nconsole.log(panelUrl());\n",
  );
});

afterAll(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  rmSync(root, { recursive: true, force: true });
});

async function serve(plugins: Plugin[], cacheDir: string): Promise<string> {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    cacheDir: join(root, cacheDir),
    plugins,
    server: { port: 0, host: '127.0.0.1' },
  });
  servers.push(server);
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('no server URL');
  return url;
}

/** Where main.js imports @isoloop/devtools from, and what the panel URL resolves to. */
async function panelFrom(base: string): Promise<{ module: string; panel: URL }> {
  const main = await (await fetch(new URL('main.js', base))).text();
  const module = /from\s+"([^"]*devtools[^"]*)"/.exec(main)?.[1] ?? '';
  return { module, panel: new URL('./panel.js', new URL(module, base)) };
}

describe('@isoloop/vite and @isoloop/devtools in dev', () => {
  it('serves the package unbundled, so its panel.js is next to its entry', async () => {
    const base = await serve(isoloop({ csp: false }), 'cache-with');
    const { module, panel } = await panelFrom(base);
    expect(module).toContain('/node_modules/@isoloop/devtools/dist/index.js');
    const res = await fetch(panel);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toContain('start()');
  });

  it('without the plugin, Vite pre-bundles it and the panel URL misses', async () => {
    const base = await serve([], 'cache-without');
    const { module, panel } = await panelFrom(base);
    const res = await fetch(panel);
    expect(res.headers.get('content-type') ?? '').not.toContain('javascript');
    // The pre-bundle lives in Vite's cache, where no panel.js sits beside it.
    expect(module).toContain('/cache-without/deps/');
  });

  it('in a build, emits the panel.js the default URL points to', async () => {
    const outDir = join(root, 'dist-build');
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: isoloop({ csp: false }),
      build: { outDir, emptyOutDir: true },
    });
    const assets = readdirSync(join(outDir, 'assets'));
    const panel = assets.find((f) => f.startsWith('panel') && f.endsWith('.js'));
    expect(panel).toBeDefined();
    expect(readFileSync(join(outDir, 'assets', panel ?? ''), 'utf8')).toContain('start()');
    const entry = assets.find((f) => f.startsWith('index') && f.endsWith('.js')) ?? '';
    expect(readFileSync(join(outDir, 'assets', entry), 'utf8')).toContain(panel);
  });
});
