import {
  isSystemTopic,
  topicConfigOf,
  type ErrorCode,
  type Retention,
  type TopicConfig,
} from '@isoloop/protocol';
import type { StandardSchemaV1 } from './standard-schema';

export type { Retention } from '@isoloop/protocol';

/** Default `maxRecordBytes`: 256 KiB (design §6.1). */
export const DEFAULT_MAX_RECORD_BYTES: number = 256 * 1024;

/**
 * A topic: its name, schema and log policy (design §6.1). Publishers are typed
 * with `In`, subscribers with `Out`, because the log stores the schema's
 * validated output (ADR 0003, decision 11). `RIn`/`ROut` type `bus.request`
 * replies; a topic without `reply` can't be requested.
 */
export type TopicDef<In, Out = In, RIn = never, ROut = RIn> = {
  /** Carries the major version, e.g. `cart.items.v1` (ADR 0003, decision 17). */
  readonly name: string;
  /** Required. `unchecked<T>()` is the explicit opt-out. */
  readonly schema: StandardSchemaV1<In, Out>;
  /** Required for `bus.request`. */
  readonly reply?: StandardSchemaV1<RIn, ROut>;
  readonly retention: Retention;
  /** Rough structured size limit per record. Default 256 KiB. */
  readonly maxRecordBytes?: number;
  /**
   * Default `memory`. `persistent` keeps the topic in OPFS (ADR 0007): it
   * survives a bus crash and a reload. Where OPFS isn't available, or another
   * tab holds it, it behaves as `memory` and the kernel emits
   * `bus:durability-degraded`.
   */
  readonly durability?: 'memory' | 'persistent';
};

export type AnyTopicDef = TopicDef<any, any, any, any>;

/** What a publisher passes. */
export type InputOf<D> = D extends TopicDef<infer In, any, any, any> ? In : never;
/** What a subscriber receives. */
export type OutputOf<D> = D extends TopicDef<any, infer Out, any, any> ? Out : never;
/** What a responder passes to `reply`. */
export type ReplyInputOf<D> = D extends TopicDef<any, any, infer RIn, any> ? RIn : never;
/** What a requester receives. */
export type ReplyOutputOf<D> = D extends TopicDef<any, any, any, infer ROut> ? ROut : never;

/** Defines a topic. Types come from the schemas. */
export function topic<In, Out = In, RIn = never, ROut = RIn>(
  name: string,
  def: Omit<TopicDef<In, Out, RIn, ROut>, 'name'>,
): TopicDef<In, Out, RIn, ROut> {
  return Object.freeze({ ...def, name });
}

const UNCHECKED_VENDOR = 'isoloop/unchecked';

/**
 * A Standard Schema that accepts any value unchanged and only carries the type
 * (ADR 0003, decision 2). Tools list topics that use it.
 */
export function unchecked<T>(): StandardSchemaV1<T, T> {
  return {
    '~standard': {
      version: 1,
      vendor: UNCHECKED_VENDOR,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- unchecked by definition: the type is the caller's claim
      validate: (value) => ({ value: value as T }),
    },
  };
}

/** True if the schema came from `unchecked()`. */
export function isUnchecked(schema: StandardSchemaV1): boolean {
  return schema['~standard'].vendor === UNCHECKED_VENDOR;
}

/**
 * The default export of a contracts module (ADR 0003, decision 4). Built only
 * by `contracts()`, so the bus worker can tell it from any other export.
 */
export type Contracts = {
  /** Brand, so the bus worker can tell a contracts list from any other export. */
  readonly '~isoloop': 'contracts';
  readonly topics: readonly AnyTopicDef[];
  /** Looks a topic up by name. */
  get(name: string): AnyTopicDef | undefined;
};

/** A contracts list that can't be built: duplicate or reserved names, or a bad definition. */
export class ContractsError extends Error {
  readonly code: ErrorCode;
  /** The topics at fault. */
  readonly topics: readonly string[];

  constructor(code: ErrorCode, message: string, topics: readonly string[]) {
    super(message);
    this.name = 'ContractsError';
    this.code = code;
    this.topics = topics;
  }
}

const RETENTION_KINDS: ReadonlySet<string> = new Set(['last-n', 'time', 'compacted']);

const isRecord = (x: unknown): x is Record<PropertyKey, unknown> =>
  typeof x === 'object' && x !== null;

const isSchema = (x: unknown): boolean =>
  isRecord(x) && isRecord(x['~standard']) && typeof x['~standard']['validate'] === 'function';

const positiveInt = (n: unknown): boolean => typeof n === 'number' && Number.isInteger(n) && n > 0;

function problemOf(t: AnyTopicDef): string | undefined {
  if (typeof t.name !== 'string' || t.name === '') return 'has no name';
  if (!isSchema(t.schema)) return 'has no Standard Schema';
  if (t.reply !== undefined && !isSchema(t.reply))
    return 'has a reply that is not a Standard Schema';
  const r = t.retention as Retention | undefined;
  if (!r || !RETENTION_KINDS.has(r.kind)) return 'has no valid retention';
  if (r.kind === 'last-n' && !positiveInt(r.n)) return 'needs a positive integer `n`';
  if (r.kind === 'time' && !positiveInt(r.ms)) return 'needs a positive integer `ms`';
  if (t.maxRecordBytes !== undefined && !positiveInt(t.maxRecordBytes)) {
    return 'needs a positive integer `maxRecordBytes`';
  }
  if (t.durability !== undefined && t.durability !== 'memory' && t.durability !== 'persistent') {
    return "has a durability other than 'memory' or 'persistent'";
  }
  return undefined;
}

/**
 * Builds the contracts list. Rejects duplicate names and `isoloop.*` topics,
 * which belong to the kernel (ADR 0003, decisions 4 and 6).
 */
export function contracts(...topics: AnyTopicDef[]): Contracts {
  const reserved = topics.filter((t) => isSystemTopic(t.name)).map((t) => t.name);
  if (reserved.length > 0) {
    throw new ContractsError(
      'reserved_topic',
      `isoloop.* topics belong to the kernel: ${reserved.join(', ')}`,
      reserved,
    );
  }
  for (const t of topics) {
    const problem = problemOf(t);
    if (problem) {
      throw new ContractsError('contracts_invalid', `topic ${t.name} ${problem}`, [t.name]);
    }
  }
  const byName = new Map<string, AnyTopicDef>();
  const dupes = new Set<string>();
  for (const t of topics) {
    if (byName.has(t.name)) dupes.add(t.name);
    byName.set(t.name, t);
  }
  if (dupes.size > 0) {
    const names = [...dupes];
    throw new ContractsError(
      'contracts_invalid',
      `duplicate topic names: ${names.join(', ')}`,
      names,
    );
  }
  return Object.freeze({
    '~isoloop': 'contracts' as const,
    topics: Object.freeze([...topics]),
    get: (name: string) => byName.get(name),
  });
}

/** True for a value built by `contracts()`, from any copy of this package. */
export function isContracts(x: unknown): x is Contracts {
  return isRecord(x) && x['~isoloop'] === 'contracts';
}

/** The structured-cloneable part of a topic, sent at `boot` for the contracts check (ADR 0003, decision 5). */
export function topicConfig(t: AnyTopicDef): TopicConfig {
  return topicConfigOf(t);
}
