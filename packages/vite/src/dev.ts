/*
 * The dev side of `@isoloop/vite` (M3a task 15): the worker URLs as a
 * virtual module, and the headers the hosting guide lists on every dev and
 * preview response.
 */
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

export const WORKERS_ID = 'virtual:isoloop/workers';
const RESOLVED = `\0${WORKERS_ID}`;

export type HeaderOptions = {
  /**
   * The Content-Security-Policy to send, or `false` for none. Default: the
   * hosting guide's policy, with `isolateOrigins` in `script-src` and
   * `connect-src`, plus what Vite's dev server needs (its HMR socket and
   * injected styles).
   */
  csp?: string | false;
  /** Origins that serve isolate modules or the contracts module. */
  isolateOrigins?: readonly string[];
  /** Sends COOP `same-origin` and COEP `require-corp`, for `SharedArrayBuffer`. Default false. */
  crossOriginIsolated?: boolean;
};

export type WorkersOptions = {
  /** Include the bus worker's URL. Default true; an app without `contracts` can drop it. */
  bus?: boolean;
};

/** The policy for the dev server: the hosting guide's, plus Vite's HMR socket and injected styles. */
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

export function headersFor(o: HeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  const csp = o.csp ?? devCsp(o.isolateOrigins);
  if (csp !== false) headers['Content-Security-Policy'] = csp;
  if (o.crossOriginIsolated) {
    headers['Cross-Origin-Opener-Policy'] = 'same-origin';
    headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
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
    config: () => ({ worker: { format: 'es' } }),
    resolveId: (id) => (id === WORKERS_ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      const bus = o.bus ?? true;
      return [
        "import isolateBootstrap from '@isoloop/runtime/worker?worker&url';",
        ...(bus ? ["import bus from '@isoloop/bus/worker?worker&url';"] : []),
        `export default { isolateBootstrap${bus ? ', bus' : ''} };`,
      ].join('\n');
    },
    configureServer: use,
    configurePreviewServer: use,
  };
}
