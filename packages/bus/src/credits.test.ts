import type { Grants, Retention } from '@isoloop/protocol';
import { describe, expect, it } from 'vitest';
import { connect, flush, type FakeIsolate } from '../test/memory-port';
import { Broker } from './broker';
import { TsEngine } from './engine/ts-engine';
import { contracts, topic, unchecked } from './topic';

const all: Grants = { publish: ['*'], subscribe: ['*'] };

function setup(retention: Retention, opts: { inboxLimit: number; batchSize?: number }) {
  const t = topic('t.v1', { schema: unchecked<number>(), retention });
  const broker = new Broker({ contracts: contracts(t), engine: new TsEngine(), ...opts });
  let next = 0;
  /** Publishes `n` records in one task, without awaiting. */
  const publish = (n: number) => {
    for (let i = 0; i < n; i++) void broker.publish({ kind: 'host' }, 't.v1', undefined, next++);
  };
  return { broker, publish };
}

const batches = (iso: FakeIsolate) => iso.inbox.flatMap((m) => (m.t === 'deliver' ? [m.p] : []));

const commit = (iso: FakeIsolate, offset: number) =>
  iso.call('commits', { offsets: [{ topic: 't.v1', offset }] });

describe('credits and backpressure', () => {
  it('a consumer that never commits gets exactly the inbox limit, then nothing', async () => {
    const { broker, publish } = setup(
      { kind: 'last-n', n: 1000 },
      { inboxLimit: 10, batchSize: 4 },
    );
    const a = connect(broker, 'A', all);
    await a.call('subscribe', { topic: 't.v1', from: 'earliest' });
    publish(25);
    await flush();
    expect(a.values('t.v1')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(batches(a).map((b) => b.records.length)).toEqual([4, 4, 2]);
    publish(5);
    await flush();
    expect(a.values('t.v1')).toHaveLength(10);
  });

  it('after committing it gets the rest, in order', async () => {
    const { broker, publish } = setup({ kind: 'last-n', n: 1000 }, { inboxLimit: 10 });
    const a = connect(broker, 'A', all);
    await a.call('subscribe', { topic: 't.v1', from: 'earliest' });
    publish(25);
    await flush();
    await commit(a, 3); // frees 4 credits
    expect(a.values('t.v1')).toEqual(Array.from({ length: 14 }, (_, i) => i));
    await commit(a, 13);
    await commit(a, 23);
    expect(a.values('t.v1')).toEqual(Array.from({ length: 25 }, (_, i) => i));
    publish(1);
    await flush();
    expect(a.values('t.v1').at(-1)).toBe(25);
  });

  it('only delivered records count towards credit', async () => {
    const { broker, publish } = setup({ kind: 'last-n', n: 1000 }, { inboxLimit: 5 });
    publish(10);
    const a = connect(broker, 'A', all);
    await a.call('subscribe', { topic: 't.v1', from: 'latest' }); // starts at 10
    publish(3);
    await flush();
    await commit(a, 2); // offsets 0–2 were never delivered to A: no credit back
    await commit(a, 11);
    publish(5);
    await flush();
    // 5 credit − 3 delivered + 2 freed (10, 11) = 4 more
    expect(a.values('t.v1')).toEqual([10, 11, 12, 13, 14, 15, 16]);
  });

  it('coalesces records published in one task into one deliver', async () => {
    const { broker, publish } = setup({ kind: 'last-n', n: 1000 }, { inboxLimit: 1000 });
    const a = connect(broker, 'A', all);
    await a.call('subscribe', { topic: 't.v1', from: 'latest' });
    publish(5);
    await flush();
    expect(batches(a).map((b) => b.records.length)).toEqual([5]);
  });

  it('sends the subscribe result before the first deliver', async () => {
    const { broker, publish } = setup({ kind: 'last-n', n: 1000 }, { inboxLimit: 1000 });
    publish(2);
    const a = connect(broker, 'A', all);
    await a.call('subscribe', { topic: 't.v1', from: 'earliest' });
    expect(a.inbox.map((m) => m.t)).toEqual(['result', 'deliver']);
  });

  it('a paused consumer on a last-n topic gets a gap for the records that expired', async () => {
    const { broker, publish } = setup({ kind: 'last-n', n: 10 }, { inboxLimit: 5 });
    const a = connect(broker, 'A', all);
    await a.call('subscribe', { topic: 't.v1', from: 'earliest' });
    publish(5); // A gets 0–4 and pauses
    await flush();
    publish(25); // the log keeps 20–29
    await flush();
    expect(a.values('t.v1')).toEqual([0, 1, 2, 3, 4]);
    await commit(a, 4);
    const resumed = batches(a).at(-1);
    expect(resumed?.gap).toEqual({ from: 5, to: 19 });
    expect(resumed?.records.map((r) => r.offset)).toEqual([20, 21, 22, 23, 24]);
  });

  it('reports a gap with no records when nothing is left to deliver', async () => {
    let now = 0;
    const t = topic('t.v1', { schema: unchecked<number>(), retention: { kind: 'time', ms: 10 } });
    const engine = new TsEngine({ now: () => now });
    const broker = new Broker({ contracts: contracts(t), engine, now: () => now, inboxLimit: 2 });
    const a = connect(broker, 'A', all);
    await a.call('subscribe', { topic: 't.v1', from: 'earliest' });
    for (let i = 0; i < 4; i++) void broker.publish({ kind: 'host' }, 't.v1', undefined, i);
    await flush();
    now = 100;
    engine.compact('t.v1');
    await commit(a, 1);
    expect(batches(a).at(-1)).toEqual({ topic: 't.v1', records: [], gap: { from: 2, to: 3 } });
  });

  it('a restart from a commit older than the tail gets a gap', async () => {
    const { broker, publish } = setup({ kind: 'last-n', n: 5 }, { inboxLimit: 100 });
    const a = connect(broker, 'A', all);
    await a.call('subscribe', { topic: 't.v1', from: 'earliest' });
    publish(3);
    await flush();
    await commit(a, 0);
    broker.detach('A', true);
    publish(10); // offsets 3–12; the log keeps 8–12
    const a2 = connect(broker, 'A', all);
    await a2.call('subscribe', { topic: 't.v1', from: 'committed' });
    expect(batches(a2)[0]?.gap).toEqual({ from: 1, to: 7 });
    expect(a2.values('t.v1')).toEqual([8, 9, 10, 11, 12]);
  });

  it('compaction is not a gap', async () => {
    const t = topic('c.v1', { schema: unchecked<number>(), retention: { kind: 'compacted' } });
    const engine = new TsEngine();
    const broker = new Broker({ contracts: contracts(t), engine, inboxLimit: 1 });
    const a = connect(broker, 'A', all);
    await a.call('subscribe', { topic: 'c.v1', from: 'earliest' });
    for (let i = 0; i < 4; i++) void broker.publish({ kind: 'host' }, 'c.v1', 'k', i);
    await flush();
    engine.compact('c.v1'); // keeps only offset 3
    await a.call('commits', { offsets: [{ topic: 'c.v1', offset: 0 }] });
    const last = batches(a).at(-1);
    expect(last).not.toHaveProperty('gap');
    expect(a.values('c.v1')).toEqual([0, 3]);
  });

  it('a new subscription starts with full credit', async () => {
    const { broker, publish } = setup({ kind: 'last-n', n: 1000 }, { inboxLimit: 3 });
    const a = connect(broker, 'A', all);
    await a.call('subscribe', { topic: 't.v1', from: 'earliest' });
    publish(10);
    await flush();
    await a.call('subscribe', { topic: 't.v1', from: 'latest' });
    publish(3);
    await flush();
    expect(a.values('t.v1')).toEqual([0, 1, 2, 10, 11, 12]);
  });
});
