import type { StandardSchemaV1 } from './standard-schema';
import { isUnchecked, type AnyTopicDef } from './topic';

/**
 * The Standard JSON Schema V1 interface (https://standardschema.dev/json-schema),
 * vendored like {@link StandardSchemaV1} so the bus depends on no schema
 * library (ADR 0003, decision 21; ADR 0018, decision 1). Zod ≥ 4.2 implements
 * it. Copied from the spec; keep it in step with it. Only the parts Isoloop
 * reads are typed: the `jsonSchema` converter beside `validate`.
 */
export interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardJSONSchemaV1.Props<Input, Output>;
}

export declare namespace StandardJSONSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: StandardSchemaV1.Types<Input, Output> | undefined;
    /** Methods that make the input and output JSON Schema. */
    readonly jsonSchema: Converter;
  }

  export interface Converter {
    /** The input type as JSON Schema. May throw if the target isn't supported. */
    readonly input: (options: Options) => Record<string, unknown>;
    /** The output type as JSON Schema. May throw if the target isn't supported. */
    readonly output: (options: Options) => Record<string, unknown>;
  }

  export type Target = 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | ({} & string);

  export interface Options {
    readonly target: Target;
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }
}

/** A JSON Schema document (draft 2020-12), as the schema library made it. */
export type JsonSchema = Record<string, unknown>;

/** A schema's JSON Schema, for what it accepts (`input`) and what it gives (`output`). */
export type JsonSchemaPair = { readonly input: JsonSchema; readonly output: JsonSchema };

/**
 * Why a schema has no JSON Schema:
 * - `unchecked`: it came from `unchecked()`, so there's nothing to describe;
 * - `unsupported`: it doesn't implement `~standard.jsonSchema`;
 * - `failed`: the converter threw (for example, a transform or a type JSON
 *   Schema can't express).
 */
export type NotExportableReason = 'unchecked' | 'unsupported' | 'failed';

/** The result of {@link jsonSchemaOf}. Never throws; a failure is a value. */
export type JsonSchemaResult =
  | ({ readonly ok: true } & JsonSchemaPair)
  | { readonly ok: false; readonly reason: NotExportableReason; readonly message: string };

/** The JSON Schema target Isoloop uses everywhere (ADR 0003, decision 21). */
export const JSON_SCHEMA_TARGET = 'draft-2020-12';

const isRecord = (x: unknown): x is Record<PropertyKey, unknown> =>
  typeof x === 'object' && x !== null;

/** True if the schema implements Standard JSON Schema (`~standard.jsonSchema`). */
export function hasJsonSchema(schema: unknown): schema is StandardJSONSchemaV1 {
  if (!isRecord(schema)) return false;
  const std = schema['~standard'];
  if (!isRecord(std)) return false;
  const js = std['jsonSchema'];
  return isRecord(js) && typeof js['input'] === 'function' && typeof js['output'] === 'function';
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Makes a schema's input and output JSON Schema (draft 2020-12) through the
 * Standard JSON Schema interface. Never throws: an `unchecked()` schema, one
 * without the interface, or a converter that throws gives `{ ok: false }`
 * with the reason, so callers decide (`not_exposable` for the kernel, a flag
 * for `isoloop contracts export`).
 *
 * @experimental Used by agent tools and `isoloop contracts export`; may change before 1.0.
 */
export function jsonSchemaOf(schema: StandardSchemaV1): JsonSchemaResult {
  if (isUnchecked(schema)) {
    return { ok: false, reason: 'unchecked', message: 'is unchecked()' };
  }
  if (!hasJsonSchema(schema)) {
    return {
      ok: false,
      reason: 'unsupported',
      message: `doesn't implement Standard JSON Schema (${schema['~standard'].vendor})`,
    };
  }
  const options = { target: JSON_SCHEMA_TARGET } as const;
  try {
    const { jsonSchema } = schema['~standard'];
    return { ok: true, input: jsonSchema.input(options), output: jsonSchema.output(options) };
  } catch (e) {
    return {
      ok: false,
      reason: 'failed',
      message: `can't be made into JSON Schema: ${messageOf(e)}`,
    };
  }
}

const pair = (r: JsonSchemaResult & { ok: true }): JsonSchemaPair => ({
  input: r.input,
  output: r.output,
});

/** A topic's JSON Schemas: its record schema, and its `reply` if it has one. */
export type TopicJsonSchemas = {
  readonly schema: JsonSchemaPair;
  readonly reply?: JsonSchemaPair;
};

/** The result of {@link topicJsonSchemas}. `part` says which schema failed. */
export type TopicJsonSchemasResult =
  | ({ readonly ok: true } & TopicJsonSchemas)
  | {
      readonly ok: false;
      readonly topic: string;
      readonly part: 'schema' | 'reply';
      readonly reason: NotExportableReason;
      /** Names the topic, e.g. "markets.quote.v1: reply is unchecked()". */
      readonly message: string;
    };

/**
 * Makes a topic's JSON Schemas: the topic schema's input and output, and the
 * `reply` schema's when it has one. A tool's input schema is `schema.input`;
 * its output schema is `reply.output` (ADR 0018, decision 1). Never throws.
 *
 * @experimental Used by agent tools and `isoloop contracts export`; may change before 1.0.
 */
export function topicJsonSchemas(def: AnyTopicDef): TopicJsonSchemasResult {
  const fail = (part: 'schema' | 'reply', r: JsonSchemaResult & { ok: false }) =>
    ({
      ok: false,
      topic: def.name,
      part,
      reason: r.reason,
      message: `${def.name}: ${part} ${r.message}`,
    }) as const;
  const schema = jsonSchemaOf(def.schema);
  if (!schema.ok) return fail('schema', schema);
  if (def.reply === undefined) return { ok: true, schema: pair(schema) };
  const reply = jsonSchemaOf(def.reply);
  if (!reply.ok) return fail('reply', reply);
  return { ok: true, schema: pair(schema), reply: pair(reply) };
}
