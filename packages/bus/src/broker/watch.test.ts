import type { BusToIsolate, Grants, WatchKey } from '@isoloop/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connect, flush, type FakeIsolate } from '../../test/memory-port';
import { TsEngine } from '../engine/ts-engine';
import { contracts, topic, unchecked } from '../contracts/topic';
import { Broker } from './broker';
import { SNAPSHOT_GRACE_MS, VIEW_PART, WIDE_WATCH_KEYS } from './watch';

const prices = topic('prices.v1', {
  schema: unchecked<number>(),
  retention: { kind: 'last-n', n: 5_000 },
});
const recent = topic('recent.v1', {
  schema: unchecked<string>(),
  retention: { kind: 'last-n', n: 3 },
});
const ticks = topic('ticks.v1', {
  schema: unchecked<number>(),
  retention: { kind: 'time', ms: 10 },
});
const latest = topic('latest.v1', {
  schema: unchecked<number>(),
  retention: { kind: 'compacted' },
});

const all: Grants = { publish: ['*'], subscribe: ['*'] };

function setup() {
  let now = 0;
  const timers: { fn: () => void; at: number }[] = [];
  const engine = new TsEngine({ now: () => now });
  const broker = new Broker({
    contracts: contracts(prices, recent, ticks, latest),
    engine,
    now: () => now,
    dev: true,
    timers: { set: (fn, ms) => void timers.push({ fn, at: now + ms }) },
  });
  const pub = (t: string, key: string | undefined, value: unknown) =>
    broker.publish({ kind: 'host' }, t, key, value);
  /** Publishes `n` records in order, `key(i)` and value `i`. */
  const pubMany = async (t: string, n: number, key: (i: number) => string) => {
    await Promise.all(Array.from({ length: n }, (_, i) => pub(t, key(i), i)));
  };
  /** Moves the clock on and runs the timers that came due. */
  const tick = (ms: number) => {
    now += ms;
    for (const t of timers.splice(0)) {
      if (t.at <= now) t.fn();
      else timers.push(t);
    }
  };
  return { broker, engine, pub, pubMany, tick };
}

type View = Extract<BusToIsolate, { t: 'view' }>['p'];

const views = (iso: FakeIsolate, t: string): View[] =>
  iso.inbox.flatMap((m) => (m.t === 'view' && m.p.topic === t ? [m.p] : []));

const lastView = (iso: FakeIsolate, t: string): View | undefined => views(iso, t).at(-1);

/** The view's values as `key → value`. */
const byKey = (v: View | undefined): Record<string, unknown> =>
  Object.fromEntries((v?.values ?? []).map((x) => [String(x.key), x.value]));

const seen = async (iso: FakeIsolate, t: string, vseq: number) => {
  iso.send({ v: 1, t: 'commits', p: { offsets: [], seen: [{ topic: t, vseq }] } });
  await flush();
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('watch', () => {
  it('sends a snapshot: the newest retained value per key', async () => {
    const { broker, pub } = setup();
    await pub('prices.v1', 'a', 1);
    await pub('prices.v1', 'b', 2);
    await pub('prices.v1', 'a', 3);
    const iso = connect(broker, 'A', all);
    expect(await iso.call('watch', { topic: 'prices.v1' })).toEqual({ ok: true, value: null });
    expect(views(iso, 'prices.v1')).toEqual([
      {
        topic: 'prices.v1',
        vseq: 1,
        values: [
          { key: 'a', version: 2, value: 3 },
          { key: 'b', version: 1, value: 2 },
        ],
      },
    ]);
  });

  it('sends an empty snapshot for a topic with nothing retained', async () => {
    const { broker } = setup();
    const iso = connect(broker, 'A', all);
    await iso.call('watch', { topic: 'prices.v1' });
    expect(views(iso, 'prices.v1')).toEqual([{ topic: 'prices.v1', vseq: 1, values: [] }]);
  });

  it('sends nothing more until the view in flight is seen, then only the newest per key', async () => {
    const { broker, pub, pubMany } = setup();
    const iso = connect(broker, 'A', all);
    await iso.call('watch', { topic: 'prices.v1' });
    await pubMany('prices.v1', 5, () => 'a'); // values 0 to 4
    await pub('prices.v1', 'b', 9);
    await flush();
    expect(views(iso, 'prices.v1')).toHaveLength(1);
    await seen(iso, 'prices.v1', 1);
    expect(lastView(iso, 'prices.v1')).toEqual({
      topic: 'prices.v1',
      vseq: 2,
      values: [
        { key: 'a', version: 4, value: 4 },
        { key: 'b', version: 5, value: 9 },
      ],
    });
  });

  it('sends a view on the next record once the last one is seen', async () => {
    const { broker, pub } = setup();
    const iso = connect(broker, 'A', all);
    await iso.call('watch', { topic: 'prices.v1' });
    await seen(iso, 'prices.v1', 1);
    expect(views(iso, 'prices.v1')).toHaveLength(1);
    await pub('prices.v1', 'a', 1);
    await flush();
    expect(byKey(lastView(iso, 'prices.v1'))).toEqual({ a: 1 });
  });

  it('ignores a seen for a view it has not sent', async () => {
    const { broker, pub } = setup();
    const iso = connect(broker, 'A', all);
    await iso.call('watch', { topic: 'prices.v1' });
    await pub('prices.v1', 'a', 1);
    await seen(iso, 'prices.v1', 7);
    expect(views(iso, 'prices.v1')).toHaveLength(1);
  });

  it('keeps to the keys asked for', async () => {
    const { broker, pub } = setup();
    await pub('prices.v1', 'a', 1);
    await pub('prices.v1', 'b', 2);
    const iso = connect(broker, 'A', all);
    await iso.call('watch', { topic: 'prices.v1', keys: ['a'] });
    expect(byKey(lastView(iso, 'prices.v1'))).toEqual({ a: 1 });
    await seen(iso, 'prices.v1', 1);
    await pub('prices.v1', 'b', 3);
    await flush();
    expect(views(iso, 'prices.v1')).toHaveLength(1);
    await pub('prices.v1', 'a', 4);
    await flush();
    expect(byKey(lastView(iso, 'prices.v1'))).toEqual({ a: 4 });
  });

  it('puts records without a key under the null key', async () => {
    const { broker, pub } = setup();
    await pub('prices.v1', undefined, 1);
    await pub('prices.v1', 'a', 2);
    await pub('prices.v1', undefined, 3);
    const iso = connect(broker, 'A', all);
    await iso.call('watch', { topic: 'prices.v1', keys: [null] });
    expect(lastView(iso, 'prices.v1')?.values).toEqual([{ key: null, version: 2, value: 3 }]);
  });

  it('clears a key when last-n retention drops its newest record', async () => {
    const { broker, pub } = setup();
    await pub('recent.v1', 'a', 'x');
    await pub('recent.v1', 'b', 'y');
    const iso = connect(broker, 'A', all);
    await iso.call('watch', { topic: 'recent.v1' });
    await seen(iso, 'recent.v1', 1);
    // In one task, so one view carries both.
    void pub('recent.v1', 'c', 'z');
    void pub('recent.v1', 'c', 'w');
    await flush();
    const v = lastView(iso, 'recent.v1');
    expect(v?.values).toEqual([{ key: 'c', version: 3, value: 'w' }]);
    expect(v?.cleared).toEqual(['a']);
  });

  it('clears a key when time retention drops it, with no new record', async () => {
    const { broker, pub, tick } = setup();
    await pub('ticks.v1', 'a', 1);
    const iso = connect(broker, 'A', all);
    await iso.call('watch', { topic: 'ticks.v1' });
    await seen(iso, 'ticks.v1', 1);
    tick(100);
    broker.compact();
    await flush();
    expect(lastView(iso, 'ticks.v1')).toEqual({
      topic: 'ticks.v1',
      vseq: 2,
      values: [],
      cleared: ['a'],
    });
  });

  it('keeps every key of a compacted topic', async () => {
    const { broker, pub, tick } = setup();
    await pub('latest.v1', 'a', 1);
    await pub('latest.v1', 'b', 2);
    await pub('latest.v1', 'a', 3);
    broker.compact();
    const iso = connect(broker, 'A', all);
    await iso.call('watch', { topic: 'latest.v1' });
    expect(byKey(lastView(iso, 'latest.v1'))).toEqual({ a: 3, b: 2 });
    await seen(iso, 'latest.v1', 1);
    await pub('latest.v1', 'b', 4);
    tick(60_000);
    broker.compact();
    await flush();
    const v = lastView(iso, 'latest.v1');
    expect(byKey(v)).toEqual({ b: 4 });
    expect(v?.cleared).toBeUndefined();
  });

  it('sends only what differs from have, and clears what the bus no longer holds', async () => {
    const { broker, pub } = setup();
    await pub('prices.v1', 'a', 1); // 0
    await pub('prices.v1', 'b', 2); // 1
    await pub('prices.v1', 'b', 3); // 2
    const iso = connect(broker, 'A', all);
    await iso.call('watch', {
      topic: 'prices.v1',
      have: [
        ['a', 0],
        ['b', 1],
        ['gone', 7],
      ],
    });
    expect(views(iso, 'prices.v1')).toEqual([
      {
        topic: 'prices.v1',
        vseq: 1,
        values: [{ key: 'b', version: 2, value: 3 }],
        cleared: ['gone'],
      },
    ]);
  });

  it('sends every key again on the first watch of a memory topic after a bus restart', async () => {
    const { broker, pub } = setup();
    await pub('prices.v1', 'a', 1); // offset 0, as on the bus that restarted
    const iso = connect(broker, 'R', all);
    broker.attach('R', all, iso.port, { reattach: true });
    await iso.call('watch', {
      topic: 'prices.v1',
      have: [
        ['a', 0],
        ['b', 4],
      ],
    });
    const v = lastView(iso, 'prices.v1');
    expect(v?.values).toEqual([{ key: 'a', version: 0, value: 1 }]);
    expect(v?.cleared).toEqual(['b']);
  });

  it('sends a large snapshot in parts of 512 values, and waits only for the last', async () => {
    const { broker, pub, pubMany } = setup();
    await pubMany('prices.v1', VIEW_PART * 2 + 10, (i) => `k${i}`);
    const iso = connect(broker, 'A', all);
    await iso.call('watch', { topic: 'prices.v1' });
    const parts = views(iso, 'prices.v1');
    expect(parts.map((p) => [p.vseq, p.values.length])).toEqual([
      [1, VIEW_PART],
      [2, VIEW_PART],
      [3, 10],
    ]);
    await pub('prices.v1', 'k0', -1);
    await seen(iso, 'prices.v1', 2);
    expect(views(iso, 'prices.v1')).toHaveLength(3);
    await seen(iso, 'prices.v1', 3);
    expect(lastView(iso, 'prices.v1')).toMatchObject({ vseq: 4, values: [{ key: 'k0' }] });
  });

  it('reads a later watch’s snapshot from the map while the grace lasts', async () => {
    const { broker, engine, pubMany, tick } = setup();
    await pubMany('prices.v1', 20, (i) => `k${i % 4}`);
    const read = vi.spyOn(engine, 'read');
    const scans = () => read.mock.calls.filter(([t, , max]) => t === 'prices.v1' && max > 1).length;
    const a = connect(broker, 'A', all);
    await a.call('watch', { topic: 'prices.v1' });
    expect(scans()).toBe(1);
    await a.call('unwatch', { topic: 'prices.v1' });
    tick(SNAPSHOT_GRACE_MS - 1);
    const b = connect(broker, 'B', all);
    await b.call('watch', { topic: 'prices.v1' });
    expect(byKey(lastView(b, 'prices.v1'))).toEqual({ k0: 16, k1: 17, k2: 18, k3: 19 });
    expect(scans()).toBe(1); // nothing appended since the map was read
    await b.call('unwatch', { topic: 'prices.v1' });
    tick(SNAPSHOT_GRACE_MS);
    const c = connect(broker, 'C', all);
    await c.call('watch', { topic: 'prices.v1' });
    expect(byKey(lastView(c, 'prices.v1'))).toEqual({ k0: 16, k1: 17, k2: 18, k3: 19 });
    expect(scans()).toBe(2);
  });

  it('adds records appended since the map was read to a later snapshot', async () => {
    const { broker, pub } = setup();
    await pub('prices.v1', 'a', 1);
    const a = connect(broker, 'A', all);
    await a.call('watch', { topic: 'prices.v1' });
    await pub('prices.v1', 'a', 2);
    await pub('prices.v1', 'b', 3);
    const b = connect(broker, 'B', all);
    await b.call('watch', { topic: 'prices.v1' });
    expect(byKey(lastView(b, 'prices.v1'))).toEqual({ a: 2, b: 3 });
  });

  it('warns once in dev when an unfiltered watch holds more than 1,000 keys', async () => {
    const { broker, pub, pubMany } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await pubMany('prices.v1', WIDE_WATCH_KEYS + 1, (i) => `k${i}`);
    const iso = connect(broker, 'A', all);
    await iso.call('watch', { topic: 'prices.v1' });
    expect(views(iso, 'prices.v1')).toHaveLength(2);
    await seen(iso, 'prices.v1', 2);
    await pub('prices.v1', 'more', 1);
    await flush();
    expect(views(iso, 'prices.v1')).toHaveLength(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('watches every key of "prices.v1"');
  });

  it('does not warn for a filtered watch', async () => {
    const { broker, pubMany } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const keys: WatchKey[] = Array.from({ length: WIDE_WATCH_KEYS + 1 }, (_, i) => `k${i}`);
    await pubMany('prices.v1', keys.length, (i) => `k${i}`);
    const iso = connect(broker, 'A', all);
    await iso.call('watch', { topic: 'prices.v1', keys });
    expect(warn).not.toHaveBeenCalled();
  });

  it('refuses a watch without the subscribe grant', async () => {
    const { broker } = setup();
    const iso = connect(broker, 'A', { publish: ['*'], subscribe: [] });
    expect(await iso.call('watch', { topic: 'prices.v1' })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(views(iso, 'prices.v1')).toEqual([]);
  });

  it.each([
    ['an unknown topic', { topic: 'nope.v1' }, 'unknown_topic'],
    ['keys that are not strings or null', { topic: 'prices.v1', keys: [1] }, 'invalid'],
    ['a have that is not [key, version] pairs', { topic: 'prices.v1', have: [['a']] }, 'invalid'],
  ])('refuses %s', async (_, p, code) => {
    const { broker } = setup();
    const iso = connect(broker, 'A', all);
    expect(await iso.call('watch', p)).toMatchObject({ ok: false, error: { code } });
  });

  it('replaces a watch with a second one on the topic, counting views from 1 again', async () => {
    const { broker, pub } = setup();
    await pub('prices.v1', 'a', 1);
    await pub('prices.v1', 'b', 2);
    const iso = connect(broker, 'A', all);
    await iso.call('watch', { topic: 'prices.v1', keys: ['a'] });
    await iso.call('watch', { topic: 'prices.v1', keys: ['a', 'b'], have: [['a', 0]] });
    expect(lastView(iso, 'prices.v1')).toEqual({
      topic: 'prices.v1',
      vseq: 1,
      values: [{ key: 'b', version: 1, value: 2 }],
    });
  });

  it('sends nothing after unwatch', async () => {
    const { broker, pub } = setup();
    const iso = connect(broker, 'A', all);
    await iso.call('watch', { topic: 'prices.v1' });
    await seen(iso, 'prices.v1', 1);
    await iso.call('unwatch', { topic: 'prices.v1' });
    await pub('prices.v1', 'a', 1);
    await flush();
    expect(views(iso, 'prices.v1')).toHaveLength(1);
  });

  it('wakes a suspended isolate on a record on a topic it watched', async () => {
    const woken: [string, string][] = [];
    const engine = new TsEngine();
    const broker = new Broker({
      contracts: contracts(prices),
      engine,
      onWake: (id, t) => woken.push([id, t]),
    });
    const iso = connect(broker, 'H', all);
    await iso.call('watch', { topic: 'prices.v1' });
    broker.detach('H', true, { wake: true });
    await broker.publish({ kind: 'host' }, 'prices.v1', 'a', 1);
    expect(woken).toEqual([['H', 'prices.v1']]);
  });
});
