import type { CallResult, RouteValue } from '@isoloop/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import list from './__fixtures__/contracts';
import { createKernel, type Kernel } from './index';
import { createRouter, normaliseBase, pathWithin, type RouterOptions } from './router';

const start = location.href;
const routers: { destroy(): void }[] = [];
afterEach(() => {
  for (const r of routers.splice(0)) r.destroy();
  history.replaceState(null, '', start);
});

function router(extra: Partial<RouterOptions> = {}) {
  const published: RouteValue[] = [];
  const events: { dropped: number[]; errors: unknown[] } = { dropped: [], errors: [] };
  const r = createRouter({
    publish: (v) => {
      published.push(v);
      return Promise.resolve({ ok: true, value: { offset: published.length - 1 } });
    },
    busDown: () => false,
    stateDropped: (bytes) => events.dropped.push(bytes),
    navigateError: (e) => events.errors.push(e),
    ...extra,
  });
  routers.push(r);
  return { r, published, events };
}

describe('resolver (ADR 0002)', () => {
  const origin = location.origin;
  it.each([
    ['/x with basePath /app/', '/app/', '/x', `${origin}/app/x`],
    ['/ with basePath /app/', '/app/', '/', `${origin}/app/`],
    ['#x against the document URL', '/app/', '#x', `${location.href.split('#')[0]}#x`],
    [
      'a relative href against the document URL',
      '/',
      'other',
      new URL('other', location.href).href,
    ],
    ['a full same-origin URL escapes the base', '/app/', `${origin}/logout`, `${origin}/logout`],
  ])('%s', (_name, basePath, href, expected) => {
    expect(router({ basePath }).r.resolve(href)?.href).toBe(expected);
  });

  it('refuses another origin, and a protocol-relative href to one', () => {
    const { r } = router();
    expect(r.resolve('https://other.example/x')).toBeNull();
    expect(r.resolve('//other.example/x')).toBeNull();
    expect(r.rewrite('https://other.example/x')).toBe('https://other.example/x');
    expect(r.rewrite('/x')).toBe(`${location.origin}/x`);
  });

  it('normalises basePath and gives path relative to it, or null outside', () => {
    expect(normaliseBase('app')).toBe('/app/');
    expect(normaliseBase('/app')).toBe('/app/');
    expect(normaliseBase('')).toBe('/');
    expect(pathWithin('/app/orders/1', '/app/')).toBe('/orders/1');
    expect(pathWithin('/app', '/app/')).toBe('/');
    expect(pathWithin('/other', '/app/')).toBeNull();
    expect(pathWithin('/x', '/')).toBe('/x');
  });
});

describe('sync', () => {
  it('publishes the location, and skips it when href and state are unchanged', async () => {
    const { r, published } = router({ basePath: '/app/' });
    history.replaceState({ n: 1 }, '', '/app/orders?q=1#top');
    await r.sync();
    await r.sync();
    expect(published).toEqual([
      {
        href: `${location.origin}/app/orders?q=1#top`,
        pathname: '/app/orders',
        path: '/orders',
        search: '?q=1',
        hash: '#top',
        state: { n: 1 },
      },
    ]);
    history.replaceState({ n: 2 }, '', '/app/orders?q=1#top');
    await r.sync();
    history.replaceState({ n: 2 }, '', '/elsewhere');
    await r.sync();
    expect(published.map((p) => [p.path, p.state])).toEqual([
      ['/orders', { n: 1 }],
      ['/orders', { n: 2 }],
      [null, { n: 2 }],
    ]);
  });

  it('publishes state: null and emits route:state_dropped when the record is too large', async () => {
    const results: CallResult[] = [
      { ok: false, error: { code: 'too_large', message: 'big' } },
      { ok: true, value: null },
    ];
    const published: RouteValue[] = [];
    const { r, events } = router({
      publish: (v) => {
        published.push(v);
        return Promise.resolve(results.shift() ?? { ok: true, value: null });
      },
    });
    history.replaceState({ blob: 'x'.repeat(1000) }, '', '/big');
    await r.sync();
    expect(published.map((p) => p.state === null)).toEqual([false, true]);
    expect(events.dropped).toHaveLength(1);
    expect(events.dropped[0]).toBeGreaterThan(2000);
  });
});

describe('navigate', () => {
  it('goes through onNavigate, then syncs before resolving', async () => {
    const seen: unknown[] = [];
    const { r, published } = router({
      onNavigate: (req) => {
        seen.push(req);
        history.pushState(req.state ?? null, '', req.href);
        return true;
      },
    });
    expect(await r.navigate('/x', { from: 'A', state: { s: 1 } })).toEqual({
      ok: true,
      value: true,
    });
    expect(seen).toEqual([
      { href: `${location.origin}/x`, replace: false, state: { s: 1 }, from: 'A' },
    ]);
    expect(published.at(-1)?.pathname).toBe('/x');
  });

  it('a refusal is false, a throw is navigate_failed with route:navigate_error, another origin is cross_origin', async () => {
    const refuse = router({ onNavigate: () => false });
    expect(await refuse.r.navigate('/x', { from: 'A' })).toEqual({ ok: true, value: false });
    expect(refuse.published).toEqual([]);

    const throws = router({
      onNavigate: () => {
        throw new Error('router broke');
      },
    });
    expect(await throws.r.navigate('/x', { from: 'A' })).toMatchObject({
      ok: false,
      code: 'navigate_failed',
    });
    expect(throws.events.errors).toEqual([
      { from: 'A', href: `${location.origin}/x`, error: 'router broke' },
    ]);

    const onNavigate = vi.fn(() => true);
    expect(
      await router({ onNavigate }).r.navigate('https://other.example', { from: 'A' }),
    ).toMatchObject({
      ok: false,
      code: 'cross_origin',
    });
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe('routing: false', () => {
  const kernels: Kernel[] = [];
  afterEach(async () => {
    await Promise.all(kernels.splice(0).map((k) => k.destroy()));
  });

  it('adds no listeners and publishes nothing', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const kernel = createKernel({
      routing: false,
      contracts: { url: new URL('./__fixtures__/contracts.ts', import.meta.url).href, list },
      workers: {
        isolateBootstrap: 'unused.js',
        bus: `${new URL('../../bus/src/worker.ts', import.meta.url).href}?worker_file&type=module`,
      },
    });
    kernels.push(kernel);
    kernel.syncRoute();
    const types = add.mock.calls.map(([t]) => t);
    expect(types).not.toContain('popstate');
    expect(types).not.toContain('hashchange');
    add.mockRestore();
  });
});
