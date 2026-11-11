import {
  isBatch,
  unbatch,
  type BusToHost,
  type BusToIsolate,
  type CallResult,
  type HostToBus,
} from '@isoloop/protocol';
import { describe, expect, it, vi } from 'vitest';
import list, { counts, notes } from './__fixtures__/contracts';
import { loadContracts, mismatchedTopics, serve } from './server';
import { contracts, topicConfig } from './topic';

const TOPICS = list.topics.map(topicConfig);
const noop = (): void => {};

const load = (mod: unknown, topics = TOPICS) =>
  loadContracts('mod.js', topics, () => Promise.resolve(mod));

/** The bus shell over a fake scope, with contracts that load when `release()` is called. */
function shell(inboxLimit = 2, batch = false) {
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
  send({
    v: 1,
    t: 'boot',
    p: { contractsUrl: 'x', topics: TOPICS, heartbeatMs: 1e6, ...(batch ? { batch: true } : {}) },
  });
  return { got, send, release };
}

function isolate() {
  const { port1, port2 } = new MessageChannel();
  const inbox: BusToIsolate[] = [];
  /** How many port messages arrived, batches counting once. */
  const messages = { n: 0, batches: 0 };
  port1.addEventListener('message', (e: MessageEvent<unknown>) => {
    messages.n++;
    if (isBatch(e.data)) messages.batches++;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the broker posts BusToIsolate
    unbatch(e.data, (m) => inbox.push(m as BusToIsolate));
  });
  port1.start();
  const result = (id: string): CallResult | undefined =>
    inbox.find((m): m is Extract<BusToIsolate, { t: 'result' }> => m.t === 'result' && m.re === id)
      ?.p;
  return { port1, port2, inbox, result, messages };
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

  describe('with bus.batch on (ADR 0016, decision 3)', () => {
    it('counts each publish in a batch towards the inbox limit while contracts load', async () => {
      const bus = shell(2, true);
      const a = isolate();
      bus.send({
        v: 1,
        t: 'attach',
        p: { isolateId: 'A', grants: { publish: ['*'], subscribe: [] }, port: a.port2 },
      });
      a.port1.postMessage({
        v: 1,
        t: 'batch',
        p: {
          msgs: ['p1', 'p2', 'p3'].map((id) => ({
            v: 1,
            t: 'publish',
            id,
            p: { topic: 'counts.v1', value: 1 },
          })),
        },
      });
      await vi.waitUntil(() => a.result('p3'));
      expect(a.result('p3')).toMatchObject({ ok: false, error: { code: 'bus_unavailable' } });
      bus.release();
      await vi.waitUntil(() => a.result('p2'));
      expect(a.result('p1')).toEqual({ ok: true, value: { offset: 0 } });
      expect(a.result('p2')).toEqual({ ok: true, value: { offset: 1 } });
      a.port1.close();
    });

    it('checks each envelope of a batch on its own: one bad publish leaves the others, across topics', async () => {
      const bus = shell(10, true);
      bus.release();
      await vi.waitUntil(() => bus.got.some((m) => m.t === 'ready'));
      const a = isolate();
      bus.send({
        v: 1,
        t: 'attach',
        p: { isolateId: 'A', grants: { publish: ['*'], subscribe: ['*'] }, port: a.port2 },
      });
      a.port1.postMessage({
        v: 1,
        t: 'batch',
        p: {
          msgs: [
            { v: 1, t: 'subscribe', id: 's1', p: { topic: 'notes.v1', from: 'earliest' } },
            { v: 1, t: 'publish', id: 'p1', p: { topic: 'counts.v1', value: 1 } },
            { v: 1, t: 'publish', id: 'p2', p: { topic: 'notes.v1', value: { text: 7 } } },
            { v: 1, t: 'publish', id: 'p3', p: { topic: 'notes.v1', value: { text: 'hi' } } },
            { v: 1, t: 'publish', id: 'p4', p: { topic: 'counts.v1', value: 2 } },
          ],
        },
      });
      await vi.waitUntil(() => a.inbox.some((m) => m.t === 'deliver' && m.p.topic === 'notes.v1'));
      await vi.waitUntil(() => a.result('p4'));
      expect(a.result('p1')).toEqual({ ok: true, value: { offset: 0 } });
      expect(a.result('p2')).toMatchObject({ ok: false, error: { code: 'invalid' } });
      expect(a.result('p3')).toEqual({ ok: true, value: { offset: 0 } });
      expect(a.result('p4')).toEqual({ ok: true, value: { offset: 1 } });
      const delivered = a.inbox.flatMap((m) =>
        m.t === 'deliver' && m.p.topic === 'notes.v1' ? m.p.records.map((r) => r.value) : [],
      );
      expect(delivered).toEqual([{ text: 'hi', by: 'anon' }]);
      // What the broker sent in one task came back as fewer messages than envelopes.
      expect(a.messages.batches).toBeGreaterThan(0);
      expect(a.messages.n).toBeLessThan(a.inbox.length);
      a.port1.close();
    });

    it('with it off, the broker still accepts batches and answers one envelope per message', async () => {
      const bus = shell(10, false);
      bus.release();
      await vi.waitUntil(() => bus.got.some((m) => m.t === 'ready'));
      const a = isolate();
      bus.send({
        v: 1,
        t: 'attach',
        p: { isolateId: 'A', grants: { publish: ['*'], subscribe: [] }, port: a.port2 },
      });
      a.port1.postMessage({
        v: 1,
        t: 'batch',
        p: {
          msgs: ['p1', 'p2'].map((id) => ({
            v: 1,
            t: 'publish',
            id,
            p: { topic: 'counts.v1', value: 1 },
          })),
        },
      });
      await vi.waitUntil(() => a.result('p2'));
      expect(a.result('p1')).toMatchObject({ ok: true });
      expect(a.messages.batches).toBe(0);
      expect(a.messages.n).toBe(a.inbox.length);
      a.port1.close();
    });
  });
});
