import type { Grants } from '@isoloop/protocol';
import { describe, expect, it } from 'vitest';
import { connect, flush, type FakeIsolate } from '../../test/memory-port';
import { TsEngine } from '../engine/ts-engine';
import { contracts, topic, unchecked } from '../contracts/topic';
import { Broker } from './broker';

const prices = topic('prices.v1', {
  schema: unchecked<number>(),
  retention: { kind: 'last-n', n: 1_000 },
});
const quiet = topic('quiet.v1', {
  schema: unchecked<number>(),
  retention: { kind: 'last-n', n: 10 },
});

const all: Grants = { publish: ['*'], subscribe: ['*'] };

function setup() {
  const broker = new Broker({
    contracts: contracts(prices, quiet),
    engine: new TsEngine(),
    timers: { set: () => {} },
  });
  const pub = (t: string, key: string, value: number) =>
    broker.publish({ kind: 'host' }, t, key, value);
  const watchStats = (t: string) => broker.stats().watches.find((w) => w.topic === t);
  return { broker, pub, watchStats };
}

/** Sends `seen` for the last view `iso` got on `t`. */
async function seenLast(iso: FakeIsolate, t: string): Promise<void> {
  const v = iso.inbox.flatMap((m) => (m.t === 'view' && m.p.topic === t ? [m.p] : [])).at(-1);
  if (!v) return;
  iso.send({ v: 1, t: 'commits', p: { offsets: [], seen: [{ topic: t, vseq: v.vseq }] } });
  await flush();
}

describe('watch stats (ADR 0023, point 25)', () => {
  it('lists no topic before its first watch', async () => {
    const { pub, watchStats } = setup();
    await pub('prices.v1', 'a', 1);
    expect(watchStats('prices.v1')).toBeUndefined();
  });

  it('counts watches and the distinct keys they hold', async () => {
    const { broker, pub, watchStats } = setup();
    await pub('prices.v1', 'a', 1);
    await pub('prices.v1', 'b', 2);
    await pub('prices.v1', 'c', 3);
    const a = connect(broker, 'A', all);
    const b = connect(broker, 'B', all);
    await a.call('watch', { topic: 'prices.v1', keys: ['a', 'b'] });
    await b.call('watch', { topic: 'prices.v1', keys: ['b', 'c'] });
    expect(watchStats('prices.v1')).toMatchObject({ watches: 2, liveKeys: 3 });
  });

  it("leaves a snapshot's values out of the ratio", async () => {
    const { broker, pub, watchStats } = setup();
    await Promise.all(Array.from({ length: 5 }, (_, i) => pub('prices.v1', `k${i}`, i)));
    const a = connect(broker, 'A', all);
    await a.call('watch', { topic: 'prices.v1' });
    expect(watchStats('prices.v1')).toMatchObject({ records: 0, values: 0, liveKeys: 5 });
  });

  it('counts records per watch and the newest value per view: 1 of every 10', async () => {
    const { broker, pub, watchStats } = setup();
    const a = connect(broker, 'A', all);
    await a.call('watch', { topic: 'prices.v1' });
    // The empty snapshot is in flight: ten records on one key make one value.
    await Promise.all(Array.from({ length: 10 }, (_, i) => pub('prices.v1', 'a', i)));
    await seenLast(a, 'prices.v1');
    expect(watchStats('prices.v1')).toMatchObject({ records: 10, values: 1 });
  });

  it('counts a record once for every watch on the topic', async () => {
    const { broker, pub, watchStats } = setup();
    const a = connect(broker, 'A', all);
    const b = connect(broker, 'B', all);
    await a.call('watch', { topic: 'prices.v1' });
    await b.call('watch', { topic: 'prices.v1' });
    await pub('prices.v1', 'a', 1);
    expect(watchStats('prices.v1')?.records).toBe(2);
  });

  it('keeps the counts after the last watch leaves, with no watches now', async () => {
    const { broker, pub, watchStats } = setup();
    const a = connect(broker, 'A', all);
    await a.call('watch', { topic: 'quiet.v1' });
    await pub('quiet.v1', 'a', 1);
    await seenLast(a, 'quiet.v1');
    await a.call('unwatch', { topic: 'quiet.v1' });
    expect(watchStats('quiet.v1')).toMatchObject({ watches: 0, liveKeys: 0, records: 1 });
  });
});
