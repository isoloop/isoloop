import type { BusToIsolate, IsolateToBus, TopicRef, ViewValue, WatchKey } from '@isoloop/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createBusClient } from './bus-client';

const t = <T>(name: string): TopicRef<T, T, T, T> => ({ name, schema: { '~standard': {} } });
const prices = t<number>('prices.v1');

/** A bus end the test drives by hand. */
function fakeBus() {
  const { port1, port2 } = new MessageChannel();
  const got: IsolateToBus[] = [];
  port1.addEventListener('message', (e: MessageEvent<IsolateToBus>) => got.push(e.data));
  port1.start();
  const send = (m: BusToIsolate): void => port1.postMessage(m);
  const of = <K extends IsolateToBus['t']>(k: K) =>
    got.filter((m): m is Extract<IsolateToBus, { t: K }> => m.t === k);
  /** Answers every `watch` sent so far with ok. */
  const ack = (): void => {
    for (const m of of('watch'))
      if (m.id !== undefined) send({ v: 1, t: 'result', re: m.id, p: { ok: true, value: null } });
  };
  return { port: port2, got, send, of, ack };
}

const val = (key: WatchKey, version: number, value = version * 10): ViewValue => ({
  key,
  version,
  value,
});

const view = (
  vseq: number,
  values: ViewValue[],
  extra: { cleared?: WatchKey[]; more?: true } = {},
): BusToIsolate => ({ v: 1, t: 'view', p: { topic: 'prices.v1', vseq, values, ...extra } });

const seenOf = (got: IsolateToBus[]) =>
  got.flatMap((m) => (m.t === 'commits' && m.p.seen ? m.p.seen : []));

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Records each `onView` call as plain arrays. */
function recorder() {
  const calls: { view: [WatchKey, number][]; changed: WatchKey[] }[] = [];
  const fn = (v: ReadonlyMap<WatchKey, number>, changed: ReadonlySet<WatchKey>): void => {
    calls.push({ view: [...v], changed: [...changed] });
  };
  return { calls, fn };
}

describe('bus.watch (ADR 0023)', () => {
  it('two watches with different keys share one bus watch and get only their keys', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port);
    const a = recorder();
    const b = recorder();
    client.watch(prices, a.fn, { keys: ['AAPL'] });
    client.watch(prices, b.fn, { keys: ['MSFT', null] });
    await vi.waitUntil(() => bus.of('watch').length === 1);
    await tick();
    expect(bus.of('watch')).toHaveLength(1);
    expect(bus.of('watch')[0]?.p).toEqual({ topic: 'prices.v1', keys: ['AAPL', 'MSFT', null] });

    bus.send(view(1, [val('AAPL', 1), val('MSFT', 2), val(null, 3)]));
    await vi.waitUntil(() => a.calls.length === 1 && b.calls.length === 1);
    expect(a.calls[0]).toEqual({ view: [['AAPL', 10]], changed: ['AAPL'] });
    expect(b.calls[0]).toEqual({
      view: [
        ['MSFT', 20],
        [null, 30],
      ],
      changed: ['MSFT', null],
    });

    // A view that touches only MSFT leaves the AAPL watch alone.
    bus.send(view(2, [val('MSFT', 4)]));
    await vi.waitUntil(() => b.calls.length === 2);
    await tick();
    expect(a.calls).toHaveLength(1);
    expect(b.calls[1]?.changed).toEqual(['MSFT']);
  });

  it('an unfiltered watch makes the bus watch every key', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port);
    client.watch(prices, () => {}, { keys: ['AAPL'] });
    client.watch(prices, () => {});
    await vi.waitUntil(() => bus.of('watch').length === 1);
    expect(bus.of('watch')[0]?.p).toEqual({ topic: 'prices.v1' });
  });

  it('calls onView once for a snapshot in parts, after the part without more', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port, { commitIntervalMs: 0 });
    const r = recorder();
    client.watch(prices, r.fn);
    await vi.waitUntil(() => bus.of('watch').length === 1);
    // 1,024 values: two full parts of 512, the second without `more`.
    const all = Array.from({ length: 1024 }, (_, i) => val(`k${i}`, i));
    bus.send(view(1, all.slice(0, 512), { more: true }));
    await tick(10);
    expect(r.calls).toHaveLength(0);
    expect(seenOf(bus.got)).toEqual([]);
    bus.send(view(2, all.slice(512)));
    await vi.waitUntil(() => r.calls.length === 1);
    expect(r.calls[0]?.view).toHaveLength(1024);
    expect(r.calls[0]?.changed).toHaveLength(1024);
    // Only the last part is confirmed.
    await vi.waitUntil(() => seenOf(bus.got).length === 1);
    expect(seenOf(bus.got)).toEqual([{ topic: 'prices.v1', vseq: 2 }]);
  });

  it('sends seen only once every local watch on the view has settled', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port, { commitIntervalMs: 0 });
    let release: (() => void) | undefined;
    const held = new Promise<void>((res) => (release = res));
    client.watch(prices, () => {});
    client.watch(prices, () => held);
    await vi.waitUntil(() => bus.of('watch').length === 1);
    bus.send(view(1, [val('AAPL', 1)]));
    await tick(20);
    expect(seenOf(bus.got)).toEqual([]);
    release?.();
    await vi.waitUntil(() => seenOf(bus.got).length === 1);
    expect(seenOf(bus.got)).toEqual([{ topic: 'prices.v1', vseq: 1 }]);
  });

  it('a slow topic sends seen in the next commits, with no message of its own', async () => {
    const bus = fakeBus();
    let clock = 0;
    const nums = t<number>('nums.v1');
    const { client } = createBusClient(bus.port, { commitIntervalMs: 300, now: () => clock });
    client.subscribe(nums, () => {});
    const r = recorder();
    client.watch(prices, r.fn);
    await vi.waitUntil(() => bus.of('watch').length === 1);
    bus.send({
      v: 1,
      t: 'deliver',
      p: { topic: 'nums.v1', records: [{ offset: 0, value: 1, ts: 0, producer: 'A' }], seq: 1 },
    });
    bus.send(view(1, [val('AAPL', 1)]));
    await vi.waitUntil(() => r.calls.length === 1);
    clock = 1000;
    bus.send(view(2, [val('AAPL', 2)]));
    await vi.waitUntil(() => r.calls.length === 2);
    // The snapshot came first and the second view a second later: neither is a burst.
    expect(bus.of('commits')).toEqual([]);
    await vi.waitUntil(() => bus.of('commits').length === 1, { timeout: 1000 });
    await tick(350);
    expect(bus.of('commits')).toHaveLength(1);
    expect(bus.of('commits')[0]?.p).toEqual({
      offsets: [{ topic: 'nums.v1', offset: 0, seq: 1 }],
      seen: [{ topic: 'prices.v1', vseq: 2 }],
    });
  });

  it('a burst sends seen at once', async () => {
    const bus = fakeBus();
    let clock = 0;
    const { client } = createBusClient(bus.port, { commitIntervalMs: 1000, now: () => clock });
    const r = recorder();
    client.watch(prices, r.fn);
    await vi.waitUntil(() => bus.of('watch').length === 1);
    bus.send(view(1, [val('AAPL', 1)]));
    await vi.waitUntil(() => r.calls.length === 1);
    clock = 10;
    bus.send(view(2, [val('AAPL', 2)]));
    // Well inside the 1 s interval: the view came 10 ms after the one before.
    await vi.waitUntil(() => seenOf(bus.got).length === 1, { timeout: 500 });
    expect(seenOf(bus.got)).toEqual([{ topic: 'prices.v1', vseq: 2 }]);
  });

  it('waits for an async onView before the next view', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port, { commitIntervalMs: 0 });
    const order: string[] = [];
    client.watch(prices, async (v) => {
      order.push(`start ${String(v.get('AAPL'))}`);
      await tick(10);
      order.push(`end ${String(v.get('AAPL'))}`);
    });
    await vi.waitUntil(() => bus.of('watch').length === 1);
    bus.send(view(1, [val('AAPL', 1)]));
    bus.send(view(2, [val('AAPL', 2)]));
    await vi.waitUntil(() => order.length === 4);
    expect(order).toEqual(['start 10', 'end 10', 'start 20', 'end 20']);
  });

  it('a new watch on held keys starts from the values held, with no new bus watch', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port);
    client.watch(prices, () => {});
    await vi.waitUntil(() => bus.of('watch').length === 1);
    bus.send(view(1, [val('AAPL', 1), val('MSFT', 2)]));
    await tick(10);
    const late = recorder();
    client.watch(prices, late.fn, { keys: ['MSFT'] });
    await vi.waitUntil(() => late.calls.length === 1);
    expect(late.calls[0]).toEqual({ view: [['MSFT', 20]], changed: ['MSFT'] });
    expect(bus.of('watch')).toHaveLength(1);
  });

  it('a change of keys sends a new watch with have, and drops the pending seen', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port, { commitIntervalMs: 50 });
    client.watch(prices, () => {}, { keys: ['AAPL'] });
    await vi.waitUntil(() => bus.of('watch').length === 1);
    bus.send(view(1, [val('AAPL', 1)]));
    await tick(10);
    // The view's seen waits for the next commits; a new key changes the union first.
    const b = recorder();
    client.watch(prices, b.fn, { keys: ['MSFT'] });
    await vi.waitUntil(() => bus.of('watch').length === 2);
    expect(bus.of('watch')[1]?.p).toEqual({
      topic: 'prices.v1',
      keys: ['AAPL', 'MSFT'],
      have: [['AAPL', 1]],
    });
    await tick(80);
    // vseq 1 of the old watch would confirm vseq 1 of the new one.
    expect(seenOf(bus.got)).toEqual([]);

    bus.send(view(1, [val('MSFT', 3)]));
    await vi.waitUntil(() => b.calls.length > 0 && b.calls.at(-1)?.view.length === 1);
    expect(b.calls.at(-1)?.view).toEqual([['MSFT', 30]]);
    await vi.waitUntil(() => seenOf(bus.got).length === 1);
    expect(seenOf(bus.got)).toEqual([{ topic: 'prices.v1', vseq: 1 }]);
  });

  it('applies a view of the replaced watch but never confirms it', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port, { commitIntervalMs: 0 });
    const a = recorder();
    client.watch(prices, a.fn, { keys: ['AAPL'] });
    await vi.waitUntil(() => bus.of('watch').length === 1);
    bus.send(view(1, [val('AAPL', 1)]));
    await vi.waitUntil(() => seenOf(bus.got).length === 1);
    client.watch(prices, () => {}, { keys: ['MSFT'] });
    await vi.waitUntil(() => bus.of('watch').length === 2);
    // The old watch's next view crossed the new `watch` on its way.
    bus.send(view(2, [val('AAPL', 5)]));
    await vi.waitUntil(() => a.calls.length === 2);
    expect(a.calls[1]?.view).toEqual([['AAPL', 50]]);
    await tick(10);
    expect(seenOf(bus.got)).toEqual([{ topic: 'prices.v1', vseq: 1 }]);
    // The new watch's snapshot is confirmed as usual.
    bus.send(view(1, [val('MSFT', 6)]));
    await vi.waitUntil(() => seenOf(bus.got).length === 2);
    expect(seenOf(bus.got)[1]).toEqual({ topic: 'prices.v1', vseq: 1 });
  });

  it('clears keys the view removes', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port);
    const r = recorder();
    client.watch(prices, r.fn);
    await vi.waitUntil(() => bus.of('watch').length === 1);
    bus.send(view(1, [val('AAPL', 1), val('MSFT', 2)]));
    await vi.waitUntil(() => r.calls.length === 1);
    bus.send(view(2, [], { cleared: ['AAPL'] }));
    await vi.waitUntil(() => r.calls.length === 2);
    expect(r.calls[1]).toEqual({ view: [['MSFT', 20]], changed: ['AAPL'] });
  });

  it('after a bus restart watches again with have, and a full snapshot resets the view', async () => {
    const bus = fakeBus();
    const handle = createBusClient(bus.port, { commitIntervalMs: 0 });
    const r = recorder();
    handle.client.watch(prices, r.fn);
    await vi.waitUntil(() => bus.of('watch').length === 1);
    bus.send(view(1, [val('AAPL', 4), val('MSFT', 5)]));
    await vi.waitUntil(() => r.calls.length === 1);

    const next = fakeBus();
    handle.reattach(next.port);
    await vi.waitUntil(() => next.of('watch').length === 1);
    expect(next.of('watch')[0]?.p).toEqual({
      topic: 'prices.v1',
      have: [
        ['AAPL', 4],
        ['MSFT', 5],
      ],
    });
    // A lost memory topic: the new bus ignores `have`, sends what it holds
    // and clears the rest. Every key the watcher held changes.
    next.send(view(1, [val('AAPL', 0, 7)], { cleared: ['MSFT'] }));
    await vi.waitUntil(() => r.calls.length === 2);
    expect(r.calls[1]).toEqual({ view: [['AAPL', 7]], changed: ['MSFT', 'AAPL'] });
    await vi.waitUntil(() => seenOf(next.got).length === 1);
    expect(seenOf(next.got)).toEqual([{ topic: 'prices.v1', vseq: 1 }]);
  });

  it('a woken client watches with no have', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port, { wake: true });
    client.watch(prices, () => {});
    await vi.waitUntil(() => bus.of('watch').length === 1);
    expect(bus.of('watch')[0]?.p).toEqual({ topic: 'prices.v1' });
  });

  it('a view counts as a delivery for the idle report', async () => {
    const bus = fakeBus();
    let clock = 0;
    const handle = createBusClient(bus.port, { now: () => clock });
    handle.client.watch(prices, () => {});
    await vi.waitUntil(() => bus.of('watch').length === 1);
    bus.ack();
    clock = 500;
    expect(handle.idle().sinceDeliveryMs).toBe(500);
    bus.send(view(1, []));
    await vi.waitUntil(() => handle.idle().sinceDeliveryMs === 0);
  });

  it('reports a refused watch as an error', async () => {
    const bus = fakeBus();
    const onError = vi.fn();
    const { client } = createBusClient(bus.port, { onError });
    client.watch(prices, () => {});
    await vi.waitUntil(() => bus.of('watch').length === 1);
    const m = bus.of('watch')[0];
    bus.send({
      v: 1,
      t: 'result',
      re: m?.id ?? '',
      p: { ok: false, error: { code: 'forbidden', message: 'no subscribe grant for prices.v1' } },
    });
    await vi.waitUntil(() => onError.mock.calls.length === 1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ name: 'BusError', code: 'forbidden' });
  });

  it('ends the bus watch when its last local watch ends, and narrows it before', async () => {
    const bus = fakeBus();
    const { client } = createBusClient(bus.port);
    const stopA = client.watch(prices, () => {}, { keys: ['AAPL'] });
    const stopB = client.watch(prices, () => {}, { keys: ['MSFT'] });
    await vi.waitUntil(() => bus.of('watch').length === 1);
    stopB();
    await vi.waitUntil(() => bus.of('watch').length === 2);
    expect(bus.of('watch')[1]?.p).toEqual({ topic: 'prices.v1', keys: ['AAPL'] });
    stopA();
    await vi.waitUntil(() => bus.of('unwatch').length === 1);
    expect(bus.of('unwatch')[0]?.p).toEqual({ topic: 'prices.v1' });
  });
});
