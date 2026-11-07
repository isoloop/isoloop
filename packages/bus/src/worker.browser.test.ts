// The bus worker in a real Worker (plan m2-bus task 7). Isolates are plain
// MessageChannel ends held by the test page.
import type {
  BusRecord,
  BusToHost,
  BusToIsolate,
  CallResult,
  Grants,
  HostToBus,
  TopicConfig,
} from '@isoloop/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import list from './__fixtures__/contracts';
import { topicConfig } from './topic';

const fixture = (name: string): string =>
  new URL(`./__fixtures__/${name}.ts`, import.meta.url).href;

const TOPICS: TopicConfig[] = list.topics.map(topicConfig);
const ALL: Grants = { publish: ['*'], subscribe: ['*'] };

const workers: Worker[] = [];
afterEach(() => {
  for (const w of workers.splice(0)) w.terminate();
});

let ids = 0;

function startBus(contractsUrl = fixture('contracts'), topics = TOPICS) {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  workers.push(worker);
  const got: BusToHost[] = [];
  worker.addEventListener('message', (e: MessageEvent<BusToHost>) => {
    got.push(e.data);
  });
  const send = (msg: HostToBus, transfer: Transferable[] = []): void => {
    worker.postMessage(msg, transfer);
  };
  send({ v: 1, t: 'boot', p: { contractsUrl, topics, heartbeatMs: 50, dev: true } });

  const attach = (isolateId: string, grants: Grants = ALL) => {
    const { port1, port2 } = new MessageChannel();
    send({ v: 1, t: 'attach', p: { isolateId, grants, port: port2 } }, [port2]);
    const inbox: BusToIsolate[] = [];
    const waiting = new Map<string, (r: CallResult) => void>();
    port1.addEventListener('message', (e: MessageEvent<BusToIsolate>) => {
      inbox.push(e.data);
      if (e.data.t === 'result' && e.data.re !== undefined) waiting.get(e.data.re)?.(e.data.p);
    });
    port1.start();
    const call = (t: 'publish' | 'subscribe' | 'commit', p: Record<string, unknown>) => {
      const id = `m${++ids}`;
      const done = new Promise<CallResult>((resolve) => waiting.set(id, resolve));
      port1.postMessage({ v: 1, t, id, p });
      return done;
    };
    const records = (topic: string): BusRecord[] =>
      inbox.flatMap((m) => (m.t === 'deliver' && m.p.topic === topic ? m.p.records : []));
    return { port: port1, inbox, call, records };
  };

  const first = <T extends BusToHost['t']>(t: T) =>
    vi.waitUntil(() => got.find((m): m is Extract<BusToHost, { t: T }> => m.t === t), {
      timeout: 3000,
    });
  return { worker, got, send, attach, first };
}

async function fatal(bus: ReturnType<typeof startBus>) {
  const e = await bus.first('error');
  expect(e.p.fatal).toBe(true);
  expect(bus.got.some((m) => m.t === 'ready')).toBe(false);
  return e.p;
}

describe('bus worker', () => {
  it('boots with a contracts module, then publishes and delivers between two isolates', async () => {
    const bus = startBus();
    const ready = await bus.first('ready');
    // These contracts have no persistent topic, so the bus leaves OPFS and
    // its lock alone (M2b task 13).
    expect(ready.p).toEqual({ engine: 'ts', storage: 'memory', restored: [] });

    const a = bus.attach('A');
    const d = bus.attach('D');
    expect(await d.call('subscribe', { topic: 'notes.v1', from: 'earliest' })).toMatchObject({
      ok: true,
    });
    const r = await a.call('publish', { topic: 'notes.v1', value: { text: 'hi' } });
    expect(r).toEqual({ ok: true, value: { offset: 0 } });
    await vi.waitUntil(() => d.records('notes.v1').length === 1);
    // The log holds the validated output: the default is applied.
    expect(d.records('notes.v1')[0]).toMatchObject({
      offset: 0,
      producer: 'A',
      value: { text: 'hi', by: 'anon' },
    });
    expect(a.records('notes.v1')).toEqual([]);
  });

  it('validates and delivers, in order, publishes sent before contracts finish loading', async () => {
    const bus = startBus(fixture('slow-contracts'));
    const a = bus.attach('A');
    const d = bus.attach('D');
    // All sent at once, before `ready`.
    const sub = d.call('subscribe', { topic: 'counts.v1', from: 'earliest' });
    const results = Promise.all([
      a.call('publish', { topic: 'counts.v1', key: 'k1', value: 1 }),
      a.call('publish', { topic: 'counts.v1', key: 'k2', value: 1.5 }),
      a.call('publish', { topic: 'counts.v1', key: 'k3', value: 3 }),
    ]);
    expect(bus.got.some((m) => m.t === 'ready')).toBe(false);
    expect(await sub).toMatchObject({ ok: true });
    const [r1, r2, r3] = await results;
    expect(r1).toEqual({ ok: true, value: { offset: 0 } });
    expect(r2).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(r3).toEqual({ ok: true, value: { offset: 1 } });
    await vi.waitUntil(() => d.records('counts.v1').length === 2);
    expect(d.records('counts.v1').map((x) => [x.key, x.value])).toEqual([
      ['k1', 1],
      ['k3', 3],
    ]);
  });

  it('answers a host publish on the control port', async () => {
    const bus = startBus();
    const d = bus.attach('D');
    await d.call('subscribe', { topic: 'notes.v1', from: 'earliest' });
    bus.send({ v: 1, t: 'publish', id: 'h1', p: { topic: 'notes.v1', value: { text: 'host' } } });
    const result = await vi.waitUntil(() => bus.got.find((m) => m.t === 'result'));
    expect(result).toMatchObject({ re: 'h1', p: { ok: true } });
    await vi.waitUntil(() => d.records('notes.v1').length === 1);
    expect(d.records('notes.v1')[0]?.producer).toBe('host');
  });

  it('sends beats and 1 s metrics', async () => {
    const bus = startBus();
    const a = bus.attach('A');
    const d = bus.attach('D');
    await d.call('subscribe', { topic: 'notes.v1', from: 'earliest' });
    await a.call('publish', { topic: 'notes.v1', value: { text: 'x' } });
    await a.call('publish', { topic: 'notes.v1', value: 7 });
    await bus.first('beat');
    const m = await bus.first('metrics');
    const notes = m.p.topics.find((t) => t.topic === 'notes.v1');
    expect(notes?.recordsPerSec).toBeGreaterThan(0);
    expect(notes?.bytesPerSec).toBeGreaterThan(0);
    expect(m.p.subscriptions).toContainEqual({
      consumer: 'D',
      topic: 'notes.v1',
      lag: 0,
      credit: 999,
    });
    expect(m.p.rejected).toEqual({ invalid: 1 });
  });

  describe('contracts failures are fatal', () => {
    it('a module without a default export: contracts_invalid', async () => {
      expect(await fatal(startBus(fixture('no-default')))).toMatchObject({
        code: 'contracts_invalid',
      });
    });

    it('a 404: contracts_failed', async () => {
      expect(await fatal(startBus(fixture('missing')))).toMatchObject({
        code: 'contracts_failed',
      });
    });

    it('a differing retention: contracts_mismatch, naming the topic', async () => {
      const topics = structuredClone(TOPICS);
      for (const t of topics) if (t.name === 'notes.v1') t.retention = { kind: 'last-n', n: 5 };
      const p = await fatal(startBus(fixture('contracts'), topics));
      expect(p.code).toBe('contracts_mismatch');
      expect(p.message).toContain('notes.v1');
      expect(p.message).not.toContain('counts.v1');
    });

    it('an isoloop.* export: reserved_topic', async () => {
      expect(await fatal(startBus(fixture('reserved')))).toMatchObject({ code: 'reserved_topic' });
    });
  });
});
