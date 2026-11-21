// The bus side of the inspection feed (ADR 0020, decisions 2 and 3): taps,
// reads, previews, and the head and retained count in the metrics.
import {
  PREVIEW_CHARS,
  type BusToHost,
  type BusToTap,
  type CallResult,
  type HostToBus,
  type RecordPreview,
} from '@isoloop/protocol';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { connect, flush } from '../../test/memory-port';
import list from '../__fixtures__/contracts';
import { Broker } from '../broker/broker';
import { TsEngine } from '../engine/ts-engine';
import { previewText } from './preview';
import { serve } from './server';
import { openTap, type TapPort } from './tap';
import { contracts, topic, topicConfig, unchecked } from '../contracts/topic';

const notes = topic('notes.v1', {
  schema: unchecked<unknown>(),
  retention: { kind: 'last-n', n: 500 },
});
const prices = topic('prices.v1', {
  schema: z.number(),
  retention: { kind: 'compacted' },
});
const other = topic('other.v1', {
  schema: unchecked<string>(),
  retention: { kind: 'last-n', n: 10 },
});

const host = { kind: 'host' } as const;
const noop = (): void => {};
const never = (): (() => void) => noop;

function setup() {
  const broker = new Broker({
    contracts: contracts(notes, prices, other),
    engine: new TsEngine(),
    now: () => 5,
    systemTopics: [],
  });
  return broker;
}

/** A tap port that keeps what the bus posts, with the host's end to close it from. */
function fakePort() {
  const got: BusToTap[] = [];
  let onMessage: (e: MessageEvent<unknown>) => void = noop;
  let closed = false;
  const port: TapPort = {
    postMessage: (m) => got.push(m),
    addEventListener: (_t, fn) => (onMessage = fn),
    start: () => {},
    close: () => (closed = true),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tap only reads `data`
  const fromHost = (data: unknown): void => onMessage({ data } as MessageEvent<unknown>);
  return { port, got, fromHost, isClosed: () => closed };
}

/** `n` host publishes of 0, 1, 2…, in order. */
const many = (broker: Broker, name: string, n: number, key?: string): Promise<unknown> =>
  Promise.all(Array.from({ length: n }, (_, i) => broker.publish(host, name, key, i)));

const records = (got: BusToTap[]): RecordPreview[] =>
  got.flatMap((m) => (m.t === 'record' ? [m.p] : []));

describe('previewText', () => {
  it('writes values JSON.stringify cannot', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic['self'] = cyclic;
    expect(previewText({ s: 'x', n: 1.5, b: true, u: undefined, z: null }).text).toBe(
      '{"s":"x","n":1.5,"b":true,"u":undefined,"z":null}',
    );
    expect(previewText(10n).text).toBe('10n');
    expect(previewText(cyclic).text).toBe('{"a":1,"self":[Circular]}');
    expect(previewText(new Map([['k', [1, 2]]])).text).toBe('Map{"k"=>[1,2]}');
    expect(previewText(new Set([1])).text).toBe('Set[1]');
    expect(previewText(new Uint8Array(1024)).text).toBe('Uint8Array(1024)');
    expect(previewText(new Date(0)).text).toBe('1970-01-01T00:00:00.000Z');
    expect(previewText([NaN, Infinity]).text).toBe('[NaN,Infinity]');
  });

  it('stops at the limit, and says so', () => {
    const big = { items: Array.from({ length: 10_000 }, (_, i) => ({ i, name: `item ${i}` })) };
    const p = previewText(big);
    expect(p.text.length).toBe(PREVIEW_CHARS);
    expect(p.truncated).toBe(true);
    expect(previewText('x'.repeat(5000)).text.length).toBe(PREVIEW_CHARS);
    expect(previewText({ a: 1 })).toEqual({ text: '{"a":1}', truncated: false });
  });
});

describe('tap', () => {
  it('sends previews of records appended to matching topics only', async () => {
    const broker = setup();
    const t = fakePort();
    openTap(broker, { topics: ['notes.*', 'prices.v1'], port: t.port, every: never });
    await broker.publish(host, 'notes.v1', 'k', { text: 'hi' });
    await broker.publish(host, 'other.v1', undefined, 'not tapped');
    await broker.publish(host, 'prices.v1', 'BTC', 42);
    const [first, second, ...rest] = records(t.got);
    expect(first).toEqual({
      topic: 'notes.v1',
      offset: 0,
      key: 'k',
      ts: 5,
      producer: 'host',
      bytes: first?.bytes,
      preview: '{"text":"hi"}',
      truncated: false,
    });
    expect(first?.bytes).toBeGreaterThan(0);
    expect(second).toMatchObject({ topic: 'prices.v1', key: 'BTC', preview: '42' });
    expect(rest).toEqual([]);
  });

  it('sends at most maxPerSec a second, and reports the rest as skipped', async () => {
    const broker = setup();
    const t = fakePort();
    let now = 0;
    let report = noop;
    openTap(broker, {
      topics: ['notes.v1'],
      maxPerSec: 3,
      port: t.port,
      now: () => now,
      every: (fn) => ((report = fn), () => {}),
    });
    await many(broker, 'notes.v1', 5);
    report();
    expect(records(t.got).map((r) => r.preview)).toEqual(['0', '1', '2']);
    expect(t.got.at(-1)).toEqual({ v: 1, t: 'skipped', p: { count: 2 } });
    now = 1000;
    await broker.publish(host, 'notes.v1', undefined, 5);
    report(); // nothing skipped since: no message
    expect(records(t.got).map((r) => r.preview)).toEqual(['0', '1', '2', '5']);
    expect(t.got.filter((m) => m.t === 'skipped')).toHaveLength(1);
  });

  it('defaults to 50 a second', async () => {
    const broker = setup();
    const t = fakePort();
    openTap(broker, { topics: ['notes.v1'], port: t.port, now: () => 0, every: never });
    await many(broker, 'notes.v1', 60);
    expect(records(t.got)).toHaveLength(50);
  });

  it('is not a consumer: no row in the metrics, no effect on delivery', async () => {
    const broker = setup();
    const t = fakePort();
    openTap(broker, { topics: ['*'], port: t.port, every: never });
    const a = connect(broker, 'A', { publish: ['*'], subscribe: ['*'] });
    a.send({ v: 1, t: 'subscribe', p: { topic: 'notes.v1', from: 'earliest' } });
    await flush();
    await broker.publish(host, 'notes.v1', undefined, 'x');
    await flush();
    expect(broker.stats().subscriptions.map((s) => s.consumer)).toEqual(['A']);
    expect(a.records('notes.v1')).toHaveLength(1);
    expect(records(t.got)).toHaveLength(1);
  });

  it('ends on close from the host', async () => {
    const broker = setup();
    const t = fakePort();
    openTap(broker, { topics: ['notes.v1'], port: t.port, every: never });
    t.fromHost({ v: 1, t: 'close', p: {} });
    await broker.publish(host, 'notes.v1', undefined, 'x');
    expect(t.got).toEqual([]);
    expect(t.isClosed()).toBe(true);
  });
});

describe('read', () => {
  it('returns the last records, oldest first', async () => {
    const broker = setup();
    await many(broker, 'notes.v1', 10);
    const r = await broker.read('notes.v1', 3);
    expect(r.ok && r.records.map((x) => x.value)).toEqual([7, 8, 9]);
    const all = await broker.read('notes.v1', 100);
    expect(all.ok && all.records).toHaveLength(10);
  });

  it('finds the last records past compaction gaps', async () => {
    const broker = setup();
    // 20 updates to one key, then 3 other keys: after compaction, 4 records.
    await many(broker, 'prices.v1', 20, 'a');
    await Promise.all(['b', 'c', 'd'].map((k) => broker.publish(host, 'prices.v1', k, 1)));
    broker.compact();
    const r = await broker.read('prices.v1', 4);
    expect(r.ok && r.records.map((x) => x.key)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('rejects an unknown topic and a bad count', async () => {
    const broker = setup();
    expect(await broker.read('nope.v1', 1)).toMatchObject({
      ok: false,
      error: { code: 'unknown_topic' },
    });
    expect(await broker.read('notes.v1', 0)).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
  });
});

describe('metrics', () => {
  it('give each topic its head and retained count', async () => {
    const broker = setup();
    await many(broker, 'prices.v1', 5, 'a');
    broker.compact();
    expect(broker.stats().topics.find((x) => x.topic === 'prices.v1')).toMatchObject({
      records: 5,
      head: 5,
      retained: 1,
    });
  });
});

/** The bus worker over a fake scope, booted with the fixture contracts. */
async function shell() {
  const got: BusToHost[] = [];
  let onMessage: (e: MessageEvent<unknown>) => void = noop;
  serve(
    { postMessage: (m) => got.push(m), addEventListener: (_t, fn) => (onMessage = fn) },
    { importModule: () => Promise.resolve({ default: list }) },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the shell only reads `data`
  const send = (msg: HostToBus): void => onMessage({ data: msg } as MessageEvent<unknown>);
  const result = async (id: string): Promise<CallResult> => {
    await vi.waitUntil(() => got.some((m) => m.t === 'result' && m.re === id));
    const m = got.find(
      (x): x is Extract<BusToHost, { t: 'result' }> => x.t === 'result' && x.re === id,
    );
    if (!m) throw new Error('no result');
    return m.p;
  };
  send({
    v: 1,
    t: 'boot',
    p: { contractsUrl: 'x', topics: list.topics.map(topicConfig), heartbeatMs: 1e6 },
  });
  return { got, send, result };
}

describe('bus shell', () => {
  it('answers a read sent before the contracts loaded, capped at 100', async () => {
    const bus = await shell();
    bus.send({ v: 1, t: 'read', id: 'r0', p: { topic: 'counts.v1', last: 5 } });
    expect(await bus.result('r0')).toEqual({ ok: true, value: [] });
    for (let i = 0; i < 120; i++)
      bus.send({
        v: 1,
        t: 'publish',
        id: `p${i}`,
        p: { topic: 'counts.v1', key: `k${i}`, value: i },
      });
    await bus.result('p119');
    bus.send({ v: 1, t: 'read', id: 'r1', p: { topic: 'counts.v1', last: 1000 } });
    const r = await bus.result('r1');
    expect(r.ok && Array.isArray(r.value) && r.value.length).toBe(100);
    bus.send({ v: 1, t: 'read', id: 'r2', p: { topic: 'counts.v1', last: -1 } });
    expect(await bus.result('r2')).toMatchObject({ ok: false, error: { code: 'invalid' } });
  });

  it('opens a tap on a real port', async () => {
    const bus = await shell();
    const { port1, port2 } = new MessageChannel();
    const got: BusToTap[] = [];
    port1.addEventListener('message', (e: MessageEvent<BusToTap>) => got.push(e.data));
    port1.start();
    bus.send({ v: 1, t: 'tap', p: { topics: ['counts.v1'], port: port2 } });
    bus.send({ v: 1, t: 'publish', id: 'p', p: { topic: 'counts.v1', key: 'a', value: 7 } });
    await vi.waitUntil(() => got.length > 0);
    expect(got[0]).toMatchObject({ t: 'record', p: { topic: 'counts.v1', preview: '7' } });
    port1.postMessage({ v: 1, t: 'close', p: {} });
    port1.close();
  });
});
