import type { BusRecord } from './bus';
import type { Retention, TopicConfig } from './control';

/*
 * Topic handles as host and isolate code see them. The bus defines topics
 * (`topic()` in `@isoloop/bus`), but host and runtime may not import the bus
 * (system design §2), so they take these structural types: a bus `TopicDef`
 * fits them, and its schema types carry over.
 */

/**
 * A topic as `kernel.publish`, `kernel.subscribe` and `BusClient` take it:
 * any `topic()` from `@isoloop/bus` fits, and its schema types carry over.
 */
export type TopicRef<In = unknown, Out = In, RIn = never, ROut = RIn> = {
  /** The topic's name. */
  readonly name: string;
  /** Its schema's types. */
  readonly schema: SchemaTypes<In, Out>;
  /** Its `reply` schema's types, for a requestable topic. */
  readonly reply?: SchemaTypes<RIn, ROut>;
};

/** The type-only part of a Standard Schema V1. */
export type SchemaTypes<In, Out> = {
  readonly '~standard': {
    readonly types?: { readonly input: In; readonly output: Out } | undefined;
  };
};

/** A record whose value has the topic's output type. */
export type TypedRecord<T> = Omit<BusRecord, 'value'> & { value: T };

/**
 * Describes a requestable topic as a tool for agents.
 * A `tool` field alone exposes nothing: the app's kernel config lists what
 * agents may call (`agents.expose`). It stays on the host and isn't part of
 * the `TopicConfig` the bus sees.
 * @experimental
 */
export type ToolSpec = {
  /** A short human-readable name. The tool's name is always the topic's name. */
  readonly title?: string;
  /** What the tool does, for the agent choosing it. */
  readonly description: string;
  /** Required: `true` if a call changes nothing. Maps to `readOnlyHint` in WebMCP and MCP. */
  readonly readOnly: boolean;
  /** The call has effects the user should confirm. WebMCP `consequentialHint`, MCP `destructiveHint`. Default `false`. */
  readonly consequential?: boolean;
  /** The reply can carry third-party text. WebMCP `untrustedContentHint`. Default `false`. */
  readonly untrustedContent?: boolean;
};

/** A topic as the host reads it from the contracts: any `topic()` from `@isoloop/bus` fits. */
export type TopicShape = {
  /** The topic's name. */
  readonly name: string;
  /**
   * The topic's Standard Schema. The host reads it only to make a tool's
   * JSON Schema; it never validates with it.
   */
  readonly schema?: unknown;
  /** How long it keeps its records. */
  readonly retention: Retention;
  /** The largest value it takes, in bytes. Default 256 KiB. */
  readonly maxRecordBytes?: number;
  /** `persistent` topics keep their records across reloads, on disk. Default `memory`. */
  readonly durability?: 'memory' | 'persistent';
  /** The `reply` schema, for a requestable topic. */
  readonly reply?: unknown;
  /** The topic it's seeded from, and whether it keeps following it. */
  readonly seed?: { readonly from: { readonly name: string }; readonly follow?: boolean };
  /** The topic as a tool for agents. The host keeps it; the bus never sees it. */
  readonly tool?: ToolSpec;
};

/** What `KernelConfig.contracts.list` holds: a `contracts()` list, seen structurally. */
export type ContractsList = { readonly topics: readonly TopicShape[] };

/**
 * The structured-cloneable part of a topic, sent at `boot` and compared with
 * the contracts module's (ADR 0003, decision 5). Host and bus both use this
 * one function, so equal definitions always give equal configs.
 */
export function topicConfigOf(t: TopicShape): TopicConfig {
  const cfg: TopicConfig = {
    name: t.name,
    retention: { ...t.retention },
    requestable: t.reply !== undefined,
  };
  if (t.maxRecordBytes !== undefined) cfg.maxRecordBytes = t.maxRecordBytes;
  if (t.durability !== undefined) cfg.durability = t.durability;
  if (t.seed !== undefined) cfg.seed = { from: t.seed.from.name, follow: t.seed.follow ?? false };
  return cfg;
}
