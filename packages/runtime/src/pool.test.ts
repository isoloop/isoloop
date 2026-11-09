/*
 * The bootstrap as a pool (M2c task 1): every `init` naming a member in
 * `isolate` adds that member to the same worker; messages to and from members
 * name them; each member has its own context and bus port; the beat is the
 * worker's; the worker closes after its last member says `bye`.
 */
import type { HostToIsolate, IsolateToHost } from '@isoloop/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Msg = IsolateToHost & { isolate?: string };

const workers: Worker[] = [];
afterEach(() => {
  for (const w of workers.splice(0)) w.terminate();
});

const member = new URL('./__fixtures__/pool-member.ts', import.meta.url).href;

function pool() {
  const worker = new Worker(new URL('./bootstrap.ts', import.meta.url), { type: 'module' });
  workers.push(worker);
  const got: Msg[] = [];
  const errors: string[] = [];
  worker.addEventListener('message', (e: MessageEvent<Msg>) => {
    got.push(e.data);
  });
  worker.addEventListener('error', (e) => {
    e.preventDefault();
    errors.push(e.message);
  });
  /** What arrived on each member's bus port, by member. */
  const bus = new Map<string, unknown[]>();
  const add = (isolate: string | undefined, config: unknown = null): void => {
    const { port1, port2 } = new MessageChannel();
    const seen: unknown[] = [];
    bus.set(isolate ?? '(own)', seen);
    port1.addEventListener('message', (e: MessageEvent<unknown>) => {
      seen.push(e.data);
    });
    port1.start();
    const init: HostToIsolate = {
      v: 1,
      t: 'init',
      ...(isolate === undefined ? {} : { isolate }),
      p: {
        isolateId: isolate ?? 'own',
        protocol: { min: 1, max: 1 },
        renderFmt: 'none',
        config,
        grants: { publish: ['*'], subscribe: ['*'] },
        busPort: port2,
        heartbeatMs: 100,
        src: member,
      },
    };
    worker.postMessage(init, [port2]);
  };
  const send = (msg: HostToIsolate): void => {
    worker.postMessage(msg);
  };
  return { got, errors, bus, add, send };
}

const until = (ok: () => boolean, timeout = 3000): Promise<void> =>
  vi.waitFor(
    () => {
      if (!ok()) throw new Error('not yet');
    },
    { timeout, interval: 10 },
  );

const of = (got: Msg[], t: string, isolate?: string): Msg[] =>
  got.filter((m) => m.t === t && m.isolate === isolate);

const published = (seen: unknown[] | undefined): unknown[] => {
  const values: unknown[] = [];
  for (const m of seen ?? []) {
    if (typeof m !== 'object' || m === null || Reflect.get(m, 't') !== 'publish') continue;
    const p: unknown = Reflect.get(m, 'p');
    if (typeof p === 'object' && p !== null) values.push(Reflect.get(p, 'value'));
  }
  return values;
};

describe('bootstrap as a pool', () => {
  it('starts every member named in an init, each with its own context and bus port', async () => {
    const p = pool();
    p.add('a');
    p.add('b');
    p.add('c');
    await until(() => ['a', 'b', 'c'].every((id) => of(p.got, 'ready', id).length === 1));
    await until(() => ['a', 'b', 'c'].every((id) => published(p.bus.get(id)).length > 0));
    for (const id of ['a', 'b', 'c']) expect(published(p.bus.get(id))).toEqual([id]);
    expect(of(p.got, 'ready', 'a')[0]).toEqual({
      v: 1,
      t: 'ready',
      isolate: 'a',
      p: { runtime: '@isoloop/runtime', adapter: 'vanilla', renderFmt: 'none' },
    });
  });

  it('beats once per worker, without naming a member', async () => {
    const p = pool();
    p.add('a');
    p.add('b');
    p.add('c');
    await until(() => ['a', 'b', 'c'].every((id) => of(p.got, 'ready', id).length === 1));
    const before = p.got.filter((m) => m.t === 'beat').length;
    await new Promise((r) => setTimeout(r, 1000));
    const beats = p.got.filter((m) => m.t === 'beat');
    expect(beats.every((m) => m.isolate === undefined)).toBe(true);
    // Every 100 ms for the worker: about 10 in a second, not 30 for three members.
    expect(beats.length - before).toBeGreaterThanOrEqual(5);
    expect(beats.length - before).toBeLessThanOrEqual(14);
  });

  it('a member whose start() throws reports a fatal error under its own name; the others run', async () => {
    const p = pool();
    p.add('ok');
    p.add('bad', 'throw');
    await until(() => of(p.got, 'error', 'bad').length === 1);
    expect(of(p.got, 'error', 'bad')[0]).toMatchObject({
      p: { fatal: true, message: 'start() threw: start failed in bad' },
    });
    await until(() => published(p.bus.get('ok')).length > 0);
    expect(of(p.got, 'error', 'ok')).toEqual([]);
  });

  it('shuts down one member at a time and closes after the last', async () => {
    const p = pool();
    p.add('a');
    p.add('b');
    await until(() => of(p.got, 'ready', 'a').length === 1 && of(p.got, 'ready', 'b').length === 1);
    p.send({ v: 1, t: 'shutdown', isolate: 'a', p: { reason: 'stop', graceMs: 200 } });
    await until(() => of(p.got, 'bye', 'a').length === 1);
    expect(of(p.got, 'bye', 'b')).toEqual([]);
    // The worker still beats for b.
    const before = of(p.got, 'beat').length;
    await until(() => of(p.got, 'beat').length > before + 1);
    p.send({ v: 1, t: 'shutdown', isolate: 'b', p: { reason: 'stop', graceMs: 200 } });
    await until(() => of(p.got, 'bye', 'b').length === 1);
    // Closed: no more beats.
    const after = of(p.got, 'beat').length;
    await new Promise((r) => setTimeout(r, 400));
    expect(of(p.got, 'beat').length).toBe(after);
  });

  it('ignores an init without `isolate` once it is a pool, and one with `isolate` once it is an own worker', async () => {
    const p = pool();
    p.add('a');
    p.add(undefined);
    await until(() => of(p.got, 'ready', 'a').length === 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(of(p.got, 'ready', undefined)).toEqual([]);

    const q = pool();
    q.add(undefined);
    q.add('x');
    await until(() => of(q.got, 'ready', undefined).length === 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(of(q.got, 'ready', 'x')).toEqual([]);
  });

  it('freezes the built-ins in a pool: a member cannot patch them, but can still override on instances', async () => {
    const p = pool();
    p.add('a', 'patch');
    await until(() => published(p.bus.get('a')).length > 0);
    expect(published(p.bus.get('a'))).toEqual([
      { patched: false, override: 'MyError', frozen: true },
    ]);
  });

  it('leaves an own worker’s built-ins alone', async () => {
    const p = pool();
    p.add(undefined, 'patch');
    await until(() => published(p.bus.get('(own)')).length > 0);
    expect(published(p.bus.get('(own)'))).toEqual([
      { patched: true, override: 'MyError', frozen: false },
    ]);
  });
});
