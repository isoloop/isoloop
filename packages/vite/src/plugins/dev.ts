/*
 * The dev side of `@isoloop/vite` (M3a task 15): the worker URLs as a
 * virtual module, and the headers the hosting guide lists on every dev and
 * preview response.
 */
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

/** @internal */
export const WORKERS_ID = 'virtual:isoloop/workers';
const RESOLVED = `\0${WORKERS_ID}`;

/** The headers `isoloop()` sends on every dev and preview response. */
export type HeaderOptions = {
  /**
   * The Content-Security-Policy to send, or `false` for none. Default: the
   * hosting guide's policy, with `isolateOrigins` in `script-src` and
   * `connect-src`, plus what Vite's dev server needs (its HMR socket and
   * injected styles).
   */
  csp?: string | false;
  /** Origins that serve isolate modules or the contracts module, added to the default policy. Default: none. */
  isolateOrigins?: readonly string[];
  /**
   * Makes the page cross-origin isolated, for `SharedArrayBuffer`: COOP
   * `same-origin`, with COEP `require-corp` for `true`, or COEP
   * `credentialless` for `'credentialless'`. Under `require-corp`, every
   * cross-origin resource has to opt in with a CORP or CORS header. Under
   * `credentialless`, cross-origin `no-cors` requests go without cookies
   * instead, so third-party images and scripts without those headers still
   * load. Chromium 96 and Firefox 119 on desktop support `credentialless`.
   * Safari and Firefox for Android ignore it, so there the page isn't
   * cross-origin isolated. Default `false`. The `'credentialless'` value is
   * `@experimental`.
   */
  crossOriginIsolated?: boolean | 'credentialless';
};

/** What `virtual:isoloop/workers` holds. */
export type WorkersOptions = {
  /** Include the bus worker's URL. Default `true`; an app without `contracts` can drop it. */
  bus?: boolean;
};

/**
 * The Content-Security-Policy `isoloop()` sends by default: the hosting
 * guide's policy, plus what Vite's dev server needs: its HMR socket
 * (`ws:`, `wss:`), and `'unsafe-inline'` in `style-src`, because it injects
 * the CSS you import as `<style>` elements. Isoloop itself doesn't need
 * `'unsafe-inline'`: a production policy's `style-src` needs only `'self'`.
 *
 * @param origins Origins that serve isolate modules or the contracts module,
 *   added to `script-src` and `connect-src`. Default: none.
 * @returns The policy, as one header value.
 */
export function devCsp(origins: readonly string[] = []): string {
  const extra = origins.length > 0 ? ` ${origins.join(' ')}` : '';
  return [
    "default-src 'self'",
    "worker-src 'self'",
    `script-src 'self'${extra}`,
    `connect-src 'self' ws: wss:${extra}`,
    "style-src 'self' 'unsafe-inline'",
  ].join('; ');
}

/**
 * The headers `isoloop()` sends on dev and preview responses, for the same
 * options: the Content-Security-Policy (unless `csp` is `false`), and COOP and
 * COEP when `crossOriginIsolated` is set. Use it to send the same headers
 * from another server.
 *
 * @param o The header options, as passed to `isoloop()`.
 * @returns The headers by name.
 */
export function headersFor(o: HeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  const csp = o.csp ?? devCsp(o.isolateOrigins);
  if (csp !== false) headers['Content-Security-Policy'] = csp;
  if (o.crossOriginIsolated) {
    headers['Cross-Origin-Opener-Policy'] = 'same-origin';
    headers['Cross-Origin-Embedder-Policy'] =
      o.crossOriginIsolated === 'credentialless' ? 'credentialless' : 'require-corp';
  }
  return headers;
}

/**
 * `virtual:isoloop/workers` (the two worker entries go through Vite's own
 * `?worker&url`, so dev serves them and a build emits them), and the headers.
 */
export function devPlugin(o: HeaderOptions & WorkersOptions): Plugin {
  const headers = headersFor(o);
  const use = (server: ViteDevServer | PreviewServer): void => {
    server.middlewares.use((_req, res, next) => {
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      next();
    });
  };
  return {
    name: 'isoloop:dev',
    // `@isoloop/devtools` finds its panel isolate next to its own module
    // (`new URL('./panel.js', import.meta.url)`). Pre-bundled into
    // node_modules/.vite/deps, that URL points where no panel.js is, so the
    // dev server serves the package as it is published instead.
    config: () => ({ worker: { format: 'es' }, optimizeDeps: { exclude: ['@isoloop/devtools'] } }),
    resolveId: (id) => (id === WORKERS_ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      const bus = o.bus ?? true;
      return [
        "import worker from '@isoloop/runtime/worker?worker&url';",
        ...(bus ? ["import bus from '@isoloop/bus/worker?worker&url';"] : []),
        // The mark tells the kernel this is the tiny entry no chunk imports, so
        // each worker may start from it with a fragment of its own (memory per
        // isolate, ADR 0020, decision 4). Fragments aren't fetched.
        'const isolateBootstrap = `${worker}#isoloop-entry`;',
        `export default { isolateBootstrap${bus ? ', bus' : ''} };`,
      ].join('\n');
    },
    configureServer: use,
    configurePreviewServer: use,
  };
}
