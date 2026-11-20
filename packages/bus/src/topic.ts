import {
  isSystemTopic,
  topicConfigOf,
  UNCHECKED_VENDOR,
  type BusRecord,
  type ErrorCode,
  type Retention,
  type TopicConfig,
  type ToolSpec,
} from '@isoloop/protocol';
import type { StandardSchemaV1 } from './standard-schema';

export type { Retention, ToolSpec } from '@isoloop/protocol';

/** The default `maxRecordBytes`: 256 KiB. */
export const DEFAULT_MAX_RECORD_BYTES: number = 256 * 1024;

/**
 * A topic: its name, its schemas and what its log keeps. Publishers are typed
 * with `In` and subscribers with `Out`, because the log stores what the schema
 * returns, not what was published. `RIn` and `ROut` type the replies to
 * `bus.request`; a topic without `reply` can't be requested.
 */
export type TopicDef<In, Out = In, RIn = never, ROut = RIn> = {
  /** The topic's name. By convention it ends in the major version, for example `cart.items.v1`. */
  readonly name: string;
  /** The Standard Schema that checks each published value. Required: `unchecked<T>()` is the explicit opt-out. */
  readonly schema: StandardSchemaV1<In, Out>;
  /** The Standard Schema for replies. Required for `bus.request`. @experimental */
  readonly reply?: StandardSchemaV1<RIn, ROut>;
  /** What the log keeps: the newest `n` records, the records younger than `ms`, or the latest record per key. Required. */
  readonly retention: Retention;
  /** The largest record, by its rough structured size. A bigger one is rejected with `too_large`. Default 256 KiB. */
  readonly maxRecordBytes?: number;
  /**
   * Default `memory`. `persistent` keeps the topic in OPFS, so it survives a
   * bus crash and a reload. Where OPFS isn't available, or another tab holds
   * it, it behaves as `memory` and the kernel emits `bus:durability_degraded`.
   */
  readonly durability?: 'memory' | 'persistent';
  /**
   * Starts this topic from an older one. On the first boot where this topic
   * is empty and `from` has records, the bus copies them through `map` and
   * this topic's schema before it opens: its publishes wait and its
   * subscribers get nothing until then. `map` must be pure and synchronous.
   * `follow` keeps mapping new `from` records afterwards.
   */
  readonly seed?: {
    /** The older topic to copy from. */
    readonly from: AnyTopicDef;
    /** Turns an older record's value into this topic's input. A record whose `map` throws or returns a promise is skipped, and the kernel emits `bus:seed_rejected`. */
    readonly map: (value: any, record: BusRecord) => In;
    /** Keeps mapping new `from` records after the first copy. Default `false`. */
    readonly follow?: boolean;
  };
  /**
   * Describes this topic as a tool for agents. Only a topic with `reply` can
   * have one: without it this field's type is `never`. It exposes nothing by
   * itself; the app's `agents.expose` does. It stays on the host: the bus
   * worker never sees it.
   * @experimental
   */
  readonly tool?: [RIn] extends [never] ? never : ToolSpec;
};

/** A topic of any types, as `contracts()` takes them. */
export type AnyTopicDef = TopicDef<any, any, any, any>;

/** What a publisher passes. */
export type InputOf<D> = D extends TopicDef<infer In, any, any, any> ? In : never;
/** What a subscriber receives. */
export type OutputOf<D> = D extends TopicDef<any, infer Out, any, any> ? Out : never;
/** What a responder passes to `reply`. */
export type ReplyInputOf<D> = D extends TopicDef<any, any, infer RIn, any> ? RIn : never;
/** What a requester receives. */
export type ReplyOutputOf<D> = D extends TopicDef<any, any, any, infer ROut> ? ROut : never;

/**
 * Defines a topic. Its types come from its schemas.
 *
 * @param name - The topic's name, for example `cart.items.v1`.
 * @param def - The topic's schemas, retention and options.
 * @returns The topic, frozen. List it in `contracts()` to use it.
 *
 * @example
 * ```ts
 * import { topic } from '@isoloop/bus';
 * import { z } from 'zod';
 *
 * export const cartItems = topic('cart.items.v1', {
 *   schema: z.object({ sku: z.string(), qty: z.number().int().positive() }),
 *   retention: { kind: 'compacted' },
 * });
 * ```
 */
export function topic<In, Out = In, RIn = never, ROut = RIn>(
  name: string,
  def: Omit<TopicDef<In, Out, RIn, ROut>, 'name'>,
): TopicDef<In, Out, RIn, ROut> {
  return Object.freeze({ ...def, name });
}

/**
 * A Standard Schema that accepts any value unchanged and only carries the type.
 * Tools list the topics that use it.
 *
 * @returns A schema whose input and output type is `T`.
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

/**
 * True if the schema came from `unchecked()`.
 *
 * @internal
 */
export function isUnchecked(schema: StandardSchemaV1): boolean {
  return schema['~standard'].vendor === UNCHECKED_VENDOR;
}

/**
 * The default export of a contracts module. Built only by `contracts()`, so
 * the bus worker can tell it from any other export.
 */
export type Contracts = {
  /** Brand, so the bus worker can tell a contracts list from any other export. */
  readonly '~isoloop': 'contracts';
  /** The topics, in the order given to `contracts()`. */
  readonly topics: readonly AnyTopicDef[];
  /**
   * Looks a topic up by name.
   *
   * @param name - The topic's name.
   * @returns The topic, or `undefined` if the list doesn't have it.
   */
  get(name: string): AnyTopicDef | undefined;
};

/** A contracts list that can't be built: duplicate or reserved names, or a bad definition. */
export class ContractsError extends Error {
  /** `reserved_topic` for an `isoloop.*` name, `contracts_invalid` for anything else. */
  readonly code: ErrorCode;
  /** The topics at fault. */
  readonly topics: readonly string[];

  /**
   * @param code - The error code.
   * @param message - What is wrong, naming the topics.
   * @param topics - The topics at fault.
   */
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

const optionalBoolean = (x: unknown): boolean => x === undefined || typeof x === 'boolean';

function toolProblemOf(tool: unknown): string | undefined {
  if (!isRecord(tool)) return 'has a `tool` that is not an object';
  if (typeof tool['description'] !== 'string' || tool['description'] === '')
    return 'has a `tool` without a `description`';
  if (typeof tool['readOnly'] !== 'boolean') return 'has a `tool` without a boolean `readOnly`';
  if (tool['title'] !== undefined && typeof tool['title'] !== 'string')
    return 'has a `tool` whose `title` is not a string';
  if (!optionalBoolean(tool['consequential']) || !optionalBoolean(tool['untrustedContent']))
    return 'has a `tool` whose hints are not booleans';
  return undefined;
}

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
  if (t.tool !== undefined) {
    const problem = toolProblemOf(t.tool);
    if (problem) return problem;
  }
  if (t.seed !== undefined) {
    const s = t.seed as { from?: { name?: unknown }; map?: unknown; follow?: unknown } | null;
    if (!isRecord(s) || !isRecord(s.from) || typeof s.from.name !== 'string')
      return 'has a seed without a `from` topic';
    if (typeof s.map !== 'function') return 'has a seed without a `map` function';
    if (s.follow !== undefined && typeof s.follow !== 'boolean')
      return 'has a seed whose `follow` is not a boolean';
    if (s.from.name === t.name) return 'seeds from itself';
  }
  return undefined;
}

/**
 * Builds the contracts list, the default export of a contracts module.
 *
 * @param topics - Every topic the app uses.
 * @returns The list, frozen.
 * @throws {ContractsError} `reserved_topic` for an `isoloop.*` name, which
 *   belongs to the kernel. `contracts_invalid` for a duplicate name, a topic
 *   without a valid schema or retention, a bad `tool` or `seed`, or seeds that
 *   form a cycle.
 *
 * @example
 * ```ts
 * import { contracts, topic } from '@isoloop/bus';
 * import { z } from 'zod';
 *
 * const prices = topic('markets.prices.v1', {
 *   schema: z.object({ symbol: z.string(), last: z.number() }),
 *   retention: { kind: 'last-n', n: 1_000 },
 * });
 *
 * export default contracts(prices);
 * ```
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
  // A seed may read a topic the contracts no longer list: the bus keeps it on
  // disk for the seed, but doesn't open it to isolates (ADR 0003, decision 19).
  const cycle = seedCycle(byName);
  if (cycle) {
    throw new ContractsError(
      'contracts_invalid',
      `seeds form a cycle: ${cycle.join(' → ')}`,
      cycle,
    );
  }
  return Object.freeze({
    '~isoloop': 'contracts' as const,
    topics: Object.freeze([...topics]),
    get: (name: string) => byName.get(name),
  });
}

/** A chain of seeds that comes back to where it started, if there is one. */
function seedCycle(byName: Map<string, AnyTopicDef>): string[] | undefined {
  for (const start of byName.values()) {
    const path = [start.name];
    let at = start.seed?.from;
    while (at !== undefined) {
      if (at.name === start.name) return [...path, at.name];
      if (path.includes(at.name)) break;
      path.push(at.name);
      at = (byName.get(at.name) ?? at).seed?.from;
    }
  }
  return undefined;
}

/**
 * True for a value built by `contracts()`, from any copy of this package.
 *
 * @internal
 */
export function isContracts(x: unknown): x is Contracts {
  return isRecord(x) && x['~isoloop'] === 'contracts';
}

/**
 * The structured-cloneable part of a topic, sent at `boot` for the contracts check (ADR 0003, decision 5).
 *
 * @internal
 */
export function topicConfig(t: AnyTopicDef): TopicConfig {
  return topicConfigOf(t);
}
