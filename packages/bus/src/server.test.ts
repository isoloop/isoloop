import type { BusToHost, BusToIsolate, CallResult, HostToBus } from '@isoloop/protocol';
import { describe, expect, it, vi } from 'vitest';
import list, { counts, notes } from './__fixtures__/contracts';
import { loadContracts, mismatchedTopics, serve } from './server';
import { contracts, topicConfig } from './topic';

const TOPICS = list.topics.map(topicConfig);
const noop = (): void => {};

const load = (mod: unknown, topics = TOPICS) =>
  loadContracts('mod.js', topics, () => Promise.resolve(mod));

/** The bus shell over a fake scope, with contracts that load when `release()` is called. */
function shell(inboxLimit = 2) {
  let release: () => void = noop;
  const loaded = new Promise<void>((r) => (release = r));
  const got: BusToHost[] = [];
  let onMessage: (e: MessageEvent<unknown>) => void = noop;
  serve(
    {
      postMessage: (m) => got.push(m),
      addEventListener: (_t, fn) => (onMessage = fn),
    },
    { inboxLimit, importModule: () => loaded.then(() => ({ default: list })) },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the shell only reads `data`
  const send = (msg: HostToBus): void => onMessage({ data: msg } as MessageEvent<unknown>);
  send({ v: 1, t: 'boot', p: { contractsUrl: 'x', topics: TOPICS, heartbeatMs: 1e6 } });
  return { got, send, release };
}

function isolate() {
  const { port1, port2 } = new MessageChannel();
  const inbox: BusToIsolate[] = [];
  port1.addEventListener('message', (e: MessageEvent<BusToIsolate>) => inbox.push(e.data));
  port1.start();
  const result = (id: string): CallResult | undefined =>
    inbox.find((m): m is Extract<BusToIsolate, { t: 'result' }> => m.t === 'result' && m.re === id)
      ?.p;
  return { port1, port2, inbox, result };
}

describe('bus shell', () => {
  it('rejects publishes past the inbox limit while contracts load, and runs the rest after', async () => {
    const bus = shell(2);
    const a = isolate();
    bus.send({
      v: 1,
      t: 'attach',
      p: { isolateId: 'A', grants: { publish: ['*'], subscribe: [] }, port: a.port2 },
    });
    for (const id of ['p1', 'p2', 'p3'])
      a.port1.postMessage({ v: 1, t: 'publish', id, p: { topic: 'counts.v1', value: 1 } });
    await vi.waitUntil(() => a.result('p3'));
    expect(a.result('p3')).toMatchObject({ ok: false, error: { code: 'bus_unavailable' } });
    expect(a.result('p1')).toBeUndefined();
    bus.release();
    await vi.waitUntil(() => a.result('p2'));
    expect(a.result('p1')).toEqual({ ok: true, value: { offset: 0 } });
    expect(a.result('p2')).toEqual({ ok: true, value: { offset: 1 } });
    a.port1.close();
  });

  it('drops a port detached before contracts load', async () => {
    const bus = shell();
    const a = isolate();
    bus.send({
      v: 1,
      t: 'attach',
      p: { isolateId: 'A', grants: { publish: ['*'], subscribe: [] }, port: a.port2 },
    });
    a.port1.postMessage({ v: 1, t: 'publish', id: 'p1', p: { topic: 'counts.v1', value: 1 } });
    await new Promise((r) => setTimeout(r, 10));
    bus.send({ v: 1, t: 'detach', p: { isolateId: 'A', keepOffsets: true } });
    bus.release();
    await vi.waitUntil(() => bus.got.some((m) => m.t === 'ready'));
    await new Promise((r) => setTimeout(r, 10));
    expect(a.result('p1')).toBeUndefined();
    a.port1.close();
  });
});

describe('loadContracts', () => {
  it('returns the module default export when it matches', async () => {
    await expect(load({ default: list })).resolves.toBe(list);
  });

  it('rejects a hand-built list with an isoloop.* topic: reserved_topic', async () => {
    const forged = {
      '~isoloop': 'contracts',
      topics: [{ ...notes, name: 'isoloop.route.v1' }],
      get: () => undefined,
    };
    await expect(load({ default: forged })).rejects.toMatchObject({ code: 'reserved_topic' });
  });

  it('a topic only one side lists is a mismatch', async () => {
    const loading = load({ default: contracts(notes) });
    await expect(loading).rejects.toMatchObject({ code: 'contracts_mismatch' });
    await expect(loading).rejects.toThrow('counts.v1');
    expect(mismatchedTopics(contracts(notes, counts), TOPICS)).toEqual([]);
  });

  it('a throw while importing: contracts_failed, with the reason', async () => {
    const loading = loadContracts('mod.js', TOPICS, () =>
      Promise.reject(new Error('net::ERR_FAILED')),
    );
    await expect(loading).rejects.toMatchObject({ code: 'contracts_failed' });
    await expect(loading).rejects.toThrow('ERR_FAILED');
  });
});
