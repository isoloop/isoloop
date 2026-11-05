import { BusError, type BusToIsolate, type IsolateToBus, type TopicRef } from '@isoloop/protocol';
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
    const { client } = createBusClient(bus.port);
    const ok = client.publish(nums, { key: 'k', value: 1 });
    const sent = await bus.next('publish');
    expect(sent.p).toEqual({ topic: 'nums.v1', key: 'k', value: 1 });
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
    const { client } = createBusClient(bus.port);
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
    await vi.waitUntil(() => bus.got.filter((m) => m.t === 'commit').length === 2);
    expect(seen).toEqual([0, 10]);
    expect(bus.got.filter((m) => m.t === 'commit').map((m) => m.p)).toEqual([
      { topic: 'nums.v1', offset: 0 },
      { topic: 'nums.v1', offset: 1 },
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
    const handle = createBusClient(old.port);
    handle.client.subscribe(nums, () => {}, { from: 'earliest' });
    const a = handle.client.publish(nums, { value: 1 });
    const b = handle.client.publish(nums, { value: 2 });
    await vi.waitUntil(() => old.got.length === 3);

    const fresh = fakeBus();
    handle.reattach(fresh.port);
    await vi.waitUntil(() => fresh.got.length === 3);
    expect(fresh.got.map((m) => [m.t, m.p])).toEqual([
      ['subscribe', { topic: 'nums.v1', from: 'earliest' }],
      ['publish', { topic: 'nums.v1', value: 1 }],
      ['publish', { topic: 'nums.v1', value: 2 }],
    ]);
    for (const m of fresh.got)
      if (m.t === 'publish')
        fresh.send({ v: 1, t: 'result', re: m.id ?? '', p: { ok: true, value: null } });
    await expect(Promise.all([a, b])).resolves.toEqual([undefined, undefined]);
  });
});
