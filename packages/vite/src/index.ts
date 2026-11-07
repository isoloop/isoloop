/*
 * `@isoloop/vite` (design §2, M3a tasks 15 and 16): `isoloop()` gives an app
 * the bootstrap and bus worker URLs as `virtual:isoloop/workers`, sends the
 * hosting guide's headers in dev and preview, and builds isolate modules.
 *
 * ```ts
 * import workers from 'virtual:isoloop/workers';
 * createKernel({ workers, contracts });
 * ```
 */
import type { Plugin } from 'vite';
import { buildPlugin, type BuildOptions } from './build';
import { devPlugin, type HeaderOptions, type WorkersOptions } from './dev';

export { devCsp, headersFor, WORKERS_ID, type HeaderOptions, type WorkersOptions } from './dev';

export { ISOLATES_ID, MANIFEST, type BuildOptions, type IsolateManifest } from './build';

export type IsoloopOptions = HeaderOptions & WorkersOptions & BuildOptions;

export function isoloop(o: IsoloopOptions = {}): Plugin[] {
  return [buildPlugin(o), ...(o.library ? [] : [devPlugin(o)])];
}
