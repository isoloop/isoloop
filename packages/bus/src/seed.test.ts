import type { Grants } from '@isoloop/protocol';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { connect, flush } from '../test/memory-port';
import { Broker } from './broker';
import { TsEngine } from './engine/ts-engine';
import { SEED_BATCH } from './seed';
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
  const broker = new Broker({ contracts: contracts(...topics), engine, now: () => 5 });
  for (let i = 0; i < n; i++)
    engine.append(v1.name, { value: { sku: `s${i}` }, ts: 100 + i, producer: 'old' });
  return { broker, engine };
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

describe('seed in the contracts', () => {
  it('goes into the boot config as the source name and follow flag', () => {
    expect(topicConfig(v2).seed).toEqual({ from: v1.name, follow: false });
  });

  it('rejects a source the contracts don’t list, and cycles', () => {
    expect(() => contracts(v2)).toThrow(/seeds from cart.items.v1/);
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
