import type { HostToIsolate, IsolateToHost, LegacyIsolateToHost } from '@isoloop/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Msg = IsolateToHost | LegacyIsolateToHost;

const workers: Worker[] = [];
afterEach(() => {
  for (const w of workers.splice(0)) w.terminate();
});

const fixture = (name: string): string =>
  new URL(`./__fixtures__/${name}.ts`, import.meta.url).href;

function spawn(src: string, protocol = { min: 1, max: 1 }, renderFmt = 'isoloop-dom@1') {
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
      renderFmt,
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

/** The node id of the first node the first patch inserts. */
const firstId = (got: Msg[]): string => {
  const batch = patches(got)[0];
  const insert: unknown = Array.isArray(batch) ? batch[0] : undefined;
  const node: unknown = Array.isArray(insert) ? insert[2] : undefined;
  return String(typeof node === 'object' && node !== null ? Reflect.get(node, 'id') : '');
};

describe('isolate bootstrap', () => {
  it('posts ready, then patch, then beat within 250 ms', async () => {
    const { got, at } = spawn(fixture('dom-hello'));
    await until(() => at.has('ready') && at.has('patch') && at.has('beat'), 2000);
    const types = got.map((m) => m.t);
    expect(types.indexOf('ready')).toBeLessThan(types.indexOf('patch'));
    expect(at.get('beat')).toBeLessThan(250);
    expect(at.get('patch')).toBeLessThan(250);
    expect(got.find((m) => m.t === 'ready')).toEqual({
      v: 1,
      t: 'ready',
      p: { runtime: '@isoloop/runtime', adapter: 'vanilla', renderFmt: 'isoloop-dom@1' },
    });
  });

  it('surfaces a throwing handler as a worker error', async () => {
    const { errors, click, got } = spawn(fixture('dom-crash'));
    await until(() => patches(got).length === 1);
    click(firstId(got));
    await until(() => errors.length > 0);
    expect(errors[0]).toContain('fixture crash');
  });

  it('posts a fatal protocol_mismatch for an unsupported range', async () => {
    const { got } = spawn(fixture('dom-hello'), { min: 2, max: 3 });
    await until(() => got.length > 0);
    expect(got[0]).toMatchObject({ t: 'error', p: { fatal: true, code: 'protocol_mismatch' } });
    expect(got.some((m) => m.t === 'ready')).toBe(false);
  });

  it('posts a fatal error for a default export that is a plain function', async () => {
    const { got } = spawn(fixture('fn-default'));
    await until(() => got.some((m) => m.t === 'error'));
    expect(got.find((m) => m.t === 'error')).toMatchObject({ p: { fatal: true } });
    expect(got.some((m) => m.t === 'ready')).toBe(false);
  });

  it('posts a fatal error for a module without a default export', async () => {
    const { got } = spawn(fixture('no-default'));
    await until(() => got.some((m) => m.t === 'error'));
    expect(got.find((m) => m.t === 'error')).toMatchObject({ p: { fatal: true } });
    expect(got.some((m) => m.t === 'ready')).toBe(false);
  });

  it('starts a { start(ctx) } module on isoloop-dom@1 and delivers events', async () => {
    const { got, click } = spawn(fixture('dom-hello'), undefined, 'isoloop-dom@1');
    await until(() => patches(got).length === 1);
    expect(got.find((m) => m.t === 'ready')).toMatchObject({
      p: { adapter: 'vanilla', renderFmt: 'isoloop-dom@1' },
    });
    const [batch] = patches(got);
    expect(batch).toMatchObject([
      [
        'insert',
        0,
        { k: 'el', tag: 'p', listen: ['click'], children: [{ data: 'hello T' }] },
        null,
      ],
    ]);
    const insert: unknown = Array.isArray(batch) ? batch[0] : undefined;
    const node: unknown = Array.isArray(insert) ? insert[2] : undefined;
    const id: unknown = typeof node === 'object' && node !== null ? Reflect.get(node, 'id') : 0;
    expect(id).toBeTypeOf('number');
    click(String(id));
    await until(() => patches(got).length === 2);
    // textContent replaces the children, as in the DOM: the old text node goes, a new one comes.
    expect(patches(got)[1]).toMatchObject([
      ['remove', expect.any(Number)],
      ['insert', id, { k: 'text', data: 'clicked' }, null],
    ]);
  });

  it('a headless { start(ctx) } module gets no root and no DOM', async () => {
    const { got } = spawn(fixture('dom-headless'), undefined, 'none');
    await until(() => got.some((m) => m.t === 'ready'));
    expect(got.find((m) => m.t === 'ready')).toMatchObject({ p: { renderFmt: 'none' } });
    await new Promise((r) => setTimeout(r, 100));
    expect(got.some((m) => m.t === 'error')).toBe(false);
  });

  it('runs onShutdown handlers before bye, and speaks the M1 bus', async () => {
    const { got, send } = spawn(fixture('dom-shutdown'), undefined, 'isoloop-dom@1');
    await until(() => got.some((m) => m.t === 'x-sub'));
    expect(got.find((m) => m.t === 'x-pub')).toMatchObject({ p: { topic: 'hello', value: 'T' } });
    send({ v: 1, t: 'x-deliver', p: { topic: 'note', value: 'hi', from: 'D' } });
    await until(() => JSON.stringify(patches(got)).includes('D: hi'));
    send({ v: 1, t: 'shutdown', p: { reason: 'stop', graceMs: 1000 } });
    await until(() => got.some((m) => m.t === 'bye'));
    const types = got.map((m) => m.t);
    expect(JSON.stringify(patches(got).at(-1))).toContain('bye: stop');
    expect(types.lastIndexOf('patch')).toBeLessThan(types.indexOf('bye'));
  });
});
