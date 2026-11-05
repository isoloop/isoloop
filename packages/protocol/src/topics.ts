import type { BusRecord } from './bus';
import type { Retention, TopicConfig } from './control';

/*
 * Topic handles as host and isolate code see them. The bus defines topics
 * (`topic()` in `@isoloop/bus`), but host and runtime may not import the bus
 * (system design §2), so they take these structural types: a bus `TopicDef`
 * fits them, and its schema types carry over.
 */

/** A topic as `kernel.publish`, `kernel.subscribe` and `BusClient` take it. */
export type TopicRef<In = unknown, Out = In, RIn = never, ROut = RIn> = {
  readonly name: string;
  readonly schema: SchemaTypes<In, Out>;
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

/** The parts of a topic definition that make up its `TopicConfig`. */
export type TopicShape = {
  readonly name: string;
  readonly retention: Retention;
  readonly maxRecordBytes?: number;
  readonly durability?: 'memory' | 'persistent';
  readonly reply?: unknown;
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
  return cfg;
}
