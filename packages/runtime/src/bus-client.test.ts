import {
  BusError,
  isBatch,
  unbatch,
  type BusToIsolate,
  type IsolateToBus,
  type TopicRef,
} from '@isoloop/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createBusClient } from './bus-client';

const t = <T>(name: string): TopicRef<T, T, T, T> => ({ name, schema: { '~standard': {} } });
const nums = t<number>('nums.v1');

/** A bus end the test drives by hand. */
function fakeBus() {
  const { port1, port2 } = new MessageChannel();
  const got: IsolateToBus[] = [];
  port1.addEventListener('message', (e: MessageEvent<IsolateToBus>) => got.push(e.data));
  port1.start();
  const send = (m: BusToIsolate): void => port1.postMessage(m);
  const next = <K extends IsolateToBus['t']>(k: K) =>
    vi.waitUntil(() => got.find((m): m is Extract<IsolateToBus, { t: K }> => m.t === k));
  return { port: port2, got, send, next };
}

const rec = (offset: number) => ({ offset, value: offset * 10, ts: 0, producer: 'A' });

describe('createBusClient', () => {
  it('publish resolves on ok and rejects with a BusError on failure', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port, { epoch: 7 });
    const ok = client.publish(nums, { key: 'k', value: 1 });
    const sent = await bus.next('publish');
    expect(sent.p).toEqual({ topic: 'nums.v1', key: 'k', value: 1, epoch: 7, seq: 1 });
    bus.send({ v: 1, t: 'result', re: sent.id ?? '', p: { ok: true, value: { offset: 0 } } });
    await expect(ok).resolves.toBeUndefined();

    bus.got.length = 0;
    const bad = client.publish(nums, { value: 2 });
    const sent2 = await bus.next('publish');
    bus.send({
      v: 1,
      t: 'result',
      re: sent2.id ?? '',
      p: {
        ok: false,
        error: { code: 'invalid', message: 'no', issues: [{ message: 'x', path: [] }] },
      },
    });
    await expect(bad).rejects.toBeInstanceOf(BusError);
    await expect(bad).rejects.toMatchObject({ code: 'invalid', issues: [{ message: 'x' }] });
  });

  it('runs handlers in order, commits after each, and calls onReset', async () => {
    const bus = fakeBus();
    // Interval 0: each task that settles a record sends its own commits.
    const { client } = createBusClient(bus.port, { commitIntervalMs: 0 });
    const seen: number[] = [];
    const onReset = vi.fn();
    client.subscribe(
      nums,
      async (r) => {
        await new Promise((res) => setTimeout(res, 5));
        seen.push(r.value);
      },
      { from: 'committed', onReset },
    );
    expect((await bus.next('subscribe')).p).toEqual({ topic: 'nums.v1', from: 'committed' });
    bus.send({ v: 1, t: 'deliver', p: { topic: 'nums.v1', records: [rec(0), rec(1)] } });
    await vi.waitUntil(() => bus.got.filter((m) => m.t === 'commits').length === 2);
    expect(seen).toEqual([0, 10]);
    expect(bus.got.filter((m) => m.t === 'commits').map((m) => m.p)).toEqual([
      { offsets: [{ topic: 'nums.v1', offset: 0 }] },
      { offsets: [{ topic: 'nums.v1', offset: 1 }] },
    ]);
    bus.send({ v: 1, t: 'reset', p: { topic: 'nums.v1', reason: 'bus_restart' } });
    await vi.waitUntil(() => onReset.mock.calls.length === 1);
  });

  it('replies on the topic the request record came from', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port);
    let answered: Promise<void> | undefined;
    client.subscribe(nums, (r) => {
      answered = client.reply(r, r.value + 1);
    });
    bus.send({
      v: 1,
      t: 'deliver',
      p: {
        topic: 'nums.v1',
        records: [{ offset: 4, value: 1, ts: 0, producer: 'A', req: { from: 'A', id: 'q' } }],
      },
    });
    const reply = await bus.next('reply');
    expect(reply.p).toEqual({ topic: 'nums.v1', offset: 4, value: 2 });
    bus.send({
      v: 1,
      t: 'result',
      re: reply.id ?? '',
      p: { ok: true, value: { delivered: true } },
    });
    await vi.waitUntil(() => answered !== undefined);
    await expect(answered).resolves.toBeUndefined();
  });

  it('a request with no answer rejects with timeout', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port);
    await expect(client.request(nums, 1, { timeoutMs: 30 })).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('rejects with bus_unavailable past the inbox limit', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port, { inboxLimit: 2 });
    void client.publish(nums, { value: 1 });
    void client.publish(nums, { value: 2 });
    await expect(client.publish(nums, { value: 3 })).rejects.toMatchObject({
      code: 'bus_unavailable',
    });
  });

  it('on reattach, subscribes again and re-sends unanswered publishes in order', async () => {
    const old = fakeBus();
    const handle = createBusClient(old.port, { epoch: 3 });
    handle.client.subscribe(nums, () => {}, { from: 'earliest' });
    const a = handle.client.publish(nums, { value: 1 });
    const b = handle.client.publish(nums, { value: 2 });
    await vi.waitUntil(() => old.got.length === 3);

    const fresh = fakeBus();
    handle.reattach(fresh.port);
    await vi.waitUntil(() => fresh.got.length === 3);
    expect(fresh.got.map((m) => [m.t, m.p])).toEqual([
      ['subscribe', { topic: 'nums.v1', from: 'earliest' }],
      // The same ids as before, so a persistent topic can tell re-sends apart.
      ['publish', { topic: 'nums.v1', value: 1, epoch: 3, seq: 1 }],
      ['publish', { topic: 'nums.v1', value: 2, epoch: 3, seq: 2 }],
    ]);
    for (const m of fresh.got)
      if (m.t === 'publish')
        fresh.send({ v: 1, t: 'result', re: m.id ?? '', p: { ok: true, value: null } });
    await expect(Promise.all([a, b])).resolves.toEqual([undefined, undefined]);
  });

  it('numbers publishes and requests in one sequence, under an epoch new per client', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port);
    void client.publish(nums, { value: 1 });
    void client.request(nums, 2).catch(() => {});
    void client.publish(nums, { value: 3 });
    await vi.waitUntil(() => bus.got.length === 3);
    const ids = bus.got.map((m) => ('seq' in m.p ? [m.p.epoch, m.p.seq] : []));
    const epoch = ids[0]?.[0];
    expect(typeof epoch).toBe('number');
    expect(ids).toEqual([
      [epoch, 1],
      [epoch, 2],
      [epoch, 3],
    ]);

    const other = fakeBus();
    const second = createBusClient(other.port);
    void second.client.publish(nums, { value: 1 });
    const sent = await other.next('publish');
    expect(sent.p.epoch).not.toBe(epoch);
  });
});

const commitsOf = (got: IsolateToBus[]) =>
  got.flatMap((m) => (m.t === 'commits' ? [m.p.offsets] : []));

describe('combined commits (ADR 0016, decision 1)', () => {
  it('sends the settled offsets together, once per interval', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port, { commitIntervalMs: 60 });
    client.subscribe(nums, () => {});
    await bus.next('subscribe');
    bus.send({ v: 1, t: 'deliver', p: { topic: 'nums.v1', records: [rec(0), rec(1), rec(2)] } });
    await new Promise((r) => setTimeout(r, 20));
    expect(commitsOf(bus.got)).toEqual([]);
    await vi.waitUntil(() => commitsOf(bus.got).length === 1);
    expect(commitsOf(bus.got)).toEqual([[{ topic: 'nums.v1', offset: 2 }]]);
  });

  it('sends early at half a subscription’s credit, so it never pauses for the interval', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port, { commitIntervalMs: 1000, credit: 4 });
    client.subscribe(nums, () => {});
    await bus.next('subscribe');
    bus.send({ v: 1, t: 'deliver', p: { topic: 'nums.v1', records: [0, 1, 2].map(rec) } });
    await vi.waitUntil(() => commitsOf(bus.got).length === 1);
    expect(commitsOf(bus.got)).toEqual([[{ topic: 'nums.v1', offset: 1 }]]);
  });

  it('stops at the record before a handler that throws', async () => {
    const bus = fakeBus();
    const onError = vi.fn();
    const handle = createBusClient(bus.port, { commitIntervalMs: 1000, onError });
    handle.client.subscribe(nums, (r) => {
      if (r.offset === 1) throw new Error('boom');
    });
    await bus.next('subscribe');
    bus.send({ v: 1, t: 'deliver', p: { topic: 'nums.v1', records: [0, 1, 2].map(rec) } });
    await vi.waitUntil(() => onError.mock.calls.length === 1);
    void handle.close();
    await vi.waitUntil(() => commitsOf(bus.got).length === 1);
    expect(commitsOf(bus.got)).toEqual([[{ topic: 'nums.v1', offset: 0 }]]);
  });

  it('close sends what is pending at once: shutdown, for every reason', async () => {
    const bus = fakeBus();
    const handle = createBusClient(bus.port, { commitIntervalMs: 1000 });
    handle.client.subscribe(nums, () => {});
    await bus.next('subscribe');
    bus.send({ v: 1, t: 'deliver', p: { topic: 'nums.v1', records: [rec(5)] } });
    await new Promise((r) => setTimeout(r, 10));
    expect(commitsOf(bus.got)).toEqual([]);
    let closed = false;
    void handle.close().then(() => {
      closed = true;
    });
    const sent = await bus.next('commits');
    expect(sent.p.offsets).toEqual([{ topic: 'nums.v1', offset: 5 }]);
    // It waits for the broker's answer before shutdown goes on to `bye`.
    await new Promise((r) => setTimeout(r, 10));
    expect(closed).toBe(false);
    bus.send({ v: 1, t: 'result', re: sent.id ?? '', p: { ok: true, value: null } });
    await vi.waitUntil(() => closed);
  });

  it('commits before it unsubscribes', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port, { commitIntervalMs: 1000 });
    const off = client.subscribe(nums, () => {});
    await bus.next('subscribe');
    bus.send({ v: 1, t: 'deliver', p: { topic: 'nums.v1', records: [rec(3)] } });
    await new Promise((r) => setTimeout(r, 10));
    off();
    await bus.next('unsubscribe');
    const order = bus.got.map((m) => m.t).filter((k) => k === 'commits' || k === 'unsubscribe');
    expect(order).toEqual(['commits', 'unsubscribe']);
  });

  it('sends pending commits first on the new port after a bus restart', async () => {
    const bus = fakeBus();
    const handle = createBusClient(bus.port, { commitIntervalMs: 1000 });
    handle.client.subscribe(nums, () => {});
    await bus.next('subscribe');
    bus.send({ v: 1, t: 'deliver', p: { topic: 'nums.v1', records: [rec(7)] } });
    await new Promise((r) => setTimeout(r, 10));
    const next = fakeBus();
    handle.reattach(next.port);
    await next.next('subscribe');
    expect(next.got.map((m) => m.t).slice(0, 2)).toEqual(['commits', 'subscribe']);
    expect(commitsOf(next.got)).toEqual([[{ topic: 'nums.v1', offset: 7 }]]);
    expect(commitsOf(bus.got)).toEqual([]);
  });

  it('forgets offsets of a memory topic the bus restart lost', async () => {
    const bus = fakeBus();
    const handle = createBusClient(bus.port, { commitIntervalMs: 1000 });
    handle.client.subscribe(nums, () => {});
    await bus.next('subscribe');
    bus.send({ v: 1, t: 'deliver', p: { topic: 'nums.v1', records: [rec(2)] } });
    await new Promise((r) => setTimeout(r, 10));
    bus.send({ v: 1, t: 'reset', p: { topic: 'nums.v1', reason: 'bus_restart' } });
    await new Promise((r) => setTimeout(r, 10));
    await handle.close();
    expect(commitsOf(bus.got)).toEqual([]);
  });
});

/** A bus end that counts port messages and opens batches, as the broker does. */
function batchingBus() {
  const { port1, port2 } = new MessageChannel();
  const raw: unknown[] = [];
  const got: IsolateToBus[] = [];
  port1.addEventListener('message', (e: MessageEvent<unknown>) => {
    raw.push(e.data);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the client sends IsolateToBus
    unbatch(e.data, (m) => got.push(m as IsolateToBus));
  });
  port1.start();
  const send = (m: unknown): void => port1.postMessage(m);
  return { port: port2, raw, got, send };
}

describe('batching per port per task (ADR 0016, decision 3)', () => {
  it('what one task sends goes as one message, in order; the next task starts a new one', async () => {
    const bus = batchingBus();
    const { client } = createBusClient(bus.port, { epoch: 1, batch: true });
    void client.publish(nums, { value: 1 });
    void client.publish(nums, { value: 2 });
    void client.publish(nums, { value: 3 });
    await new Promise((r) => setTimeout(r, 0));
    void client.publish(nums, { value: 4 });
    void client.publish(nums, { value: 5 });
    await vi.waitUntil(() => bus.got.length === 5);
    expect(bus.raw).toHaveLength(2);
    expect(bus.raw.every((m) => isBatch(m))).toBe(true);
    expect(bus.got.map((m) => (m.t === 'publish' ? m.p.seq : -1))).toEqual([1, 2, 3, 4, 5]);
  });

  it('off, it sends one message per envelope, as before', async () => {
    const bus = batchingBus();
    const { client } = createBusClient(bus.port);
    void client.publish(nums, { value: 1 });
    void client.publish(nums, { value: 2 });
    await vi.waitUntil(() => bus.got.length === 2);
    expect(bus.raw).toHaveLength(2);
    expect(bus.raw.some((m) => isBatch(m))).toBe(false);
  });

  it('accepts batches from the bus whatever its own setting', async () => {
    const bus = batchingBus();
    const { client } = createBusClient(bus.port);
    const seen: number[] = [];
    client.subscribe(nums, (r) => {
      seen.push(r.value);
    });
    const ok = client.publish(nums, { value: 9 });
    await vi.waitUntil(() => bus.got.length === 2);
    const pub = bus.got.find((m) => m.t === 'publish');
    bus.send({
      v: 1,
      t: 'batch',
      p: {
        msgs: [
          { v: 1, t: 'result', re: pub?.id ?? '', p: { ok: true, value: { offset: 0 } } },
          { v: 1, t: 'deliver', p: { topic: 'nums.v1', records: [rec(0), rec(1)] } },
        ],
      },
    });
    await expect(ok).resolves.toBeUndefined();
    await vi.waitUntil(() => seen.length === 2);
    expect(seen).toEqual([0, 10]);
  });

  it('a commit rides with the publish its handler made in the same task', async () => {
    const bus = batchingBus();
    const { client } = createBusClient(bus.port, { batch: true, commitIntervalMs: 0 });
    client.subscribe(nums, (r) => {
      void client.publish(nums, { value: r.value + 1 });
    });
    await vi.waitUntil(() => bus.got.some((m) => m.t === 'subscribe'));
    const before = bus.raw.length;
    bus.send({ v: 1, t: 'deliver', p: { topic: 'nums.v1', records: [rec(4)] } });
    await vi.waitUntil(() => bus.got.some((m) => m.t === 'commits'));
    const after = bus.raw.slice(before);
    expect(after).toHaveLength(1);
    const [only] = after;
    expect(isBatch(only) ? only.p.msgs.map((m) => m.t) : []).toEqual(['publish', 'commits']);
  });

  it('on reattach, what was queued for the old bus is dropped, not sent twice', async () => {
    const old = batchingBus();
    const handle = createBusClient(old.port, { epoch: 2, batch: true });
    const a = handle.client.publish(nums, { value: 1 });
    const fresh = batchingBus();
    handle.reattach(fresh.port); // same task: the publish is still queued
    await vi.waitUntil(() => fresh.got.length === 1);
    await new Promise((r) => setTimeout(r, 10));
    expect(old.got).toEqual([]);
    expect(fresh.got.map((m) => [m.t, m.p])).toEqual([
      ['publish', { topic: 'nums.v1', value: 1, epoch: 2, seq: 1 }],
    ]);
    const pub = fresh.got[0];
    fresh.send({ v: 1, t: 'result', re: pub?.id ?? '', p: { ok: true, value: null } });
    await expect(a).resolves.toBeUndefined();
  });

  it('close still waits for the broker’s answer to its last commits', async () => {
    const bus = batchingBus();
    const handle = createBusClient(bus.port, { batch: true, commitIntervalMs: 1000 });
    handle.client.subscribe(nums, () => {});
    await vi.waitUntil(() => bus.got.some((m) => m.t === 'subscribe'));
    bus.send({ v: 1, t: 'deliver', p: { topic: 'nums.v1', records: [rec(5)] } });
    await new Promise((r) => setTimeout(r, 10));
    let closed = false;
    void handle.close().then(() => {
      closed = true;
    });
    await vi.waitUntil(() => bus.got.some((m) => m.t === 'commits'));
    const sent = bus.got.find((m) => m.t === 'commits');
    await new Promise((r) => setTimeout(r, 10));
    expect(closed).toBe(false);
    bus.send({ v: 1, t: 'result', re: sent?.id ?? '', p: { ok: true, value: null } });
    await vi.waitUntil(() => closed);
  });
});
