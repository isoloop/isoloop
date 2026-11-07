import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, defaultClientConditions } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { isoloop, MANIFEST, type IsoloopOptions, type IsolateManifest } from './index';

// M3a task 16: builds emit one ES module per isolate, exports kept, and a
// manifest of their files, in an app and in library mode.

const root = fileURLToPath(new URL('./__fixtures__/app', import.meta.url));
const isolates = { counter: 'iso/counter.ts', clock: 'iso/clock.ts' };
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function run(o: IsoloopOptions): Promise<{ out: string; manifest: IsolateManifest }> {
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
  return { out, manifest: parsed as IsolateManifest };
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
});
