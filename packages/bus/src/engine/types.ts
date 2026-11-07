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
  /**
   * Whether appends to `topic` go to durable storage: a `persistent` topic on
   * storage that keeps it (ADR 0007). The broker acks those after `flush`.
   */
  durable(topic: string): boolean;
  /**
   * Resolves once every append so far to a durable topic is on disk. `now`
   * writes the pending batch at once instead of at the next group commit (the
   * page is freezing or going away).
   */
  flush(o?: { now?: boolean }): Promise<void>;
  /**
   * Whether `read(topic, fromOffset, …)` can answer now. False when the
   * records from there were evicted to disk and aren't paged in: call `page`
   * first (M2b task 11). Memory topics are always readable.
   */
  readable(topic: string, fromOffset: number): boolean;
  /** Pages evicted records from `fromOffset` back in from disk, so `read` sees them. */
  page(topic: string, fromOffset: number): Promise<void>;
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
  /**
   * Resolves when the batch is durable; a persistent publish is acked after
   * it. `now` commits the pending batch without waiting for the group commit.
   */
  flush(o?: { now?: boolean }): Promise<void>;
  saveOffsets(offsets: Record<string, Record<string, number>>): void;
  /**
   * Retention on disk (last-n, time): deletes the segments whose records are
   * all below `tail`. Never the newest segment.
   */
  dropBelow(topic: string, tail: number): void;
  /**
   * Compaction on disk: rewrites the segments before the newest one, keeping
   * the records `keep` accepts. In the background; appends don't wait for it.
   */
  rewrite(topic: string, keep: (offset: number, key: string | undefined) => boolean): Promise<void>;
  /** Replay of evicted segments. */
  readSegment(topic: string, fromOffset: number): Promise<Uint8Array[]>;
  /** Bytes a topic takes on disk; 0 for one the storage doesn't hold. */
  bytes(topic: string): Promise<number>;
  /** Deletes a topic's files. False when the storage doesn't hold it. */
  deleteTopic(topic: string): Promise<boolean>;
  /** Safe mode: moves the newest segments aside and returns their names. */
  quarantineNewest(): Promise<string[]>;
}
