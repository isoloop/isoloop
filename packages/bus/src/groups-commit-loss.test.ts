/*
 * Repro for the consumer-group commit loss found by the processor example
 * (isoloop/web#130). See docs/investigations/group-commit-loss.md.
 */
import type { Grants } from '@isoloop/protocol';
import { describe, expect, it } from 'vitest';
import { connect, flush } from '../test/memory-port';
import { Broker } from './broker';
import { TsEngine } from './engine/ts-engine';
import { contracts, topic, unchecked } from './topic';

const all: Grants = { publish: ['*'], subscribe: ['*'] };
const T = 'jobs.v1';

function setup() {
  const t = topic(T, { schema: unchecked<number>(), retention: { kind: 'last-n', n: 10_000 } });
  const engine = new TsEngine();
  const broker = new Broker({ contracts: contracts(t), engine });
  let next = 0;
  const publish = (n: number) => {
    for (let i = 0; i < n; i++) void broker.publish({ kind: 'host' }, T, undefined, next++);
  };
  const join = async (id: string, from: 'earliest' | 'committed') => {
    const iso = connect(broker, id, all);
    expect(await iso.call('subscribe', { topic: T, from, group: 'g' })).toMatchObject({
      ok: true,
    });
    return iso;
  };
  return { broker, engine, publish, join };
}

describe('consumer-group commits and redelivery', () => {
  // Fails today: a commit that crosses a redelivery covers the redelivered
  // record, so the bus treats it as done and never hands it out again.
  it.fails('a commit sent before a redelivered record arrived does not cover it', async () => {
    const { broker, engine, publish, join } = setup();
    const a = await join('A', 'committed');
    const b = await join('B', 'committed');
    publish(4); // round-robin: A gets 0 and 2, B gets 1 and 3
    await flush();
    expect(a.values(T)).toEqual([0, 2]);

    // B leaves without committing: 1 and 3 are redelivered to A…
    await b.call('unsubscribe', { topic: T });
    await flush();
    // …while A's commit for what it had processed (0 and 2), sent before 1
    // and 3 reached it, is still on its way. It arrives after the broker
    // reassigned 1 to A, and as a cumulative commit it covers 1.
    await a.call('commits', { offsets: [{ topic: T, offset: 2 }] });
    expect(engine.committed(T, 'group:g')).toBe(2);

    // A is stopped before it gets to 1 (a balancer move, say).
    broker.detach('A', true);

    // The group resumes from its committed offset: 1 should come back.
    const c = await join('C', 'committed');
    await flush();
    expect(c.values(T)).toContain(1);
  });

  // Documented, not a bug: when every member has left, the group's position
  // is only its committed offset, and `earliest` means the topic's tail.
  it('a group rejoined with `earliest` after all members left starts at the tail', async () => {
    const { broker, publish, join } = setup();
    const a = await join('A', 'earliest');
    publish(4);
    await flush();
    await a.call('commits', { offsets: [{ topic: T, offset: 3 }] });
    broker.detach('A', true);
    const again = await join('A2', 'earliest');
    await flush();
    expect(again.values(T)).toEqual([0, 1, 2, 3]);
    broker.detach('A2', true);
    const resumed = await join('A3', 'committed');
    await flush();
    expect(resumed.values(T)).toEqual([]);
  });
});
