import type { Grants } from '@isoloop/protocol';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { connect, flush } from '../test/memory-port';
import { Broker } from './broker';
import { TsEngine } from './engine/ts-engine';
import type { SeedEvent } from '@isoloop/protocol';
import { SEED_BATCH, SEED_DONE, SEED_FROM, SEED_HEAD, SEED_REJECTED } from './seed';
import { contracts, topic, topicConfig, unchecked, type AnyTopicDef } from './topic';

const all: Grants = { publish: ['*'], subscribe: ['*'] };

const v1 = topic('cart.items.v1', {
  schema: unchecked<{ sku: string }>(),
  retention: { kind: 'last-n', n: 100_000 },
});
const v2 = topic('cart.items.v2', {
  schema: z.object({ sku: z.string(), qty: z.number() }),
  retention: { kind: 'last-n', n: 100_000 },
  seed: { from: v1, map: (v: { sku: string }) => ({ sku: v.sku, qty: 1 }) },
});
const other = topic('notes.v1', {
  schema: unchecked<string>(),
  retention: { kind: 'last-n', n: 10 },
});

/** A broker whose engine already holds `n` v1 records, as if restored from disk. */
function setup(n: number, topics: AnyTopicDef[] = [v1, v2, other]) {
  const engine = new TsEngine();
  const events: SeedEvent[] = [];
  const broker = new Broker({
    contracts: contracts(...topics),
    engine,
    now: () => 5,
    onSeed: (e) => events.push(e),
  });
  for (let i = 0; i < n; i++)
    engine.append(v1.name, { value: { sku: `s${i}` }, ts: 100 + i, producer: 'old' });
  return { broker, engine, events };
}

describe('seeding: state and buffering', () => {
  it('copies v1 through map and v2’s schema, keeping ts and producer', async () => {
    const { broker } = setup(3);
    await broker.seed();
    const a = connect(broker, 'A', all);
    a.send({ v: 1, t: 'subscribe', p: { topic: v2.name, from: 'earliest' } });
    await flush();
    expect(a.records(v2.name)).toEqual([
      { offset: 0, value: { sku: 's0', qty: 1 }, ts: 100, producer: 'old' },
      { offset: 1, value: { sku: 's1', qty: 1 }, ts: 101, producer: 'old' },
      { offset: 2, value: { sku: 's2', qty: 1 }, ts: 102, producer: 'old' },
    ]);
  });

  it('v2 publishes during the seed land after the history; v2 subscribers get nothing until it ends', async () => {
    const n = SEED_BATCH * 3; // several batches, under the 1,000-record inbox credit
    const { broker } = setup(n);
    const seeded = broker.seed();
    const a = connect(broker, 'A', all);
    const sub = a.call('subscribe', { topic: v2.name, from: 'earliest' });
    let acked = false;
    const pub = a.call('publish', { topic: v2.name, value: { sku: 'new', qty: 2 } }).then((r) => {
      acked = true;
      return r;
    });
    await flush();
    // Still seeding: nothing delivered, the publish waits.
    expect(a.records(v2.name)).toEqual([]);
    expect(acked).toBe(false);
    await seeded;
    expect(await pub).toEqual({ ok: true, value: { offset: n } });
    expect(await sub).toMatchObject({ ok: true, value: { from: 0 } });
    await flush();
    const got = a.values(v2.name);
    expect(got).toHaveLength(n + 1);
    expect(got.at(0)).toEqual({ sku: 's0', qty: 1 });
    expect(got.at(-1)).toEqual({ sku: 'new', qty: 2 });
  });

  it('other topics don’t wait for the seed', async () => {
    const { broker } = setup(SEED_BATCH * 4);
    const seeded = broker.seed();
    const a = connect(broker, 'A', all);
    expect(await a.call('publish', { topic: other.name, value: 'x' })).toEqual({
      ok: true,
      value: { offset: 0 },
    });
    a.send({ v: 1, t: 'subscribe', p: { topic: other.name, from: 'earliest' } });
    await flush();
    expect(a.values(other.name)).toEqual(['x']);
    await seeded;
  });

  it('does nothing when v1 is empty or v2 already has records', async () => {
    const empty = setup(0);
    await empty.broker.seed();
    expect(empty.engine.head(v2.name)).toBe(0);

    const { broker, engine } = setup(2);
    engine.append(v2.name, { value: { sku: 'mine', qty: 9 }, ts: 1, producer: 'p' });
    await broker.seed();
    expect(engine.head(v2.name)).toBe(1);
  });

  it('a subscribe that is unsubscribed before the seed ends is answered and dropped', async () => {
    const { broker } = setup(SEED_BATCH * 4);
    const seeded = broker.seed();
    const a = connect(broker, 'A', all);
    const sub = a.call('subscribe', { topic: v2.name, from: 'earliest' });
    expect(await a.call('unsubscribe', { topic: v2.name })).toEqual({ ok: true, value: null });
    expect(await sub).toMatchObject({ ok: false, error: { code: 'invalid' } });
    await seeded;
    await flush();
    expect(a.records(v2.name)).toEqual([]);
  });

  it('seeds chain: v3 from v2 from v1, in order', async () => {
    const v3 = topic('cart.items.v3', {
      schema: unchecked<{ sku: string; qty: number; v: 3 }>(),
      retention: { kind: 'last-n', n: 100_000 },
      seed: { from: v2, map: (v: { sku: string; qty: number }) => ({ ...v, v: 3 as const }) },
    });
    const { broker, engine } = setup(2, [v3, v1, v2]);
    await broker.seed();
    expect(engine.read(v3.name, 0, 10).map((r) => r.value)).toEqual([
      { sku: 's0', qty: 1, v: 3 },
      { sku: 's1', qty: 1, v: 3 },
    ]);
  });
});

describe('seeding: exactly once, rejects and progress', () => {
  it('resumes after the saved progress, without appending again what a cut-short seed already wrote', async () => {
    const { broker, engine } = setup(10);
    // A first run mapped v1 0..6, but saved progress only up to v1 offset 4 (v2 head 5).
    for (let i = 0; i < 7; i++)
      engine.append(v2.name, { value: { sku: `s${i}`, qty: 1 }, ts: 100 + i, producer: 'old' });
    engine.commit(v2.name, SEED_FROM, 4);
    engine.commit(v2.name, SEED_HEAD, 5);
    await broker.seed();
    expect(engine.read(v2.name, 0, 100).map((r) => r.value)).toEqual(
      Array.from({ length: 10 }, (_, i) => ({ sku: `s${i}`, qty: 1 })),
    );
    expect(engine.committed(v2.name, SEED_DONE)).toBe(10);
  });

  it('skips and reports what map throws on, returns a promise for, or v2 rejects; v2 still opens', async () => {
    const picky = topic('picky.v2', {
      schema: z.object({ sku: z.string().startsWith('s') }),
      retention: { kind: 'last-n', n: 100 },
      seed: {
        from: v1,
        map: (v: { sku: string }, r) => {
          if (r.offset === 1) throw new Error('boom');
          // A promise that also looks like the value: still `seed_async`.
          if (r.offset === 2) return Object.assign(Promise.resolve(v), { sku: v.sku });
          return r.offset === 3 ? { sku: 'x' } : v;
        },
      },
    });
    const { broker, engine, events } = setup(5, [v1, picky]);
    await broker.seed();
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'rejected',
        topic: 'picky.v2',
        from: v1.name,
        offset: 1,
        code: 'invalid',
      }),
      expect.objectContaining({ kind: 'rejected', offset: 2, code: 'seed_async' }),
      expect.objectContaining({ kind: 'rejected', offset: 3, code: 'invalid' }),
      { kind: 'seeded', topic: 'picky.v2', copied: 2, rejected: 3 },
    ]);
    expect(engine.read('picky.v2', 0, 10).map((r) => r.value)).toEqual([
      { sku: 's0' },
      { sku: 's4' },
    ]);
    // The rejected records stay in v1.
    expect(engine.head(v1.name)).toBe(5);
    const a = connect(broker, 'A', all);
    expect(await a.call('publish', { topic: 'picky.v2', value: { sku: 'sNew' } })).toEqual({
      ok: true,
      value: { offset: 2 },
    });
  });

  it('reports at most 10 rejects a second, and counts them all in bus:seeded', async () => {
    const strict = topic('strict.v2', {
      schema: z.never(),
      retention: { kind: 'last-n', n: 100 },
      seed: { from: v1, map: (v: unknown) => v },
    });
    const { broker, events } = setup(30, [v1, strict]);
    await broker.seed();
    expect(events.filter((e) => e.kind === 'rejected')).toHaveLength(10);
    expect(events.at(-1)).toEqual({ kind: 'seeded', topic: 'strict.v2', copied: 0, rejected: 30 });
  });

  it('a seed that ended doesn’t run again, even with new v1 records', async () => {
    const { broker, engine } = setup(2);
    await broker.seed();
    engine.append(v1.name, { value: { sku: 'late' }, ts: 1, producer: 'p' });
    await broker.seed();
    expect(engine.head(v2.name)).toBe(2);
  });
});

describe('follow, unlisted sources and dropTopic', () => {
  const following = topic('cart.items.v2', {
    schema: z.object({ sku: z.string(), qty: z.number() }),
    retention: { kind: 'last-n', n: 100 },
    seed: { from: v1, follow: true, map: (v: { sku: string }) => ({ sku: v.sku, qty: 1 }) },
  });

  it('with follow, a v1 publish after the seed reaches v2, keeping its ts and producer', async () => {
    const { broker, engine, events } = setup(2, [v1, following]);
    await broker.seed();
    const a = connect(broker, 'A', all);
    await a.call('publish', { topic: v1.name, value: { sku: 'late' } });
    await a.call('publish', { topic: v1.name, value: { sku: 7 } }); // v2 rejects it
    await flush();
    expect(engine.read(following.name, 0, 10).map((r) => [r.value, r.producer, r.ts])).toEqual([
      [{ sku: 's0', qty: 1 }, 'old', 100],
      [{ sku: 's1', qty: 1 }, 'old', 101],
      [{ sku: 'late', qty: 1 }, 'A', 5],
    ]);
    expect(events.at(-1)).toMatchObject({ kind: 'rejected', topic: following.name, offset: 3 });
  });

  it('without a seed to run (memory topics), follow forwards from the start', async () => {
    const { broker, engine } = setup(0, [v1, following]);
    const a = connect(broker, 'A', all);
    await a.call('publish', { topic: v1.name, value: { sku: 'x' } });
    await flush();
    expect(engine.read(following.name, 0, 10).map((r) => r.value)).toEqual([{ sku: 'x', qty: 1 }]);
  });

  it('seeds from a source the contracts no longer list; isolates can’t reach it', async () => {
    const engine = new TsEngine();
    const broker = new Broker({ contracts: contracts(v2), engine });
    engine.append(v1.name, { value: { sku: 'old' }, ts: 1, producer: 'p' });
    await broker.seed();
    expect(engine.read(v2.name, 0, 10).map((r) => r.value)).toEqual([{ sku: 'old', qty: 1 }]);
    const a = connect(broker, 'A', all);
    expect(await a.call('publish', { topic: v1.name, value: { sku: 'x' } })).toMatchObject({
      ok: false,
      error: { code: 'unknown_topic' },
    });
    expect(broker.seedSources).toEqual([v1.name]);
  });

  it('dropTopic refuses a listed topic, one a pending seed reads, and rejected records unless forced', () => {
    const engine = new TsEngine();
    const broker = new Broker({ contracts: contracts(v2), engine });
    expect(broker.dropRefusal(v2.name, false)).toMatchObject({ error: { code: 'invalid' } });
    engine.commit(v2.name, SEED_FROM, 3);
    expect(broker.dropRefusal(v1.name, false)).toMatchObject({ error: { code: 'seed_pending' } });
    engine.commit(v2.name, SEED_DONE, 10);
    expect(broker.dropRefusal(v1.name, false)).toBeUndefined();
    engine.commit(v2.name, SEED_REJECTED, 2);
    expect(broker.dropRefusal(v1.name, false)).toMatchObject({ error: { code: 'invalid' } });
    expect(broker.dropRefusal(v1.name, true)).toBeUndefined();
  });
});

describe('seed in the contracts', () => {
  it('goes into the boot config as the source name and follow flag', () => {
    expect(topicConfig(v2).seed).toEqual({ from: v1.name, follow: false });
  });

  it('takes a source the contracts don’t list, and rejects cycles', () => {
    expect(() => contracts(v2)).not.toThrow();
    let first: AnyTopicDef | undefined;
    const second = topic('b.v1', {
      schema: unchecked(),
      retention: { kind: 'last-n', n: 1 },
      seed: {
        get from(): AnyTopicDef {
          if (!first) throw new Error('not built yet');
          return first;
        },
        map: (x: unknown) => x,
      },
    });
    first = topic('a.v1', {
      schema: unchecked(),
      retention: { kind: 'last-n', n: 1 },
      seed: { from: second, map: (x: unknown) => x },
    });
    const both = [first, second];
    expect(() => contracts(...both)).toThrow(/cycle/);
  });
});
