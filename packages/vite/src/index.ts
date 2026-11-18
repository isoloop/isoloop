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

export { ISOLATES_ID, MANIFEST, type BuildOptions, type IsolateManifest } from './build';

export type { DevMcpGuardOptions } from './guard';

export type IsoloopOptions = HeaderOptions & WorkersOptions & BuildOptions & DevMcpGuardOptions;

export function isoloop(o: IsoloopOptions = {}): Plugin[] {
  return [buildPlugin(o), devMcpGuard(o), ...(o.library ? [] : [devPlugin(o)])];
}
