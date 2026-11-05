import { checks, systemSchema, systemTopic, type Grants } from '@isoloop/protocol';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { connect, fakeIsolate, flush } from '../test/memory-port';
import { Broker, type BrokerOptions } from './broker';
import { TsEngine } from './engine/ts-engine';
import type { StandardSchemaV1 } from './standard-schema';
import { contracts, topic, unchecked } from './topic';

const items = topic('cart.items.v1', {
  schema: z.object({ sku: z.string(), qty: z.number().int().default(1) }),
  retention: { kind: 'last-n', n: 100 },
});
const notes = topic('notes.v1', {
  schema: unchecked<string>(),
  retention: { kind: 'last-n', n: 3 },
});
const small = topic('small.v1', {
  schema: unchecked<string>(),
  retention: { kind: 'last-n', n: 10 },
  maxRecordBytes: 64,
});
const fns = topic('fns.v1', {
  schema: z.string().transform((s) => () => s),
  retention: { kind: 'last-n', n: 10 },
});
const route = systemTopic<{ href: string }>('isoloop.test.v1', {
  schema: systemSchema(checks.object({ href: checks.string })),
  retention: { kind: 'last-n', n: 1 },
});

const all: Grants = { publish: ['*'], subscribe: ['*'] };

function setup(extra: Partial<BrokerOptions> = {}) {
  let now = 1_000;
  const broker = new Broker({
    contracts: contracts(items, notes, small, fns, ...(extra.contracts?.topics ?? [])),
    engine: new TsEngine(),
    now: () => now,
    dev: true,
    systemTopics: [route],
    ...(extra.batchSize ? { batchSize: extra.batchSize } : {}),
  });
  return { broker, tick: (ms: number) => (now += ms) };
}

describe('publish pipeline', () => {
  it('appends, replies with the offset, and stamps producer and ts', async () => {
    const { broker } = setup();
    const a = connect(broker, 'A', all);
    expect(await a.call('publish', { topic: 'notes.v1', value: 'x' })).toEqual({
      ok: true,
      value: { offset: 0 },
    });
    expect(await a.call('publish', { topic: 'notes.v1', key: 'k', value: 'y' })).toMatchObject({
      value: { offset: 1 },
    });
    a.send({ v: 1, t: 'subscribe', p: { topic: 'notes.v1', from: 'earliest' } });
    await flush();
    expect(a.records('notes.v1')).toEqual([
      { offset: 0, value: 'x', ts: 1_000, producer: 'A' },
      { offset: 1, key: 'k', value: 'y', ts: 1_000, producer: 'A' },
    ]);
  });

  it.each([
    ['forbidden', 'no grant', { publish: [], subscribe: [] }, { topic: 'notes.v1', value: 'x' }],
    [
      'forbidden',
      'a system topic, whatever the grants',
      all,
      { topic: 'isoloop.test.v1', value: { href: '/' } },
    ],
    ['unknown_topic', 'an unknown topic', all, { topic: 'nope.v1', value: 1 }],
    [
      'too_large',
      'a record over maxRecordBytes',
      all,
      { topic: 'small.v1', value: 'x'.repeat(100) },
    ],
    ['invalid', 'a schema failure', all, { topic: 'cart.items.v1', value: { sku: 1 } }],
    ['invalid', 'a non-string key', all, { topic: 'notes.v1', key: 7, value: 'x' }],
    [
      'not_encodable',
      'an output that cannot be cloned (dev)',
      all,
      { topic: 'fns.v1', value: 'f' },
    ],
  ])('rejects with %s: %s', async (code, _, grants, p) => {
    const { broker } = setup();
    const a = connect(broker, 'A', grants);
    const watcher = connect(broker, 'W', all);
    watcher.send({ v: 1, t: 'subscribe', p: { topic: p.topic, from: 'earliest' } });
    const r = await a.call('publish', p);
    expect(r).toMatchObject({ ok: false, error: { code } });
    expect(watcher.records(p.topic)).toEqual([]);
  });

  it('reports schema issues as { message, path }', async () => {
    const { broker } = setup();
    const a = connect(broker, 'A', all);
    const r = await a.call('publish', { topic: 'cart.items.v1', value: { sku: 1, qty: 'x' } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.issues?.map((i) => i.path)).toEqual([['sku'], ['qty']]);
    expect(r.error.issues?.every((i) => typeof i.message === 'string')).toBe(true);
  });

  it('treats a schema that throws as invalid', async () => {
    const boom: StandardSchemaV1<string> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => {
          throw new Error('boom');
        },
      },
    };
    const t = topic('boom.v1', { schema: boom, retention: { kind: 'last-n', n: 1 } });
    const { broker } = setup({ contracts: contracts(t) });
    const a = connect(broker, 'A', all);
    expect(await a.call('publish', { topic: 'boom.v1', value: 'x' })).toMatchObject({
      error: { code: 'invalid' },
    });
  });

  it('sends no result for a publish without an id', async () => {
    const { broker } = setup();
    const a = connect(broker, 'A', all);
    a.send({ v: 1, t: 'publish', p: { topic: 'notes.v1', value: 'ok' } });
    a.send({ v: 1, t: 'publish', p: { topic: 'nope.v1', value: 'bad' } });
    await flush();
    expect(a.inbox).toEqual([]);
  });

  it('stores the validated output, not the published value', async () => {
    const { broker } = setup();
    const a = connect(broker, 'A', all);
    a.send({ v: 1, t: 'subscribe', p: { topic: 'cart.items.v1', from: 'latest' } });
    await a.call('publish', { topic: 'cart.items.v1', value: { sku: 's', extra: true } });
    expect(a.values('cart.items.v1')).toEqual([{ sku: 's', qty: 1 }]);
  });

  it('keeps publish order per topic when an async schema is slow', async () => {
    const gates = new Map<string, () => void>();
    const slow: StandardSchemaV1<string> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (v) => {
          const value = String(v);
          if (value === 'fast') return { value };
          return new Promise<StandardSchemaV1.Result<string>>((resolve) => {
            gates.set(value, () =>
              resolve(value === 'bad' ? { issues: [{ message: 'no' }] } : { value }),
            );
          });
        },
      },
    };
    const t = topic('slow.v1', { schema: slow, retention: { kind: 'last-n', n: 10 } });
    const { broker } = setup({ contracts: contracts(t) });
    const a = connect(broker, 'A', all);
    a.send({ v: 1, t: 'subscribe', p: { topic: 'slow.v1', from: 'earliest' } });
    const results = ['slow', 'bad', 'fast', 'slow2'].map(async (value) =>
      a.call('publish', { topic: 'slow.v1', value }),
    );
    await flush();
    expect(a.values('slow.v1')).toEqual([]); // 'fast' waits behind 'slow'
    gates.get('slow2')?.();
    gates.get('bad')?.();
    await flush();
    expect(a.values('slow.v1')).toEqual([]);
    gates.get('slow')?.();
    expect(await Promise.all(results)).toEqual([
      { ok: true, value: { offset: 0 } },
      expect.objectContaining({ ok: false }),
      { ok: true, value: { offset: 1 } },
      { ok: true, value: { offset: 2 } },
    ]);
    expect(a.values('slow.v1')).toEqual(['slow', 'fast', 'slow2']);
  });

  it('lets the host publish app topics and the kernel only system topics', async () => {
    const { broker } = setup();
    const a = connect(broker, 'A', { publish: [], subscribe: ['notes.v1'] });
    a.send({ v: 1, t: 'subscribe', p: { topic: 'notes.v1', from: 'latest' } });
    a.send({ v: 1, t: 'subscribe', p: { topic: 'isoloop.test.v1', from: 'latest' } });
    expect(await broker.publish({ kind: 'host' }, 'notes.v1', undefined, 'hi')).toMatchObject({
      ok: true,
    });
    expect(
      await broker.publish({ kind: 'host' }, 'isoloop.test.v1', undefined, { href: '/' }),
    ).toMatchObject({
      error: { code: 'forbidden' },
    });
    expect(await broker.publish({ kind: 'kernel' }, 'notes.v1', undefined, 'x')).toMatchObject({
      error: { code: 'forbidden' },
    });
    expect(
      await broker.publish({ kind: 'kernel' }, 'isoloop.test.v1', undefined, { href: '/' }),
    ).toMatchObject({
      ok: true,
    });
    expect(a.records('notes.v1').map((r) => r.producer)).toEqual(['host']);
    expect(a.records('isoloop.test.v1').map((r) => [r.producer, r.value])).toEqual([
      ['kernel', { href: '/' }],
    ]);
  });
});

describe('malformed messages', () => {
  it('are dropped and counted', () => {
    const { broker } = setup();
    const a = connect(broker, 'A', all);
    a.send({ hello: 1 });
    a.send({ v: 2, t: 'publish', p: { topic: 'notes.v1', value: 'x' } });
    a.send({ v: 1, t: 'explode', p: {} });
    a.send({ v: 1, t: 'publish', p: { value: 'no topic' } });
    a.send({ v: 1, t: 'subscribe', p: null });
    expect(broker.dropped).toBe(5);
    expect(a.inbox).toEqual([]);
  });
});

const fill = async (broker: Broker, n: number) => {
  for (let i = 0; i < n; i++) {
    // oxlint-disable-next-line no-await-in-loop -- publish order is the point
    await broker.publish({ kind: 'host' }, 'notes.v1', undefined, `n${i}`);
  }
  await flush();
};

describe('subscriptions and start positions', () => {
  it('latest starts at head, earliest at the tail', async () => {
    const { broker } = setup();
    await fill(broker, 5); // last-n 3 → offsets 2..4 retained
    const a = connect(broker, 'A', all);
    expect(await a.call('subscribe', { topic: 'notes.v1', from: 'latest' })).toEqual({
      ok: true,
      value: { from: 5 },
    });
    const b = connect(broker, 'B', all);
    await b.call('subscribe', { topic: 'notes.v1', from: 'earliest' });
    expect(a.values('notes.v1')).toEqual([]);
    expect(b.values('notes.v1')).toEqual(['n2', 'n3', 'n4']);
    await fill(broker, 1);
    expect(a.values('notes.v1')).toEqual(['n0']);
  });

  it('committed falls back to earliest when there is no commit', async () => {
    const { broker } = setup();
    await fill(broker, 2);
    const a = connect(broker, 'A', all);
    await a.call('subscribe', { topic: 'notes.v1', from: 'committed' });
    expect(a.values('notes.v1')).toEqual(['n0', 'n1']);
  });

  it('rejects an unknown start position and an unknown topic', async () => {
    const { broker } = setup();
    const a = connect(broker, 'A', all);
    expect(await a.call('subscribe', { topic: 'notes.v1', from: 'middle' })).toMatchObject({
      error: { code: 'invalid' },
    });
    expect(await a.call('subscribe', { topic: 'nope.v1', from: 'latest' })).toMatchObject({
      error: { code: 'unknown_topic' },
    });
  });

  it('a second subscribe to the same topic replaces the first', async () => {
    const { broker } = setup();
    await fill(broker, 2);
    const a = connect(broker, 'A', all);
    await a.call('subscribe', { topic: 'notes.v1', from: 'earliest' });
    await a.call('subscribe', { topic: 'notes.v1', from: 'latest' });
    await fill(broker, 1);
    expect(a.values('notes.v1')).toEqual(['n0', 'n1', 'n0']);
  });

  it('unsubscribe stops deliveries', async () => {
    const { broker } = setup();
    const a = connect(broker, 'A', all);
    await a.call('subscribe', { topic: 'notes.v1', from: 'latest' });
    await a.call('unsubscribe', { topic: 'notes.v1' });
    await fill(broker, 1);
    expect(a.values('notes.v1')).toEqual([]);
  });

  it('delivers in batches', async () => {
    const t = topic('many.v1', {
      schema: unchecked<number>(),
      retention: { kind: 'last-n', n: 1000 },
    });
    const { broker } = setup({ contracts: contracts(t), batchSize: 4 });
    await Promise.all(
      Array.from({ length: 10 }, async (_, i) =>
        broker.publish({ kind: 'host' }, 'many.v1', undefined, i),
      ),
    );
    const a = connect(broker, 'A', all);
    await a.call('subscribe', { topic: 'many.v1', from: 'earliest' });
    const sizes = a.inbox.flatMap((m) => (m.t === 'deliver' ? [m.p.records.length] : []));
    expect(sizes).toEqual([4, 4, 2]);
  });
});

describe('commits', () => {
  it('rejects commits for topics not subscribed, past head, or malformed', async () => {
    const { broker } = setup();
    const a = connect(broker, 'A', all);
    expect(await a.call('commit', { topic: 'notes.v1', offset: 0 })).toMatchObject({
      error: { code: 'forbidden' },
    });
    await a.call('subscribe', { topic: 'notes.v1', from: 'latest' });
    expect(await a.call('commit', { topic: 'notes.v1', offset: 0 })).toMatchObject({
      error: { code: 'invalid' },
    });
    await broker.publish({ kind: 'host' }, 'notes.v1', undefined, 'x');
    expect(await a.call('commit', { topic: 'notes.v1', offset: -1 })).toMatchObject({
      error: { code: 'invalid' },
    });
    expect(await a.call('commit', { topic: 'notes.v1', offset: 0 })).toEqual({
      ok: true,
      value: null,
    });
  });
});

describe('I4: an isolate only publishes and receives granted topics', () => {
  it('needs a subscribe grant, matched by pattern', async () => {
    const { broker } = setup();
    const a = connect(broker, 'A', { publish: [], subscribe: ['cart.*'] });
    expect(await a.call('subscribe', { topic: 'notes.v1', from: 'earliest' })).toMatchObject({
      error: { code: 'forbidden' },
    });
    expect(await a.call('subscribe', { topic: 'cart.items.v1', from: 'earliest' })).toMatchObject({
      ok: true,
    });
    await broker.publish({ kind: 'host' }, 'notes.v1', undefined, 'secret');
    await broker.publish({ kind: 'host' }, 'cart.items.v1', undefined, { sku: 's' });
    expect(
      a.inbox.filter((m) => m.t === 'deliver').map((m) => m.t === 'deliver' && m.p.topic),
    ).toEqual(['cart.items.v1']);
  });

  it('needs a publish grant, matched by pattern', async () => {
    const { broker } = setup();
    const a = connect(broker, 'A', { publish: ['cart.*'], subscribe: [] });
    expect(await a.call('publish', { topic: 'cart.items.v1', value: { sku: 's' } })).toMatchObject({
      ok: true,
    });
    expect(await a.call('publish', { topic: 'notes.v1', value: 'x' })).toMatchObject({
      error: { code: 'forbidden' },
    });
  });

  it('may subscribe to system topics without a grant, never publish them', async () => {
    const { broker } = setup();
    const a = connect(broker, 'A', { publish: ['*', 'isoloop.*'], subscribe: [] });
    expect(await a.call('subscribe', { topic: 'isoloop.test.v1', from: 'latest' })).toMatchObject({
      ok: true,
    });
    expect(
      await a.call('publish', { topic: 'isoloop.test.v1', value: { href: '/' } }),
    ).toMatchObject({
      error: { code: 'forbidden' },
    });
  });
});

describe('I6: a restarted isolate resumes after its last commit', () => {
  it('sees every record after the commit exactly once, including those published while it was down', async () => {
    const t = topic('log.v1', {
      schema: unchecked<number>(),
      retention: { kind: 'last-n', n: 1000 },
    });
    const { broker } = setup({ contracts: contracts(t) });
    const pub = (i: number) => broker.publish({ kind: 'host' }, 'log.v1', undefined, i);
    for (const i of [0, 1, 2, 3]) await pub(i); // oxlint-disable-line no-await-in-loop

    const c1 = connect(broker, 'C', all);
    await c1.call('subscribe', { topic: 'log.v1', from: 'committed' });
    expect(c1.values('log.v1')).toEqual([0, 1, 2, 3]);
    await c1.call('commit', { topic: 'log.v1', offset: 1 }); // handled 0 and 1, crashed before 2

    broker.detach('C', true);
    expect(c1.closed).toBe(true);
    for (const i of [4, 5]) await pub(i); // oxlint-disable-line no-await-in-loop

    const c2 = connect(broker, 'C', all);
    await c2.call('subscribe', { topic: 'log.v1', from: 'committed' });
    expect(c2.values('log.v1')).toEqual([2, 3, 4, 5]);
    await pub(6);
    expect(c2.values('log.v1')).toEqual([2, 3, 4, 5, 6]);
    expect(c1.values('log.v1')).toEqual([0, 1, 2, 3]); // the old port gets nothing more
  });

  it('keeps offsets per isolate', async () => {
    const t = topic('log.v1', {
      schema: unchecked<number>(),
      retention: { kind: 'last-n', n: 1000 },
    });
    const { broker } = setup({ contracts: contracts(t) });
    for (const i of [0, 1, 2]) await broker.publish({ kind: 'host' }, 'log.v1', undefined, i); // oxlint-disable-line no-await-in-loop
    const a = connect(broker, 'A', all);
    const b = connect(broker, 'B', all);
    await a.call('subscribe', { topic: 'log.v1', from: 'earliest' });
    await b.call('subscribe', { topic: 'log.v1', from: 'earliest' });
    await a.call('commit', { topic: 'log.v1', offset: 2 });
    await b.call('commit', { topic: 'log.v1', offset: 0 });
    broker.detach('A', true);
    broker.detach('B', true);
    const a2 = connect(broker, 'A', all);
    const b2 = connect(broker, 'B', all);
    await a2.call('subscribe', { topic: 'log.v1', from: 'committed' });
    await b2.call('subscribe', { topic: 'log.v1', from: 'committed' });
    expect([a2.values('log.v1'), b2.values('log.v1')]).toEqual([[], [1, 2]]);
  });

  it('detach without keepOffsets forgets them', async () => {
    const t = topic('log.v1', {
      schema: unchecked<number>(),
      retention: { kind: 'last-n', n: 1000 },
    });
    const { broker } = setup({ contracts: contracts(t) });
    for (const i of [0, 1]) await broker.publish({ kind: 'host' }, 'log.v1', undefined, i); // oxlint-disable-line no-await-in-loop
    const a = connect(broker, 'A', all);
    await a.call('subscribe', { topic: 'log.v1', from: 'earliest' });
    await a.call('commit', { topic: 'log.v1', offset: 1 });
    broker.detach('A', false);
    const a2 = connect(broker, 'A', all);
    await a2.call('subscribe', { topic: 'log.v1', from: 'committed' });
    expect(a2.values('log.v1')).toEqual([0, 1]);
  });

  it('ignores messages from a replaced port', async () => {
    const { broker } = setup();
    const old = connect(broker, 'A', all);
    const fresh = connect(broker, 'A', all);
    expect(old.closed).toBe(true);
    old.send({ v: 1, t: 'publish', p: { topic: 'notes.v1', value: 'ghost' } });
    await fresh.call('subscribe', { topic: 'notes.v1', from: 'earliest' });
    expect(fresh.values('notes.v1')).toEqual([]);
  });
});

describe('reattach after a bus restart (ADR 0007)', () => {
  it('answers the first subscribe to each memory topic with one reset', async () => {
    const { broker } = setup();
    const d = fakeIsolate('D');
    broker.attach('D', all, d.port, { reattach: true });
    await d.call('subscribe', { topic: 'notes.v1', from: 'committed' });
    await d.call('subscribe', { topic: 'notes.v1', from: 'committed' });
    await d.call('subscribe', { topic: 'cart.items.v1', from: 'committed' });
    const resets = d.inbox.filter((m) => m.t === 'reset').map((m) => m.p);
    expect(resets).toEqual([
      { topic: 'notes.v1', reason: 'bus_restart' },
      { topic: 'cart.items.v1', reason: 'bus_restart' },
    ]);
    // The reset comes before the subscribe's result.
    expect(d.inbox[0]?.t).toBe('reset');
  });

  it('sends no reset on a first attach, or for a durable topic', async () => {
    const { broker } = setup();
    const a = connect(broker, 'A', all);
    await a.call('subscribe', { topic: 'notes.v1', from: 'earliest' });
    expect(a.inbox.some((m) => m.t === 'reset')).toBe(false);

    const durable = new Broker({
      contracts: contracts(notes),
      engine: new TsEngine(),
      durable: (t) => t === 'notes.v1',
    });
    const d = fakeIsolate('D');
    durable.attach('D', all, d.port, { reattach: true });
    await d.call('subscribe', { topic: 'notes.v1', from: 'committed' });
    expect(d.inbox.some((m) => m.t === 'reset')).toBe(false);
  });
});

describe('isoloop.route.v1 (ADR 0002)', () => {
  it('is built in: a `*` publish grant still gets forbidden; the kernel publishes; anyone subscribes', async () => {
    const broker = new Broker({ contracts: contracts(notes), engine: new TsEngine() });
    const a = connect(broker, 'A', { publish: ['*'], subscribe: [] });
    const value = {
      href: 'http://x/',
      pathname: '/',
      path: '/',
      search: '',
      hash: '',
      state: null,
    };
    expect(await a.call('publish', { topic: 'isoloop.route.v1', value })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(
      await a.call('subscribe', { topic: 'isoloop.route.v1', from: 'earliest' }),
    ).toMatchObject({ ok: true });
    expect(
      await broker.publish({ kind: 'kernel' }, 'isoloop.route.v1', 'current', value),
    ).toMatchObject({ ok: true });
    expect(
      await broker.publish({ kind: 'kernel' }, 'isoloop.route.v1', 'current', { href: 1 }),
    ).toMatchObject({ ok: false, error: { code: 'invalid' } });
    await flush();
    expect(a.values('isoloop.route.v1')).toEqual([value]);
  });
});

const wakeSetup = () => {
  const woken: [string, string][] = [];
  const broker = new Broker({
    contracts: contracts(notes, items),
    engine: new TsEngine(),
    onWake: (id, t) => woken.push([id, t]),
  });
  return { broker, woken };
};

describe('wake for suspended isolates (ADR 0001)', () => {
  it('wakes once on the first record for a subscribed topic, not for others', async () => {
    const { broker, woken } = wakeSetup();
    const h = connect(broker, 'H', all);
    await h.call('subscribe', { topic: 'notes.v1', from: 'latest' });
    broker.detach('H', true, { wake: true });
    const p = connect(broker, 'P', all);
    await p.call('publish', { topic: 'cart.items.v1', value: { sku: 'x' } });
    expect(woken).toEqual([]);
    await p.call('publish', { topic: 'notes.v1', value: 'a' });
    await p.call('publish', { topic: 'notes.v1', value: 'b' });
    expect(woken).toEqual([['H', 'notes.v1']]);
  });

  it('a plain detach or a new attach forgets the sleeper', async () => {
    const { broker, woken } = wakeSetup();
    const h = connect(broker, 'H', all);
    await h.call('subscribe', { topic: 'notes.v1', from: 'latest' });
    broker.detach('H', true, { wake: true });
    broker.detach('H', true);
    const p = connect(broker, 'P', all);
    await p.call('publish', { topic: 'notes.v1', value: 'a' });
    expect(woken).toEqual([]);
  });

  it('in a group, only the last member to leave sleeps on the topic', async () => {
    const { broker, woken } = wakeSetup();
    const x = connect(broker, 'X', all);
    const y = connect(broker, 'Y', all);
    await x.call('subscribe', { topic: 'notes.v1', from: 'latest', group: 'g' });
    await y.call('subscribe', { topic: 'notes.v1', from: 'latest', group: 'g' });
    broker.detach('X', true, { wake: true });
    const p = connect(broker, 'P', all);
    await p.call('publish', { topic: 'notes.v1', value: 'a' });
    expect(woken).toEqual([]);
    expect(y.values('notes.v1')).toEqual(['a']);
    broker.detach('Y', true, { wake: true });
    await p.call('publish', { topic: 'notes.v1', value: 'b' });
    expect(woken).toEqual([['Y', 'notes.v1']]);
  });
});
