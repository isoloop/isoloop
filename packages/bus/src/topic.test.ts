import { SYSTEM_TOPICS, checks, systemSchema, systemTopic, type TopicRef } from '@isoloop/protocol';
import * as v from 'valibot';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { testContracts } from './testing';
import {
  ContractsError,
  contracts,
  isContracts,
  isUnchecked,
  topic,
  topicConfig,
  unchecked,
  type AnyTopicDef,
  type InputOf,
  type OutputOf,
  type ReplyInputOf,
  type ReplyOutputOf,
  type TopicDef,
} from './index';
import { toIssues, type StandardSchemaV1 } from './standard-schema';

const validate = async <O>(s: StandardSchemaV1<unknown, O>, value: unknown) =>
  s['~standard'].validate(value);

const last10 = { kind: 'last-n', n: 10 } as const;

describe('schemas through the Standard Schema interface', () => {
  const zodItem = topic('cart.zod.v1', {
    schema: z.object({ sku: z.string(), qty: z.number().int().default(1) }),
    retention: last10,
  });
  const valibotItem = topic('cart.valibot.v1', {
    schema: v.object({ sku: v.string(), qty: v.optional(v.number(), 1) }),
    retention: last10,
  });

  it.each([
    ['Zod 4', zodItem],
    ['Valibot', valibotItem],
  ] as const)('%s accepts a valid value and returns its output', async (_, t) => {
    const r = await validate(t.schema, { sku: 'a' });
    expect(r.issues).toBeUndefined();
    expect(r).toMatchObject({ value: { sku: 'a', qty: 1 } });
  });

  it.each([
    ['Zod 4', zodItem],
    ['Valibot', valibotItem],
  ] as const)('%s rejects with issues that map to { message, path }', async (_, t) => {
    const r = await validate(t.schema, { sku: 1 });
    expect(r.issues).toBeDefined();
    const issues = toIssues(r.issues ?? []);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(['sku']);
    expect(typeof issues[0]?.message).toBe('string');
    expect(structuredClone(issues)).toEqual(issues);
  });

  it('types publishers with the input and subscribers with the output', () => {
    type In = InputOf<typeof zodItem>;
    type Out = OutputOf<typeof zodItem>;
    // A `.default()` field is optional to publish and present to subscribers.
    expectTypeOf<In>().toEqualTypeOf<{ sku: string; qty?: number | undefined }>();
    expectTypeOf<Out>().toEqualTypeOf<{ sku: string; qty: number }>();
    expectTypeOf(zodItem).toExtend<TopicDef<In, Out>>();
  });

  it('types replies from the reply schema', () => {
    const lookup = topic('price.lookup.v1', {
      schema: z.object({ sku: z.string() }),
      reply: z.object({ price: z.coerce.number() }),
      retention: last10,
    });
    expectTypeOf<ReplyInputOf<typeof lookup>>().toEqualTypeOf<{ price: unknown }>();
    expectTypeOf<ReplyOutputOf<typeof lookup>>().toEqualTypeOf<{ price: number }>();
    expectTypeOf<ReplyInputOf<typeof zodItem>>().toBeNever();
  });

  it("fits protocol's TopicRef, which host and runtime take, with the same types", () => {
    type RefIn<T> = T extends TopicRef<infer In, any, any, any> ? In : never;
    type RefOut<T> = T extends TopicRef<any, infer Out, any, any> ? Out : never;
    const u = topic('u.v1', { schema: unchecked<string>(), retention: last10 });
    expectTypeOf<RefIn<typeof zodItem>>().toEqualTypeOf<{
      sku: string;
      qty?: number | undefined;
    }>();
    expectTypeOf<RefOut<typeof zodItem>>().toEqualTypeOf<{ sku: string; qty: number }>();
    expectTypeOf<RefOut<typeof u>>().toEqualTypeOf<string>();
  });
});

describe('unchecked', () => {
  it('accepts anything unchanged and only carries the type', async () => {
    const s = unchecked<{ n: number }>();
    const values = [undefined, null, 1, 'x', { any: 'thing' }, [1, 2]];
    const results = await Promise.all(values.map(async (x) => validate(s, x)));
    expect(results).toEqual(values.map((value) => ({ value })));
    expectTypeOf<StandardSchemaV1.InferOutput<typeof s>>().toEqualTypeOf<{ n: number }>();
  });

  it('is recognisable, so tools can list unchecked topics', () => {
    expect(isUnchecked(unchecked())).toBe(true);
    expect(isUnchecked(z.string())).toBe(false);
  });
});

describe('contracts()', () => {
  const a = topic('a.v1', { schema: unchecked<number>(), retention: last10 });
  const b = topic('b.v1', {
    schema: unchecked<string>(),
    reply: unchecked<string>(),
    retention: { kind: 'compacted' },
    maxRecordBytes: 1024,
  });

  it('builds a branded, frozen list with lookup', () => {
    const c = contracts(a, b);
    expect(isContracts(c)).toBe(true);
    expect(isContracts({ topics: [] })).toBe(false);
    expect(c.topics.map((t) => t.name)).toEqual(['a.v1', 'b.v1']);
    expect(c.get('b.v1')).toBe(b);
    expect(c.get('nope')).toBeUndefined();
    expect(Object.isFrozen(c) && Object.isFrozen(c.topics)).toBe(true);
  });

  it('rejects duplicate names', () => {
    const err = catchErr(() =>
      contracts(a, b, topic('a.v1', { schema: unchecked(), retention: last10 })),
    );
    expect(err).toMatchObject({ code: 'contracts_invalid', topics: ['a.v1'] });
  });

  it('rejects isoloop.* topics with reserved_topic', () => {
    const sys = topic('isoloop.route.v1', { schema: unchecked(), retention: last10 });
    expect(catchErr(() => contracts(a, sys))).toMatchObject({
      code: 'reserved_topic',
      topics: ['isoloop.route.v1'],
    });
  });

  it.each([
    ['no schema', { name: 'x.v1', retention: last10 }],
    ['a schema that is not a Standard Schema', { name: 'x.v1', schema: {}, retention: last10 }],
    ['no retention', { name: 'x.v1', schema: unchecked() }],
    ['an unknown retention', { name: 'x.v1', schema: unchecked(), retention: { kind: 'forever' } }],
    [
      'last-n without n',
      { name: 'x.v1', schema: unchecked(), retention: { kind: 'last-n', n: 0 } },
    ],
    ['time without ms', { name: 'x.v1', schema: unchecked(), retention: { kind: 'time', ms: -1 } }],
    [
      'an unknown durability',
      { name: 'x.v1', schema: unchecked(), retention: last10, durability: 'disk' },
    ],
  ])('rejects a topic with %s', (_, bad) => {
    // Untyped on purpose: contracts modules are plain JS to the bus worker.
    expect(catchErr(() => Reflect.apply(contracts, undefined, [bad]))).toMatchObject({
      code: 'contracts_invalid',
      topics: ['x.v1'],
    });
  });

  it('extracts the cloneable config for the boot check', () => {
    expect(topicConfig(a)).toEqual({ name: 'a.v1', retention: last10, requestable: false });
    const cfg = topicConfig(b);
    expect(cfg).toEqual({
      name: 'b.v1',
      retention: { kind: 'compacted' },
      maxRecordBytes: 1024,
      requestable: true,
    });
    expect(structuredClone(cfg)).toEqual(cfg);
  });

  it('carries durability, and accepts persistent topics before M2b', () => {
    const p = topic('p.v1', { schema: unchecked(), retention: last10, durability: 'persistent' });
    expect(contracts(p).get('p.v1')).toBe(p);
    expect(topicConfig(p)).toMatchObject({ durability: 'persistent' });
    expect(topicConfig(a)).not.toHaveProperty('durability');
  });
});

describe('testContracts()', () => {
  class Money {
    constructor(readonly cents: number) {}
  }
  const price = topic('price.v1', {
    schema: z.object({ cents: z.number() }).transform((x) => new Money(x.cents)),
    retention: last10,
  });
  const plain = topic('plain.v1', {
    schema: z.object({ at: z.coerce.date(), tags: z.array(z.string()) }),
    reply: z.object({ ok: z.boolean() }).transform(() => () => true),
    retention: last10,
  });

  it('flags a transform that outputs a class instance', async () => {
    const problems = await testContracts(contracts(price), { 'price.v1': [{ cents: 5 }] });
    expect(problems).toEqual([
      expect.objectContaining({ topic: 'price.v1', kind: 'not_plain', sample: 0 }),
    ]);
    expect(problems[0]?.message).toContain('Money');
  });

  it('passes plain outputs, and checks replies and rejected samples', async () => {
    const problems = await testContracts(contracts(plain), {
      'plain.v1': {
        values: [{ at: '2026-01-01', tags: [] }, { tags: 1 }],
        replies: [{ ok: true }],
      },
    });
    expect(problems.map((p) => [p.schema, p.sample, p.kind])).toEqual([
      ['value', 1, 'invalid'],
      ['reply', 0, 'not_plain'],
    ]);
  });

  it('reports topics with no samples', async () => {
    const problems = await testContracts(contracts(plain), {});
    expect(problems).toEqual([expect.objectContaining({ topic: 'plain.v1', kind: 'no_samples' })]);
  });
});

describe('system topics (@isoloop/protocol)', () => {
  const demo = systemTopic<{ href: string; hash?: string }>('isoloop.demo.v1', {
    schema: systemSchema(checks.object({ href: checks.string, hash: checks.optionalString })),
    retention: { kind: 'last-n', n: 1 },
  });

  it('fit the bus TopicDef shape', () => {
    expectTypeOf(demo).toExtend<TopicDef<{ href: string; hash?: string }>>();
    expectTypeOf(SYSTEM_TOPICS).toExtend<readonly AnyTopicDef[]>();
  });

  it('validate by hand with full paths', async () => {
    expect(await validate(demo.schema, { href: '/a' })).toEqual({ value: { href: '/a' } });
    const r = await validate(demo.schema, { href: 1, hash: 2 });
    expect(r.issues?.map((i) => i.path)).toEqual([['href'], ['hash']]);
    expect((await validate(demo.schema, null)).issues).toHaveLength(1);
  });

  it('must live under isoloop.', () => {
    expect(() =>
      systemTopic('app.v1', { schema: systemSchema(checks.any), retention: last10 }),
    ).toThrow();
  });

  it('are all named isoloop.*', () => {
    for (const t of SYSTEM_TOPICS) expect(t.name.startsWith('isoloop.')).toBe(true);
  });
});

function catchErr(fn: () => unknown): ContractsError | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof ContractsError) return e;
    throw e;
  }
  return undefined;
}
