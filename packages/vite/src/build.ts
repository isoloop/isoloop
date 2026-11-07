/*
 * The build side of `@isoloop/vite` (M3a task 16): isolate modules as their
 * own ES modules, with their exports kept, and a manifest of their URLs.
 *
 * - `import url from './x.ts?isolate'`: the URL of an isolate module (or the
 *   contracts module) for `spawn({ src })`. In dev it's the source module's
 *   URL; in a build the module is emitted as its own chunk with its
 *   signature kept. (`?worker&url` can't do this: Vite drops a worker entry's
 *   exports, and the bootstrap needs the default export.)
 * - `isolates: { name: entry }`: each is built that way even if nothing
 *   imports it, `virtual:isoloop/isolates` maps names to URLs, and the build
 *   writes `isoloop-manifest.json` (`{ isolates: { name: file } }`).
 * - `library: true`: the build is only those isolates, for a repository
 *   that ships isolates to someone else's host. Same modules, same manifest.
 */
import { relative, resolve } from 'node:path';
import type { Plugin, UserConfig } from 'vite';

const QUERY = '?isolate';
const PREFIX = '\0isolate:';
export const ISOLATES_ID = 'virtual:isoloop/isolates';
const RESOLVED = `\0${ISOLATES_ID}`;
export const MANIFEST = 'isoloop-manifest.json';

export type BuildOptions = {
  /** Isolate entries by name, relative to the Vite root. */
  isolates?: Readonly<Record<string, string>>;
  /** Build only the isolates (library mode), not an app. Needs `isolates`. */
  library?: boolean;
};

/** What `isoloop-manifest.json` holds: each isolate's file, relative to the output directory. */
export type IsolateManifest = { isolates: Record<string, string> };

export function buildPlugin(o: BuildOptions): Plugin {
  const isolates = o.isolates ?? {};
  let root = process.cwd();
  let serve = false;
  /** Emitted chunk refs by isolate name (app builds). */
  const refs = new Map<string, string>();

  return {
    name: 'isoloop:build',
    enforce: 'pre',
    config(): UserConfig | undefined {
      if (!o.library) return undefined;
      if (Object.keys(isolates).length === 0) {
        throw new Error('@isoloop/vite: library mode needs `isolates`');
      }
      return {
        build: {
          lib: {
            entry: { ...isolates },
            formats: ['es'],
            fileName: (_format, name) => `${name}.js`,
          },
        },
      };
    },
    configResolved(c) {
      root = c.root;
      serve = c.command === 'serve';
    },
    buildStart() {
      if (serve || o.library) return;
      for (const [name, entry] of Object.entries(isolates)) {
        refs.set(
          name,
          this.emitFile({
            type: 'chunk',
            id: resolve(root, entry),
            name,
            preserveSignature: 'strict',
          }),
        );
      }
    },
    async resolveId(source, importer) {
      if (source === ISOLATES_ID) return RESOLVED;
      if (!source.endsWith(QUERY)) return null;
      const r = await this.resolve(source.slice(0, -QUERY.length), importer);
      return r ? PREFIX + r.id : null;
    },
    load(id) {
      if (id === RESOLVED) {
        const names = Object.keys(isolates);
        return [
          ...names.map(
            (n, i) =>
              `import u${i} from ${JSON.stringify(`${resolve(root, isolates[n] ?? '')}${QUERY}`)};`,
          ),
          `export default { ${names.map((n, i) => `${JSON.stringify(n)}: u${i}`).join(', ')} };`,
        ].join('\n');
      }
      if (!id.startsWith(PREFIX)) return null;
      const file = id.slice(PREFIX.length);
      if (serve) {
        const rel = relative(root, file);
        const url = rel.startsWith('..') ? `/@fs${file}` : `/${rel.split('\\').join('/')}`;
        return `export default ${JSON.stringify(url)};`;
      }
      const ref = this.emitFile({ type: 'chunk', id: file, preserveSignature: 'strict' });
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
    generateBundle(_opts, bundle) {
      if (Object.keys(isolates).length === 0) return;
      const manifest: IsolateManifest = { isolates: {} };
      if (o.library) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type === 'chunk' && chunk.isEntry && chunk.name in isolates) {
            manifest.isolates[chunk.name] = chunk.fileName;
          }
        }
      } else {
        for (const [name, ref] of refs) manifest.isolates[name] = this.getFileName(ref);
      }
      this.emitFile({
        type: 'asset',
        fileName: MANIFEST,
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}
