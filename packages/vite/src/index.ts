/*
 * `@isoloop/vite` (design §2, M3a tasks 15 and 16): `isoloop()` gives an app
 * the bootstrap and bus worker URLs as `virtual:isoloop/workers`, sends the
 * hosting guide's headers in dev and preview, builds isolate modules, and fails
 * a production build that contains the dev MCP (`allowDevMcp` to allow it).
 *
 * ```ts
 * import workers from 'virtual:isoloop/workers';
 * createKernel({ workers, contracts });
 * ```
 */
import type { Plugin } from 'vite';
import { buildPlugin, type BuildOptions } from './build';
import { devPlugin, type HeaderOptions, type WorkersOptions } from './dev';
import { devMcpGuard, type DevMcpGuardOptions } from './guard';

export { devCsp, headersFor, WORKERS_ID, type HeaderOptions, type WorkersOptions } from './dev';

export { ISOLATES_ID, MANIFEST, type BuildOptions, type BuildManifest } from './build';

export type { DevMcpGuardOptions } from './guard';

/** The options of `isoloop()`: headers, worker URLs, the isolate build and the dev MCP check. */
export type IsoloopOptions = HeaderOptions & WorkersOptions & BuildOptions & DevMcpGuardOptions;

/**
 * The Vite plugins for an Isoloop app:
 * - `virtual:isoloop/workers` gives the isolate bootstrap's and the bus
 *   worker's URLs, for `createKernel({ workers })`;
 * - `import url from './x.ts?isolate'` gives an isolate module's URL, for
 *   `spawn({ src })`, and a build emits each as its own module with its
 *   exports kept;
 * - dev and preview responses carry the hosting guide's headers;
 * - a production build that contains the dev MCP fails, unless
 *   `allowDevMcp` is set.
 *
 * @param o The options. Default: none of them set.
 * @returns The plugins, for `plugins` in the Vite config.
 * @throws {Error} When `library` is set without any `isolates`. A production
 *   build fails while its output still uses `connectDevMCP`.
 * @example
 * ```ts
 * import { defineConfig } from 'vite';
 * import { isoloop } from '@isoloop/vite';
 *
 * export default defineConfig({ plugins: [isoloop()] });
 * ```
 */
export function isoloop(o: IsoloopOptions = {}): Plugin[] {
  return [buildPlugin(o), devMcpGuard(o), ...(o.library ? [] : [devPlugin(o)])];
}
