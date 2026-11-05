import type { BusRecord, Grants } from '@isoloop/protocol';
import { describe, expect, it } from 'vitest';
import { connect, flush } from '../test/memory-port';
import { Broker } from './broker';
import { TsEngine } from './engine/ts-engine';
import { contracts, topic, unchecked } from './topic';

const all: Grants = { publish: ['*'], subscribe: ['*'] };
const T = 'jobs.v1';

function setup(inboxLimit = 1000) {
  const t = topic(T, { schema: unchecked<number>(), retention: { kind: 'last-n', n: 10_000 } });
  const engine = new TsEngine();
  const broker = new Broker({ contracts: contracts(t), engine, inboxLimit });
  let next = 0;
  /** Publishes `n` records in one task; `key(i)` picks each record's key. */
  const publish = (n: number, key?: (i: number) => string) => {
    for (let i = 0; i < n; i++) {
      const v = next++;
      void broker.publish({ kind: 'host' }, T, key?.(v), v);
    }
  };
  const join = async (id: string, group = 'g', from: 'earliest' | 'committed' = 'earliest') => {
    const iso = connect(broker, id, all);
    expect(await iso.call('subscribe', { topic: T, from, group })).toMatchObject({ ok: true });
    return iso;
  };
  return { broker, engine, publish, join };
}

const byKey = (records: BusRecord[]) => {
  const m = new Map<string | undefined, number[]>();
  for (const r of records) m.set(r.key, [...(m.get(r.key) ?? []), Number(r.value)]);
  return m;
};

const ascending = (xs: number[]): boolean => xs.every((x, i) => i === 0 || (xs[i - 1] ?? x) < x);

/** True if `xs` holds each of 0…n−1 exactly once. */
const exactlyOnce = (xs: number[], n: number): boolean =>
  xs.length === n && new Set(xs).size === n && xs.every((x) => x >= 0 && x < n);

describe('consumer groups', () => {
  it('two members split a keyed stream, each key to one member, in order', async () => {
    const { publish, join } = setup();
    const a = await join('A');
    const b = await join('B');
    publish(200, (i) => `k${i % 10}`);
    await flush();
    const ra = a.records(T);
    const rb = b.records(T);
    expect(ra.length).toBeGreaterThan(0);
    expect(rb.length).toBeGreaterThan(0);
    expect(
      exactlyOnce(
        [...ra, ...rb].map((r) => Number(r.value)),
        200,
      ),
    ).toBe(true);
    const ka = byKey(ra);
    const kb = byKey(rb);
    for (const k of ka.keys()) expect(kb.has(k)).toBe(false);
    for (const values of [...ka.values(), ...kb.values()]) expect(ascending(values)).toBe(true);
  });

  it('sends keyless records round-robin', async () => {
    const { publish, join } = setup();
    const a = await join('A');
    const b = await join('B');
    publish(10);
    await flush();
    expect([a.values(T).length, b.values(T).length]).toEqual([5, 5]);
  });

  it('a member that leaves hands its uncommitted records and its keys to the others', async () => {
    const { publish, join } = setup();
    const a = await join('A');
    const b = await join('B');
    publish(40, (i) => `k${i % 4}`);
    await flush();
    const bGot = b.values(T);
    expect(bGot.length).toBeGreaterThan(0);
    await b.call('unsubscribe', { topic: T }); // B commits nothing
    publish(8, (i) => `k${i % 4}`);
    await flush();
    // A now gets B's 20-odd uncommitted records again, then every new record.
    const aGot = a.values(T).map(Number);
    expect(exactlyOnce(aGot, 48)).toBe(true);
    expect(aGot.slice(-8)).toEqual([40, 41, 42, 43, 44, 45, 46, 47]);
  });

  it('a new member takes a share of new records', async () => {
    const { publish, join } = setup();
    const a = await join('A');
    publish(4);
    await flush();
    const b = await join('B');
    publish(4);
    await flush();
    expect([a.values(T).length, b.values(T).length]).toEqual([6, 2]);
  });

  it('moves the group offset only past records every member has committed', async () => {
    const { engine, publish, join } = setup();
    const a = await join('A');
    const b = await join('B');
    publish(10); // round-robin: A gets 0, 2, 4…; B gets 1, 3, 5…
    await flush();
    await a.call('commit', { topic: T, offset: 8 });
    expect(engine.committed(T, 'group:g')).toBe(0);
    await b.call('commit', { topic: T, offset: 5 });
    expect(engine.committed(T, 'group:g')).toBe(6);
    await b.call('commit', { topic: T, offset: 9 });
    expect(engine.committed(T, 'group:g')).toBe(9);
  });

  it('resumes from the group offset when the group comes back', async () => {
    const { broker, publish, join } = setup();
    const a = await join('A');
    publish(6);
    await flush();
    await a.call('commit', { topic: T, offset: 2 });
    broker.detach('A', true);
    const c = await join('C', 'g', 'committed');
    expect(c.values(T)).toEqual([3, 4, 5]);
  });

  it('waits for a member out of credit rather than reorder its keys', async () => {
    const { publish, join } = setup(2);
    const a = await join('A');
    const b = await join('B');
    publish(1, () => 'p');
    await flush();
    const [owner, other] = a.values(T).length === 1 ? [a, b] : [b, a];
    publish(3, () => 'p'); // the owner has 1 credit left
    publish(2); // keyless, queued behind the blocked 'p' records
    await flush();
    expect(owner.values(T)).toEqual([0, 1]);
    expect(other.values(T)).toEqual([]);
    await owner.call('commit', { topic: T, offset: 1 });
    expect(owner.values(T).slice(0, 4)).toEqual([0, 1, 2, 3]);
  });
});
