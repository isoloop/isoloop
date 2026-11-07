import { fileURLToPath } from 'node:url';
import { createServer, defaultClientConditions, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { isoloop, type IsoloopOptions } from './index';

// M3a task 15: a Vite dev server with the plugin serves both worker bundles,
// exposes their URLs, and sends the hosting guide's headers.

const root = fileURLToPath(new URL('./__fixtures__/app', import.meta.url));
const servers: ViteDevServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function serve(o: IsoloopOptions = {}): Promise<string> {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: isoloop(o),
    resolve: { conditions: ['@isoloop/source', ...defaultClientConditions] },
    server: { port: 0, host: '127.0.0.1' },
  });
  servers.push(server);
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('no server URL');
  return url;
}

describe('@isoloop/vite in dev', () => {
  it('virtual:isoloop/workers gives both worker URLs, and the server serves them', async () => {
    const base = await serve();
    const mod = await (await fetch(new URL('@id/virtual:isoloop/workers', base))).text();
    const urls = [...mod.matchAll(/from "([^"]+)"/g)].map((m) => m[1] ?? '');
    expect(urls.some((u) => u.includes('bootstrap'))).toBe(true);
    expect(urls.some((u) => u.includes('worker'))).toBe(true);
    // The `?worker&url` modules export the worker's URL; that URL serves the worker.
    const served = await Promise.all(
      urls.map(async (u) => {
        const inner = await (await fetch(new URL(u, base))).text();
        const workerUrl = /export default "([^"]+)"/.exec(inner)?.[1] ?? '';
        const res = await fetch(new URL(workerUrl, base));
        return { workerUrl, status: res.status, type: res.headers.get('content-type') ?? '' };
      }),
    );
    for (const s of served) {
      expect(s.workerUrl).not.toBe('');
      expect(s.status).toBe(200);
      expect(s.type).toContain('javascript');
    }
  });

  it('bus: false leaves the bus worker out', async () => {
    const base = await serve({ bus: false });
    const mod = await (await fetch(new URL('@id/virtual:isoloop/workers', base))).text();
    expect(mod).toContain('bootstrap');
    expect(mod).not.toContain('bus/');
  });

  it('sends the CSP by default, with the isolate origins, and COOP/COEP when asked', async () => {
    const plain = await fetch(await serve({ isolateOrigins: ['https://cdn.example.com'] }));
    const csp = plain.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("script-src 'self' https://cdn.example.com");
    expect(plain.headers.get('cross-origin-opener-policy')).toBeNull();

    const isolated = await fetch(await serve({ csp: false, crossOriginIsolated: true }));
    expect(isolated.headers.get('content-security-policy')).toBeNull();
    expect(isolated.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(isolated.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
  });
});
