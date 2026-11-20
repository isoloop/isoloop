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

describe('host requests (kernel.request, ADR 0018)', () => {
  it('appends req { from: host, id, via } and answers the host with the validated reply', async () => {
    const { broker, responder, timers } = await wired();
    const got: unknown[] = [];
    broker.request(
      price.name,
      undefined,
      { sku: 'h' },
      { id: 'h1', timeoutMs: 10_000, via: 'mcp' },
      (r) => got.push(r),
    );
    await flush();
    const rec = responder.records(price.name)[0];
    expect(rec).toMatchObject({ producer: 'host', req: { from: 'host', id: 'h1', via: 'mcp' } });
    expect(timers.map((t) => t.ms)).toEqual([10_000]);
    expect(await reply(responder, rec, { cents: 7 })).toEqual({
      ok: true,
      value: { delivered: true },
    });
    // A second reply is refused, and the host hears only the first.
    expect(await reply(responder, rec, { cents: 8 })).toMatchObject({
      error: { code: 'already_replied' },
    });
    expect(got).toEqual([{ ok: true, value: { cents: 7 } }]);
  });

  it('leaves via off when the host sets none, and an isolate request never carries one', async () => {
    const { broker, caller, responder } = await wired();
    broker.request(price.name, undefined, { sku: 'a' }, { id: 'h1', timeoutMs: 1000 }, () => {});
    request(caller, { value: { sku: 'b' }, via: 'webmcp' });
    await flush();
    const [host, iso] = responder.records(price.name);
    expect(host?.req).toEqual({ from: 'host', id: 'h1' });
    expect(iso?.req).toEqual({ from: 'C', id: 'r1' });
  });

  it('answers the host with the failure when the record is refused', async () => {
    const { broker } = await wired();
    const got: unknown[] = [];
    broker.request(price.name, undefined, { sku: 1 }, { id: 'h1', timeoutMs: 1000 }, (r) =>
      got.push(r),
    );
    broker.request(plain.name, undefined, 'x', { id: 'h2', timeoutMs: 1000 }, (r) => got.push(r));
    broker.request('isoloop.route.v1', undefined, {}, { id: 'h3', timeoutMs: 1000 }, (r) =>
      got.push(r),
    );
    await flush();
    expect(got).toMatchObject([
      { error: { code: 'invalid' } },
      { error: { code: 'not_requestable' } },
      { error: { code: 'forbidden' } },
    ]);
  });
});

// isoloop#288: a burst of requests larger than what the topic keeps.
describe('a burst of requests past the retention', () => {
  const wide = topic('price.wide.v1', {
    schema: z.object({ sku: z.string() }),
    reply: z.object({ cents: z.number() }),
    retention: { kind: 'last-n', n: 2_000 },
  });

  /**
   * Sends `n` requests at once, then answers each delivered one and commits
   * them, round after round, like a responder whose commits land after its
   * replies. `held` records are delivered and left uncommitted first, as a
   * responder's commit window would leave them. Returns what was delivered,
   * what the callers got, and the gaps the responder was told about.
   */
  async function burst(opts: { n: number; on: typeof price; inboxLimit?: number; held?: number }) {
    const timers: { fn: () => void; ms: number }[] = [];
    const broker = new Broker({
      contracts: contracts(price, plain, wide),
      engine: new TsEngine(),
      timers: { set: (fn, ms) => void timers.push({ fn, ms }) },
      ...(opts.inboxLimit === undefined ? {} : { inboxLimit: opts.inboxLimit }),
    });
    const caller = connect(broker, 'C', all);
    const responder = connect(broker, 'R', all);
    await responder.call('subscribe', { topic: opts.on.name, from: 'latest' });
    const send = (i: number) =>
      caller.send({
        v: 1,
        t: 'request',
        id: `r${i}`,
        p: { topic: opts.on.name, value: { sku: `s${i}` }, timeoutMs: 10_000 },
      });
    let i = 0;
    for (; i < (opts.held ?? 0); i++) send(i);
    await flush();
    for (let j = 0; j < opts.n; j++, i++) send(i);
    await flush();
    const droppedBeforeTimeout = caller.inbox.filter(
      (m) => m.t === 'result' && !m.p.ok && m.p.error.code === 'dropped',
    ).length;
    let answered = 0;
    for (let round = 0; round < 50; round++) {
      const recs = responder.records(opts.on.name).slice(answered);
      if (recs.length === 0) break;
      // oxlint-disable-next-line no-await-in-loop -- each round reads what the last one freed
      await Promise.all(
        recs.map((r) =>
          responder.call('reply', { topic: opts.on.name, offset: r.offset, value: { cents: 1 } }),
        ),
      );
      answered += recs.length;
      const last = recs.at(-1)!;
      // oxlint-disable-next-line no-await-in-loop -- the commit frees credit for the next round
      await responder.call('commits', {
        offsets: [{ topic: opts.on.name, offset: last.offset, seq: responder.seq(opts.on.name) }],
      });
    }
    for (const t of timers.splice(0)) t.fn();
    const results = caller.inbox.flatMap((m) =>
      m.t === 'result' && m.re?.startsWith('r') ? [m.p] : [],
    );
    const gaps = responder.inbox.flatMap((m) => (m.t === 'deliver' && m.p.gap ? [m.p.gap] : []));
    return {
      delivered: answered,
      replied: results.filter((r) => r.ok).length,
      timedOut: results.filter((r) => !r.ok && r.error.code === 'timeout').length,
      dropped: results.filter((r) => !r.ok && r.error.code === 'dropped').length,
      droppedBeforeTimeout,
      gaps,
    };
  }

  it('answers every call when the burst fits the credit (control)', async () => {
    expect(await burst({ n: 50, on: price })).toMatchObject({
      delivered: 50,
      replied: 50,
      timedOut: 0,
    });
  });

  // isoloop#288, ADR 0018 decision 5: requests appended past the retention
  // before the responder is handed them leave the log; their callers get
  // `dropped` at once instead of waiting out the timeout.
  it('answers what fits a topic keeping 100 and drops the rest of a 1,000 burst at once', async () => {
    const r = await burst({ n: 1_000, on: price });
    expect(r).toMatchObject({ replied: 100, dropped: 900, droppedBeforeTimeout: 900, timedOut: 0 });
  });

  it('drops only undelivered requests when 300 delivered ones are still uncommitted', async () => {
    const r = await burst({ n: 1_000, held: 300, on: price });
    expect(r.timedOut).toBe(0);
    expect(r.replied + r.dropped).toBe(1_300);
    expect(r.droppedBeforeTimeout).toBe(r.dropped);
    expect(r.replied).toBe(r.delivered); // every delivered request is answered
  });

  it("answers a dropped caller with the ADR's message, the same for any requester", async () => {
    const { broker } = setup();
    const caller = connect(broker, 'C', all); // nobody subscribed: nothing is delivered
    for (let i = 0; i < 101; i++) request(caller, { value: { sku: `s${i}` } }, `d${i}`);
    await flush();
    const first = caller.inbox.find((m) => m.t === 'result' && m.re === 'd0');
    expect(first?.p).toEqual({
      ok: false,
      error: {
        code: 'dropped',
        message:
          "the request was dropped: the topic's retention was full; retry or raise retention",
      },
    });
    expect(caller.inbox.filter((m) => m.t === 'result' && !m.p.ok)).toHaveLength(1);
  });

  it('answers the same burst on a topic keeping 2,000', async () => {
    expect(await burst({ n: 1_000, held: 300, on: wide })).toMatchObject({
      replied: 1_300,
      timedOut: 0,
    });
  });
});
