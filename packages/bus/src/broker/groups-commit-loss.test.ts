/*
 * Consumer-group commits and redelivery: the loss found by the processor
 * example (isoloop/web#130, #211), fixed by the delivery `seq` in commits
 * (ADR 0016, points 10–14). See docs/investigations/group-commit-loss.md.
 */
import {
  createCommitter,
  deliveryPoints,
  type BusToIsolate,
  type Grants,
  type StartPosition,
} from '@isoloop/protocol';
import { describe, expect, it } from 'vitest';
import { connect, flush, type FakeIsolate } from '../../test/memory-port';
import { Broker } from './broker';
import { TsEngine } from '../engine/ts-engine';
import { contracts, topic, unchecked } from '../contracts/topic';

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
  const join = async (id: string, from: StartPosition, group = 'g') => {
    const iso = connect(broker, id, all);
    expect(await iso.call('subscribe', { topic: T, from, group })).toMatchObject({
      ok: true,
    });
    return iso;
  };
  return { broker, engine, publish, join };
}

type Deliver = Extract<BusToIsolate, { t: 'deliver' }>;

/**
 * A member that settles its records the way the bus client does: in the
 * order they arrived, through the shared committer, which sends only when
 * told to (`flush`), as its interval would.
 */
function member(iso: FakeIsolate) {
  const committer = createCommitter({
    send: (offsets) => iso.send({ v: 1, t: 'commits', p: { offsets } }),
    intervalMs: 1000,
  });
  const queue: { offset: number; value: unknown; at: { offset: number; seq: number } }[] = [];
  let read = 0;
  let highest = -1;
  /** Takes in the deliveries that reached the isolate since the last call. */
  const receive = (): void => {
    const delivers = iso.inbox.filter((m): m is Deliver => m.t === 'deliver');
    for (const d of delivers.slice(read)) {
      const offsets = d.p.records.map((r) => r.offset);
      const points = deliveryPoints(d.p.seq, offsets, highest);
      highest = points.at(-1)?.offset ?? highest;
      d.p.records.forEach((r, i) => {
        const at = points[i];
        if (at) queue.push({ offset: r.offset, value: r.value, at });
      });
    }
    read = delivers.length;
  };
  return {
    committer,
    /** Runs the handler on the next `n` queued records. */
    handle(n: number): unknown[] {
      receive();
      const done = queue.splice(0, n);
      for (const r of done) committer.settle(T, r.at);
      return done.map((r) => r.value);
    },
    /** Values delivered and not handled yet. */
    waiting(): unknown[] {
      receive();
      return queue.map((r) => r.value);
    },
  };
}

describe('consumer-group commits and redelivery (ADR 0016, points 10–13)', () => {
  it('a commit sent before a redelivered record arrived does not cover it (the crossing)', async () => {
    const { broker, engine, publish, join } = setup();
    const a = await join('A', 'committed');
    const b = await join('B', 'committed');
    publish(4); // round-robin: A gets 0 and 2, B gets 1 and 3
    await flush();
    expect(a.values(T)).toEqual([0, 2]);
    const handledUpTo = a.seq(T);
    expect(handledUpTo).toBe(1);

    // B leaves without committing: 1 and 3 are redelivered to A…
    await b.call('unsubscribe', { topic: T });
    await flush();
    expect(a.values(T)).toEqual([0, 2, 1, 3]);
    expect(a.seq(T)).toBe(2);
    // …while A's commit for what it had handled (0 and 2), sent before 1
    // and 3 reached it, is still on its way. It arrives after the broker
    // reassigned 1 to A, but its seq is that of the delivery before.
    await a.call('commits', { offsets: [{ topic: T, offset: 2, seq: handledUpTo }] });
    expect(engine.committed(T, 'group:g')).toBe(0);

    // A is stopped before it gets to 1 (a balancer move, say).
    broker.detach('A', true);

    // The group resumes from its committed offset: 1 comes back (and 2
    // again, as the group's offset stops before the first uncommitted record).
    const c = await join('C', 'committed');
    await flush();
    expect(c.values(T)).toEqual([1, 2, 3]);
  });

  it('a commit sent after the redelivery arrived does not cover it either (in order)', async () => {
    const { broker, engine, publish, join } = setup();
    const a = await join('A', 'committed');
    const b = await join('B', 'committed');
    const m = member(a);
    publish(4);
    await flush();
    expect(m.handle(2)).toEqual([0, 2]);
    await b.call('unsubscribe', { topic: T });
    await flush();
    expect(m.waiting()).toEqual([1, 3]);
    // The interval ends while 1 is still waiting in A's queue.
    m.committer.flush();
    await flush();
    expect(engine.committed(T, 'group:g')).toBe(0);

    broker.detach('A', true);
    const c = await join('C', 'committed');
    await flush();
    // 2 comes again too: the group's offset moves only past a run of
    // committed records (at least once).
    expect(c.values(T)).toEqual([1, 2, 3]);
  });

  it('records of a partly handled redelivery are covered as they are settled (point 17)', async () => {
    const { engine, publish, join } = setup();
    const a = await join('A', 'committed');
    const b = await join('B', 'committed');
    const m = member(a);
    publish(4);
    await flush();
    m.handle(2);
    await b.call('unsubscribe', { topic: T });
    await flush();
    expect(m.handle(1)).toEqual([1]);
    m.committer.flush();
    await flush();
    expect(engine.committed(T, 'group:g')).toBe(2);
    expect(m.handle(1)).toEqual([3]);
    m.committer.flush();
    await flush();
    expect(engine.committed(T, 'group:g')).toBe(3);
  });

  it('a member stopped right after a redelivery loses nothing', async () => {
    const { broker, publish, join } = setup();
    const a = await join('A', 'committed');
    const b = await join('B', 'committed');
    const m = member(a);
    publish(6); // A: 0, 2, 4; B: 1, 3, 5
    await flush();
    expect(m.handle(3)).toEqual([0, 2, 4]);
    await b.call('unsubscribe', { topic: T });
    await flush();
    // A is stopped at once: its shutdown sends what it settled and waits.
    const offsets = m.committer.take();
    expect(offsets).toEqual([{ topic: T, offset: 4, seq: 1 }]);
    await a.call('commits', { offsets });
    broker.detach('A', true);

    const c = await join('C', 'committed');
    await flush();
    expect(c.values(T)).toEqual(expect.arrayContaining([1, 3, 5]));
  });

  it('a member that crashes partway through a delivery keeps what it settled (M3j)', async () => {
    const { broker, engine, publish, join } = setup();
    const a = await join('A', 'committed');
    const m = member(a);
    publish(3);
    await flush();
    // One delivery of three: a member that fell behind gets its records batched.
    expect(a.seq(T)).toBe(1);
    expect(m.handle(1)).toEqual([0]);
    m.committer.flush();
    await flush();
    expect(engine.committed(T, 'group:g')).toBe(0);

    // It crashes on the next record (a corrupt file) before settling it.
    broker.detach('A', true);
    const c = await join('C', 'committed');
    await flush();
    expect(c.values(T)).toEqual([1, 2]);
  });

  it('a partly settled delivery never covers a record redelivered after it', async () => {
    const { broker, engine, publish, join } = setup();
    const a = await join('A', 'committed');
    const b = await join('B', 'committed');
    const m = member(a);
    publish(6); // A: 0, 2, 4 in one delivery; B: 1, 3, 5
    await flush();
    expect(m.handle(2)).toEqual([0, 2]);
    // B leaves: 1, 3 and 5 are redelivered to A, in a later delivery.
    await b.call('unsubscribe', { topic: T });
    await flush();
    m.committer.flush();
    await flush();
    // 0 and 2 are covered, 1 isn't (and the group's offset stops before it).
    expect(engine.committed(T, 'group:g')).toBe(0);
    broker.detach('A', true);
    const c = await join('C', 'committed');
    await flush();
    // 2 comes again: the group's offset moves only past a run of committed records.
    expect(c.values(T)).toEqual([1, 2, 3, 4, 5]);
  });

  it('own subscriptions keep the offset rule: seq never changes what a commit covers', async () => {
    const { broker, engine, publish } = setup();
    const a = connect(broker, 'A', all);
    await a.call('subscribe', { topic: T, from: 'earliest' });
    publish(3);
    await flush();
    publish(3);
    await flush();
    expect(a.seq(T)).toBe(2);
    // Offset 4 is in delivery 2; even a seq of 0 covers through it.
    await a.call('commits', { offsets: [{ topic: T, offset: 4, seq: 0 }] });
    expect(engine.committed(T, 'A')).toBe(4);
    broker.detach('A', true);
    const again = connect(broker, 'A', all);
    await again.call('subscribe', { topic: T, from: 'committed' });
    expect(again.values(T)).toEqual([5]);
  });
});

describe('a group resumes from its committed offset whatever `from` says (ADR 0016, point 14)', () => {
  it.each(['earliest', 'latest', 'committed'] as const)(
    'a group that empties and rejoins with `%s` resumes after its committed offset',
    async (from) => {
      const { broker, publish, join } = setup();
      const a = await join('A', 'earliest');
      publish(4);
      await flush();
      await a.call('commits', { offsets: [{ topic: T, offset: 1, seq: a.seq(T) }] });
      broker.detach('A', true);
      publish(1);
      const again = await join('A2', from);
      await flush();
      expect(again.values(T)).toEqual([2, 3, 4]);
    },
  );

  it('a new group with `earliest` starts at the tail', async () => {
    const { publish, join } = setup();
    publish(3);
    await flush();
    const a = await join('A', 'earliest', 'fresh');
    expect(a.values(T)).toEqual([0, 1, 2]);
  });

  it('a group that never committed starts at its `from` when it rejoins', async () => {
    const { broker, publish, join } = setup();
    await join('A', 'earliest');
    publish(2);
    await flush();
    broker.detach('A', true);
    const again = await join('A2', 'earliest');
    expect(again.values(T)).toEqual([0, 1]);
  });

  it('a member joining a group that has members takes records from where the group is', async () => {
    const { publish, join } = setup();
    const a = await join('A', 'latest');
    publish(2);
    await flush();
    const b = await join('B', 'earliest');
    expect(b.values(T)).toEqual([]);
    publish(2);
    await flush();
    expect(new Set([...a.values(T), ...b.values(T)])).toEqual(new Set([0, 1, 2, 3]));
    expect(a.values(T).length + b.values(T).length).toBe(4);
  });
});
