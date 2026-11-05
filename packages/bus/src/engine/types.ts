import type { BusRecord, TopicConfig } from '@isoloop/protocol';

/** A record before the engine gives it an offset. */
export type NewRecord = Omit<BusRecord, 'offset'>;

/**
 * Where the bus keeps its logs (design §6.2). The TS engine implements it now,
 * the Rust/WASM engine in M5; both must pass `runEngineConformance`.
 *
 * Offsets are per topic, start at 0, are monotonic and never reused (I5).
 * Retention: `last-n` is applied on append; `time` and `compacted` on
 * `compact()`, which the broker calls on a timer. An engine may also compact
 * a `compacted` topic on its own once enough records are superseded.
 */
export interface LogEngine {
  /** Throws if the topic exists. */
  createTopic(cfg: TopicConfig): void;
  /** Appends and returns the record's offset. Throws on an unknown topic. */
  append(topic: string, rec: NewRecord): number;
  /** Up to `max` retained records with `offset >= fromOffset`, ascending. Skips dropped offsets. */
  read(topic: string, fromOffset: number, max: number): BusRecord[];
  /** Next offset to be written. */
  head(topic: string): number;
  /** Oldest retained offset; equals `head` when nothing is retained. */
  tail(topic: string): number;
  /** Stores a consumer's committed offset. Kept even when the records it names are dropped. */
  commit(topic: string, consumer: string, offset: number): void;
  committed(topic: string, consumer: string): number | undefined;
  /**
   * Retention pass: drops superseded (`compacted`) and expired (`time`)
   * records. Expiry runs in offset order and stops at the first record young
   * enough, so a record with an older `ts` behind it is kept until it reaches the tail.
   */
  compact(topic: string): void;
}

/** Options every engine takes. */
export type EngineOptions = {
  /** Clock for `time` retention. Default `Date.now`. */
  now?: () => number;
  /** Default `MemoryStorage`. */
  storage?: LogStorage;
};

/** What a storage found on open: per topic, the offsets it holds; per topic and consumer, commits. */
export type StoredState = {
  topics: { topic: string; tail: number; head: number }[];
  offsets: Record<string, Record<string, number>>;
};

/**
 * Durable storage under the engine, for `durability: 'persistent'` topics
 * (design §6.2, ADR 0007). M2 ships `MemoryStorage`, which keeps nothing;
 * M2b adds `OpfsStorage`.
 */
export interface LogStorage {
  /** `memory` keeps nothing; reported in the bus `ready` message. */
  readonly kind: 'memory' | 'opfs';
  open(): Promise<StoredState>;
  /** Buffered; group commit every 5 ms / 256 records. */
  appendBatch(topic: string, encoded: Uint8Array[]): void;
  /** Resolves when the batch is durable; a persistent publish is acked after it. */
  flush(): Promise<void>;
  saveOffsets(offsets: Record<string, Record<string, number>>): void;
  /** Retention/compaction on disk. */
  rewrite(topic: string, keep: (offset: number) => boolean): Promise<void>;
  /** Replay of evicted segments. */
  readSegment(topic: string, fromOffset: number): Promise<Uint8Array[]>;
  /** Safe mode: moves the newest segments aside and returns their names. */
  quarantineNewest(): Promise<string[]>;
}
