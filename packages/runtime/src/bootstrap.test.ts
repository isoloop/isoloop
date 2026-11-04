import type { HostToIsolate, IsolateToHost, LegacyIsolateToHost } from '@isoloop/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Msg = IsolateToHost | LegacyIsolateToHost;

const workers: Worker[] = [];
afterEach(() => {
  for (const w of workers.splice(0)) w.terminate();
});

const fixture = (name: string): string =>
  new URL(`./__fixtures__/${name}.ts`, import.meta.url).href;

function spawn(src: string, protocol = { min: 1, max: 1 }) {
  const worker = new Worker(new URL('./bootstrap.ts', import.meta.url), { type: 'module' });
  workers.push(worker);
  const got: Msg[] = [];
  const errors: string[] = [];
  const t0 = performance.now();
  const at = new Map<string, number>();
  worker.addEventListener('message', (e: MessageEvent<Msg>) => {
    got.push(e.data);
    if (!at.has(e.data.t)) at.set(e.data.t, performance.now() - t0);
  });
  worker.addEventListener('error', (e) => {
    e.preventDefault();
    errors.push(e.message);
  });
  const { port2 } = new MessageChannel();
  const init: HostToIsolate = {
    v: 1,
    t: 'init',
    p: {
      isolateId: 'T',
      protocol,
      renderFmt: 'legacy-vdom@1',
      config: null,
      grants: { publish: ['*'], subscribe: ['*'] },
      busPort: port2,
      heartbeatMs: 100,
      src,
    },
  };
  worker.postMessage(init, [port2]);
  const send = (msg: HostToIsolate | { v: 1; t: string; p: unknown }) => {
    worker.postMessage(msg);
  };
  const click = (target: string) => {
    send({
      v: 1,
      t: 'event',
      p: {
        type: 'click',
        target,
        currentTargets: [target],
        mods: { alt: false, ctrl: false, meta: false, shift: false },
      },
    });
  };
  return { got, errors, at, send, click };
}

const until = (ok: () => boolean, timeout = 2000): Promise<void> =>
  vi.waitFor(
    () => {
      if (!ok()) throw new Error('not yet');
    },
    { timeout, interval: 10 },
  );

const patches = (got: Msg[]) => got.flatMap((m) => (m.t === 'patch' ? [m.p.batch] : []));

describe('isolate bootstrap', () => {
  it('posts ready, then patch, then beat within 250 ms', async () => {
    const { got, at } = spawn(fixture('counter'));
    await until(() => at.has('ready') && at.has('patch') && at.has('beat'), 2000);
    const types = got.map((m) => m.t);
    expect(types.indexOf('ready')).toBeLessThan(types.indexOf('patch'));
    expect(at.get('beat')).toBeLessThan(250);
    expect(at.get('patch')).toBeLessThan(250);
    expect(got.find((m) => m.t === 'ready')).toEqual({
      v: 1,
      t: 'ready',
      p: { runtime: '@isoloop/runtime legacy', adapter: 'legacy', renderFmt: 'legacy-vdom@1' },
    });
    expect(patches(got)[0]).toEqual({ t: 'div', p: { class: 'n' }, c: ['0'] });
  });

  it('runs a handler on an event and posts the new tree', async () => {
    const { got, click } = spawn(fixture('counter'));
    await until(() => patches(got).length === 1);
    click('inc');
    click('inc');
    await until(() => patches(got).some((b) => JSON.stringify(b).includes('"2"')));
  });

  it('subscribes, publishes, and receives x-deliver', async () => {
    const { got, send, click } = spawn(fixture('counter'));
    await until(() => got.some((m) => m.t === 'x-sub'));
    expect(got.find((m) => m.t === 'x-sub')?.p).toEqual({ topic: 'note' });
    click('pub');
    await until(() => got.some((m) => m.t === 'x-pub'));
    expect(got.find((m) => m.t === 'x-pub')?.p).toEqual({ topic: 'count', value: 0 });
    send({ v: 1, t: 'x-deliver', p: { topic: 'note', value: 'hi', from: 'D' } });
    await until(() => patches(got).some((b) => JSON.stringify(b).includes('D: \\"hi\\"')));
  });

  it('surfaces a throwing handler as a worker error', async () => {
    const { errors, click, got } = spawn(fixture('counter'));
    await until(() => got.some((m) => m.t === 'ready'));
    click('crash');
    await until(() => errors.length > 0);
    expect(errors[0]).toContain('fixture crash');
  });

  it('posts a fatal protocol_mismatch for an unsupported range', async () => {
    const { got } = spawn(fixture('counter'), { min: 2, max: 3 });
    await until(() => got.length > 0);
    expect(got[0]).toMatchObject({ t: 'error', p: { fatal: true, code: 'protocol_mismatch' } });
    expect(got.some((m) => m.t === 'ready')).toBe(false);
  });

  it('posts a fatal error for a module without a default export', async () => {
    const { got } = spawn(fixture('no-default'));
    await until(() => got.some((m) => m.t === 'error'));
    expect(got.find((m) => m.t === 'error')).toMatchObject({ p: { fatal: true } });
    expect(got.some((m) => m.t === 'ready')).toBe(false);
  });
});
