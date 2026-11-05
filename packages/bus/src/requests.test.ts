import type { BusRecord, Grants } from '@isoloop/protocol';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { connect, flush, type FakeIsolate } from '../test/memory-port';
import { Broker } from './broker';
import { TsEngine } from './engine/ts-engine';
import { contracts, topic, unchecked } from './topic';

const all: Grants = { publish: ['*'], subscribe: ['*'] };

const price = topic('price.lookup.v1', {
  schema: z.object({ sku: z.string() }),
  reply: z.object({ cents: z.coerce.number().int() }),
  retention: { kind: 'last-n', n: 100 },
});
const plain = topic('plain.v1', {
  schema: unchecked<string>(),
  retention: { kind: 'last-n', n: 10 },
});

function setup() {
  const timers: { fn: () => void; ms: number }[] = [];
  const broker = new Broker({
    contracts: contracts(price, plain),
    engine: new TsEngine(),
    timers: { set: (fn, ms) => void timers.push({ fn, ms }) },
  });
  /** Fires every pending timer, as if they all ran out. */
  const expire = () => {
    for (const t of timers.splice(0)) t.fn();
  };
  return { broker, timers, expire };
}

/** Sends a request and returns a probe for the result with its id, if any. */
function request(iso: FakeIsolate, p: Record<string, unknown>, id = 'r1') {
  iso.send({ v: 1, t: 'request', id, p: { topic: price.name, timeoutMs: 5_000, ...p } });
  return () => iso.inbox.flatMap((m) => (m.t === 'result' && m.re === id ? [m.p] : []));
}

const reply = (iso: FakeIsolate, rec: BusRecord | undefined, value: unknown) =>
  iso.call('reply', { topic: price.name, offset: rec?.offset ?? -1, value });

async function wired() {
  const s = setup();
  const caller = connect(s.broker, 'C', all);
  const responder = connect(s.broker, 'R', all);
  await responder.call('subscribe', { topic: price.name, from: 'latest' });
  return { ...s, caller, responder };
}

describe('request/response', () => {
  it('delivers the request with req set and routes the validated reply to the caller', async () => {
    const { caller, responder, timers } = await wired();
    const answer = request(caller, { value: { sku: 's1' } });
    await flush();
    const rec = responder.records(price.name)[0];
    expect(rec).toMatchObject({
      value: { sku: 's1' },
      producer: 'C',
      req: { from: 'C', id: 'r1' },
    });
    expect(timers.map((t) => t.ms)).toEqual([5_000]);
    expect(await reply(responder, rec, { cents: '250' })).toEqual({
      ok: true,
      value: { delivered: true },
    });
    expect(answer()).toEqual([{ ok: true, value: { cents: 250 } }]); // the reply schema's output
  });

  it('rejects a request on a topic without a reply schema with not_requestable', async () => {
    const { caller } = await wired();
    const answer = request(caller, { topic: plain.name, value: 'x' });
    await flush();
    expect(answer()).toMatchObject([{ ok: false, error: { code: 'not_requestable' } }]);
  });

  it('runs the request through the publish pipeline', async () => {
    const { broker, responder } = await wired();
    const noGrant = connect(broker, 'N', { publish: [], subscribe: [] });
    const denied = request(noGrant, { value: { sku: 's' } });
    const caller = connect(broker, 'C', all);
    const invalid = request(caller, { value: { sku: 1 } }, 'r2');
    await flush();
    expect(denied()).toMatchObject([{ error: { code: 'forbidden' } }]);
    expect(invalid()).toMatchObject([{ error: { code: 'invalid' } }]);
    expect(responder.records(price.name)).toEqual([]);
  });

  it('drops a request without an id', async () => {
    const { broker, caller, responder } = await wired();
    caller.send({
      v: 1,
      t: 'request',
      p: { topic: price.name, value: { sku: 's' }, timeoutMs: 1 },
    });
    await flush();
    expect(broker.dropped).toBe(1);
    expect(responder.records(price.name)).toEqual([]);
  });

  it('times out cleanly: the caller hears nothing, a late reply gets timeout', async () => {
    const { caller, responder, expire } = await wired();
    const answer = request(caller, { value: { sku: 's' } });
    await flush();
    expire();
    const rec = responder.records(price.name)[0];
    expect(await reply(responder, rec, { cents: 1 })).toMatchObject({ error: { code: 'timeout' } });
    expect(answer()).toEqual([]);
  });

  it('drops a reply to a caller that has gone', async () => {
    const { broker, caller, responder } = await wired();
    const answer = request(caller, { value: { sku: 's' } });
    await flush();
    broker.detach('C', true);
    const rec = responder.records(price.name)[0];
    expect(await reply(responder, rec, { cents: 1 })).toEqual({
      ok: true,
      value: { delivered: false },
    });
    expect(answer()).toEqual([]);
  });

  it('an invalid reply rejects the responder with invalid and the caller with reply_invalid', async () => {
    const { caller, responder } = await wired();
    const answer = request(caller, { value: { sku: 's' } });
    await flush();
    const rec = responder.records(price.name)[0];
    const r = await reply(responder, rec, { cents: 'lots' });
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(answer()).toMatchObject([
      { ok: false, error: { code: 'reply_invalid', issues: [{ path: ['cents'] }] } },
    ]);
    expect(await reply(responder, rec, { cents: 1 })).toMatchObject({
      error: { code: 'already_replied' },
    });
  });

  it('the first valid reply wins; a second gets already_replied', async () => {
    const { broker, caller, responder } = await wired();
    const second = connect(broker, 'R2', all);
    await second.call('subscribe', { topic: price.name, from: 'latest' });
    const answer = request(caller, { value: { sku: 's' } });
    await flush();
    const rec = responder.records(price.name)[0];
    expect(await reply(responder, rec, { cents: 1 })).toMatchObject({ ok: true });
    expect(await reply(second, second.records(price.name)[0], { cents: 2 })).toMatchObject({
      error: { code: 'already_replied' },
    });
    expect(answer()).toEqual([{ ok: true, value: { cents: 1 } }]);
  });

  it('only an isolate the request was delivered to may reply', async () => {
    const { broker, caller, responder } = await wired();
    const bystander = connect(broker, 'B', all); // has the grant, never got the record
    request(caller, { value: { sku: 's' } });
    await flush();
    const rec = responder.records(price.name)[0];
    expect(await reply(bystander, rec, { cents: 1 })).toMatchObject({
      error: { code: 'forbidden' },
    });
  });

  it('in a group, only the member that got the request may reply', async () => {
    const { broker } = setup();
    const caller = connect(broker, 'C', all);
    const a = connect(broker, 'A', all);
    const b = connect(broker, 'B', all);
    await a.call('subscribe', { topic: price.name, from: 'latest', group: 'pricing' });
    await b.call('subscribe', { topic: price.name, from: 'latest', group: 'pricing' });
    request(caller, { value: { sku: 's' } });
    await flush();
    const [got, missed] = a.records(price.name).length === 1 ? [a, b] : [b, a];
    const rec = got.records(price.name)[0];
    expect(await reply(missed, rec, { cents: 1 })).toMatchObject({ error: { code: 'forbidden' } });
    expect(await reply(got, rec, { cents: 1 })).toMatchObject({ ok: true });
  });

  it('a reply to a record that is not a request is invalid', async () => {
    const { broker, responder } = await wired();
    await broker.publish({ kind: 'host' }, price.name, undefined, { sku: 's' });
    await flush();
    const rec = responder.records(price.name)[0];
    expect(await reply(responder, rec, { cents: 1 })).toMatchObject({ error: { code: 'invalid' } });
    expect(await responder.call('reply', { topic: plain.name, offset: 0, value: 1 })).toMatchObject(
      {
        error: { code: 'not_requestable' },
      },
    );
  });
});
