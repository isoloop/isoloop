import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, defaultClientConditions } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { isoloop, MANIFEST, type IsoloopOptions, type BuildManifest } from '../index';

// M3a task 16: builds emit one ES module per isolate, exports kept, and a
// manifest of their files, in an app and in library mode.

const root = fileURLToPath(new URL('../__fixtures__/app', import.meta.url));
const isolates = { counter: 'iso/counter.ts', clock: 'iso/clock.ts' };
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function run(o: IsoloopOptions): Promise<{ out: string; manifest: BuildManifest }> {
  const out = await mkdtemp(join(tmpdir(), 'isoloop-vite-'));
  dirs.push(out);
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: isoloop(o),
    resolve: { conditions: ['@isoloop/source', ...defaultClientConditions] },
    build: { outDir: out, emptyOutDir: true, minify: false },
  });
  const parsed: unknown = JSON.parse(await readFile(join(out, MANIFEST), 'utf8'));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the plugin wrote it
  return { out, manifest: parsed as BuildManifest };
}

async function startOf(file: string): Promise<unknown> {
  const mod: unknown = await import(pathToFileURL(file).href);
  const main: unknown =
    typeof mod === 'object' && mod !== null ? Reflect.get(mod, 'default') : undefined;
  return typeof main === 'object' && main !== null ? Reflect.get(main, 'start') : undefined;
}

describe('@isoloop/vite builds', () => {
  it('an app build emits one module per isolate, default export kept, and the manifest', async () => {
    const { out, manifest } = await run({ isolates });
    expect(Object.keys(manifest.isolates)).toEqual(expect.arrayContaining(['clock', 'counter']));
    expect(Object.keys(manifest.isolates)).toHaveLength(2);
    for (const file of Object.values(manifest.isolates)) {
      // oxlint-disable-next-line no-await-in-loop -- two files
      expect(typeof (await startOf(join(out, file)))).toBe('function');
    }
    const html = await readFile(join(out, 'index.html'), 'utf8');
    expect(html).toContain('<script');
  });

  it('library mode builds only the isolates, with the same manifest', async () => {
    const { out, manifest } = await run({ isolates, library: true });
    expect(manifest.isolates).toEqual({ counter: 'counter.js', clock: 'clock.js' });
    expect(typeof (await startOf(join(out, 'clock.js')))).toBe('function');
    await expect(readFile(join(out, 'index.html'), 'utf8')).rejects.toThrow();
  });

  it('no chunk imports the isolate worker entry, so it is evaluated once (WebKit re-evaluates an entry imported by URL)', async () => {
    const { out } = await run({ isolates });
    const assets = join(out, 'assets');
    const files = (await readdir(assets)).filter((f) => f.endsWith('.js'));
    const code = new Map(
      await Promise.all(
        files.map(async (f) => [f, await readFile(join(assets, f), 'utf8')] as const),
      ),
    );
    // The app's entry names the isolate worker's URL; find the file it points at.
    const html = await readFile(join(out, 'index.html'), 'utf8');
    const appEntry = /src="\.\/assets\/([^"]+\.js)"|src="\/assets\/([^"]+\.js)"/.exec(html);
    const app = code.get(appEntry?.[1] ?? appEntry?.[2] ?? '') ?? '';
    const entries = files.filter((f) => /^(worker|bootstrap)-/.test(f) && app.includes(f));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries)
      for (const [f, src] of code)
        if (f !== entry) expect(src.includes(`./${entry}`), `${f} imports ${entry}`).toBe(false);
  });

  it('isolate workers start from the tiny entry chunk, marked for memory per isolate (ADR 0020)', async () => {
    const { out } = await run({ isolates });
    const assets = join(out, 'assets');
    const files = (await readdir(assets)).filter((f) => f.endsWith('.js'));
    const code = new Map(
      await Promise.all(
        files.map(async (f) => [f, await readFile(join(assets, f), 'utf8')] as const),
      ),
    );
    const html = await readFile(join(out, 'index.html'), 'utf8');
    const appEntry = /src="\.\/assets\/([^"]+\.js)"|src="\/assets\/([^"]+\.js)"/.exec(html);
    const app = code.get(appEntry?.[1] ?? appEntry?.[2] ?? '') ?? '';
    // The app marks the isolate worker's URL as the tiny entry.
    expect(app).toContain('#isoloop-entry');
    // That URL is the tiny entry's own chunk: it marks the worker, then imports the bootstrap.
    const workerChunks = files.filter((f) => f.startsWith('worker-') && app.includes(f));
    const tiny = workerChunks.filter((f) => code.get(f)?.includes('isoloop.worker-entry'));
    expect(tiny).toHaveLength(1);
    const src = code.get(tiny[0] ?? '') ?? '';
    expect(src).toMatch(/import\(\s*[`'"]\.\/bootstrap-[^`'"]+\.js[`'"]\s*\)/);
    expect(src.length).toBeLessThan(2_000);
  });
});
