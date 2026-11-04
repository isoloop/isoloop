import { defaultClientConditions, defineConfig, type Plugin } from 'vite';

const QUERY = '?isolate';
const PREFIX = '\0isolate:';

/**
 * `import url from './x.ts?isolate'` gives the URL of an isolate module for
 * `kernel.spawn({ src })`. The bootstrap `import()`s that URL and calls the
 * module's default export, so the export has to survive the build: in dev the
 * URL is the source module's; in a build the module is emitted as its own
 * chunk with its signature kept. (`?worker&url` can't do this: Vite drops a
 * worker entry's exports.) The design's M3 Vite plugin grows from this.
 */
function isolateUrl(): Plugin {
  let root = '';
  let serve = false;
  return {
    name: 'isoloop:isolate-url',
    enforce: 'pre',
    configResolved(c) {
      root = c.root;
      serve = c.command === 'serve';
    },
    async resolveId(source, importer) {
      if (!source.endsWith(QUERY)) return null;
      const r = await this.resolve(source.slice(0, -QUERY.length), importer);
      return r ? PREFIX + r.id : null;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const file = id.slice(PREFIX.length);
      if (serve) {
        const url = file.startsWith(`${root}/`) ? file.slice(root.length) : `/@fs${file}`;
        return `export default ${JSON.stringify(url)};`;
      }
      const ref = this.emitFile({ type: 'chunk', id: file, preserveSignature: 'strict' });
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
  };
}

// Workspace packages resolve to their src (ADR 0009, rule 3), so the demo
// runs without building them first. The bootstrap is a plain worker entry,
// imported with `?worker&url`.
export default defineConfig({
  resolve: { conditions: ['@isoloop/source', ...defaultClientConditions] },
  worker: { format: 'es' },
  plugins: [isolateUrl()],
  base: './',
});
