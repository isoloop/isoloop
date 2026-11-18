import * as v from 'valibot';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  hasJsonSchema,
  jsonSchemaOf,
  topicJsonSchemas,
  type JsonSchemaResult,
  type StandardJSONSchemaV1,
  type TopicJsonSchemasResult,
} from './json-schema';
import type { StandardSchemaV1 } from './standard-schema';
import { topic, unchecked } from './topic';

const last10 = { kind: 'last-n', n: 10 } as const;
const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

describe('the vendored Standard JSON Schema interface', () => {
  it('is what Zod 4 implements', () => {
    // Conformance at the type level: a Zod schema is assignable to our copy.
    expectTypeOf(z.object({ a: z.string() })).toExtend<StandardJSONSchemaV1>();
  });

  it('tells schemas with a converter from those without', () => {
    expect(hasJsonSchema(z.string())).toBe(true);
    expect(hasJsonSchema(v.string())).toBe(false);
    expect(hasJsonSchema(unchecked<string>())).toBe(false);
    expect(hasJsonSchema(null)).toBe(false);
    expect(hasJsonSchema({ '~standard': { jsonSchema: { input: 1, output: () => ({}) } } })).toBe(
      false,
    );
  });

  it('calls the converter with draft 2020-12', () => {
    const targets: string[] = [];
    const fake: StandardSchemaV1 & StandardJSONSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'fake',
        validate: (value) => ({ value }),
        jsonSchema: {
          input: (o) => (targets.push(o.target), { in: true }),
          output: (o) => (targets.push(o.target), { out: true }),
        },
      },
    };
    expect(jsonSchemaOf(fake)).toEqual({ ok: true, input: { in: true }, output: { out: true } });
    expect(targets).toEqual(['draft-2020-12', 'draft-2020-12']);
  });
});

describe('jsonSchemaOf', () => {
  it('makes different input and output schemas when a default applies', () => {
    const r = jsonSchemaOf(z.object({ sku: z.string(), qty: z.number().int().default(1) }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input).toMatchObject({ $schema: DRAFT, type: 'object', required: ['sku'] });
    expect(r.output).toMatchObject({ $schema: DRAFT, type: 'object', required: ['sku', 'qty'] });
  });

  it('reports a schema without the interface as unsupported, naming its vendor', () => {
    expect(jsonSchemaOf(v.object({ a: v.string() }))).toEqual({
      ok: false,
      reason: 'unsupported',
      message: "doesn't implement Standard JSON Schema (valibot)",
    });
  });

  it('reports unchecked() as unchecked', () => {
    expect(jsonSchemaOf(unchecked<number>())).toMatchObject({ ok: false, reason: 'unchecked' });
  });

  it('turns a converter that throws into a result', () => {
    const r = jsonSchemaOf(z.string().transform((s) => s.length));
    expect(r).toEqual({
      ok: false,
      reason: 'failed',
      message: "can't be made into JSON Schema: Transforms cannot be represented in JSON Schema",
    });
  });

  it('types its result as a union to narrow', () => {
    expectTypeOf(jsonSchemaOf).returns.toEqualTypeOf<JsonSchemaResult>();
  });
});

describe('topicJsonSchemas', () => {
  const quote = topic('markets.quote.v1', {
    schema: z.object({ symbol: z.string() }),
    reply: z.object({ price: z.number(), change24h: z.number().default(0) }),
    retention: last10,
  });

  it('makes the input, output and reply schemas of a requestable topic', () => {
    const r = topicJsonSchemas(quote);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.schema.input).toMatchObject({ type: 'object', required: ['symbol'] });
    expect(r.schema.output).toMatchObject({ type: 'object', required: ['symbol'] });
    expect(r.reply?.input).toMatchObject({ required: ['price'] });
    expect(r.reply?.output).toMatchObject({ required: ['price', 'change24h'] });
  });

  it('leaves reply out for a topic without one', () => {
    const r = topicJsonSchemas(topic('a.v1', { schema: z.number(), retention: last10 }));
    expect(r.ok).toBe(true);
    expect(new Set(Object.keys(r))).toEqual(new Set(['ok', 'schema']));
  });

  it('names the topic and the part when the record schema is not exportable', () => {
    const r = topicJsonSchemas(topic('a.v1', { schema: v.string(), retention: last10 }));
    expect(r).toEqual({
      ok: false,
      topic: 'a.v1',
      part: 'schema',
      reason: 'unsupported',
      message: "a.v1: schema doesn't implement Standard JSON Schema (valibot)",
    });
  });

  it('names the reply when only the reply is not exportable', () => {
    const r = topicJsonSchemas(
      topic('a.v1', { schema: z.string(), reply: unchecked<number>(), retention: last10 }),
    );
    expect(r).toMatchObject({ ok: false, topic: 'a.v1', part: 'reply', reason: 'unchecked' });
    expect(r.ok ? '' : r.message).toBe('a.v1: reply is unchecked()');
  });

  it('never throws', () => {
    const bad = topic('a.v1', {
      schema: z.object({ n: z.bigint() }),
      reply: z.string(),
      retention: last10,
    });
    let r: TopicJsonSchemasResult | undefined;
    expect(() => (r = topicJsonSchemas(bad))).not.toThrow();
    expect(r).toMatchObject({ ok: false, part: 'schema', reason: 'failed' });
  });
});
