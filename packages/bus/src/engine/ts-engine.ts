import type { BusRecord, TopicConfig } from '@isoloop/protocol';
import { decodeFrame, encodeFrame } from '../storage/frame';
import { MemoryStorage, effectiveDurability } from './memory-storage';
import type { EngineOptions, LogEngine, LogStorage, NewRecord, StoredState } from './types';

/** Default records per chunk. Chunk `i` holds offsets `[i * size, (i + 1) * size)`. */
export const CHUNK = 4096;

export type TsEngineOptions = EngineOptions & {
  /** Records per chunk. Default 4,096; tests use small chunks to cross boundaries often. */
  chunkSize?: number;
  /** Superseded records before a compacted topic compacts itself. Default 1,024. */
  dirtyMin?: number;
};

/** A compacted topic compacts itself once this share of its records is superseded… */
const DIRTY_RATIO = 0.5;
/** …and at least this many are. */
const DIRTY_MIN = 1024;

/** `null`: every slot in the chunk was dropped. Slots are `undefined` where a record was dropped. */
type Chunk = (BusRecord | undefined)[] | null;

type Topic = {
  cfg: TopicConfig;
  /** Chunk index of `chunks[0]`. */
  base: number;
  chunks: Chunk[];
  head: number;
  /** Oldest retained offset. Every slot below it is dropped, even if still in memory. */
  tail: number;
  /** Retained records in `[tail, head)`. */
  live: number;
  /** Compacted topics: latest offset per key, and how many retained records it supersedes. */
  keys: Map<string, number> | undefined;
  dirty: number;
  commits: Map<string, number>;
  /** Appends also go to the storage (a persistent topic on real storage). */
  durable: boolean;
};

/**
 * The TypeScript `LogEngine` (design §6.2). Each topic is an array of
 * fixed-size chunks, so dropping old records frees a whole chunk at a time:
 * O(1) per chunk. Compacted topics keep a key → latest-offset index.
 */
export class TsEngine implements LogEngine {
  readonly name = 'ts';
  readonly #topics = new Map<string, Topic>();
  readonly #now: () => number;
  readonly #storage: LogStorage;
  readonly #size: number;
  readonly #dirtyMin: number;

  constructor(opts: TsEngineOptions = {}) {
    this.#now = opts.now ?? Date.now;
    this.#size = opts.chunkSize ?? CHUNK;
    this.#dirtyMin = opts.dirtyMin ?? DIRTY_MIN;
    this.#storage = opts.storage ?? new MemoryStorage();
  }

  #topic(name: string): Topic {
    const t = this.#topics.get(name);
    if (!t) throw new Error(`unknown topic ${name}`);
    return t;
  }

  createTopic(cfg: TopicConfig): void {
    if (this.#topics.has(cfg.name)) throw new Error(`topic ${cfg.name} exists`);
    const durable = effectiveDurability(cfg, this.#storage) === 'persistent';
    this.#topics.set(cfg.name, {
      durable,
      cfg,
      base: 0,
      chunks: [],
      head: 0,
      tail: 0,
      live: 0,
      keys: cfg.retention.kind === 'compacted' ? new Map() : undefined,
      dirty: 0,
      commits: new Map(),
    });
  }

  append(topic: string, rec: NewRecord): number {
    const t = this.#topic(topic);
    // Encoded first: a value the codec refuses throws before anything changes.
    const frame = t.durable ? encodeFrame({ ...rec, offset: t.head }) : undefined;
    if (frame) this.#storage.appendBatch(topic, [frame]);
    return this.#place(t, rec, t.head);
  }

  /**
   * Rebuilds durable topics from what the storage found on open (M2b task 7):
   * every stored record, in order and at its own offset, with retention
   * applied as if it had just been appended, and the committed offsets.
   * Call after `createTopic`, before any append. Returns each restored
   * topic's head.
   */
  async restore(state: StoredState): Promise<{ topic: string; head: number }[]> {
    const restored: { topic: string; head: number }[] = [];
    for (const { topic, tail, head } of state.topics) {
      const t = this.#topics.get(topic);
      if (!t?.durable) continue;
      if (t.head !== 0) throw new Error(`${topic} isn't empty`);
      t.head = t.tail = tail;
      t.base = Math.floor(tail / this.#size);
      let from = tail;
      while (from < head) {
        // oxlint-disable-next-line no-await-in-loop -- segment by segment, in order
        const frames = await this.#storage.readSegment(topic, from);
        if (frames.length === 0) break;
        for (const f of frames) {
          const { offset, epoch: _e, seq: _s, ...rec } = decodeFrame(f);
          this.#place(t, rec, offset);
          from = offset + 1;
        }
      }
      // Offsets a corrupt frame left out are skipped, never reused (I5).
      t.head = Math.max(t.head, head);
      for (const [consumer, offset] of Object.entries(state.offsets[topic] ?? {})) {
        t.commits.set(consumer, offset);
      }
      restored.push({ topic, head: t.head });
    }
    return restored;
  }

  /** Stores a record at `offset` (≥ head; a gap is left as dropped slots) and applies retention. */
  #place(t: Topic, rec: NewRecord, at: number): number {
    t.head = at + 1;
    const offset = at;
    const ci = Math.floor(offset / this.#size);
    if (t.chunks.length === 0) t.base = ci;
    let chunk = t.chunks[ci - t.base];
    if (chunk === undefined || chunk === null) {
      chunk = [];
      t.chunks[ci - t.base] = chunk;
    }
    chunk[offset % this.#size] = { ...rec, offset };
    t.live++;

    const r = t.cfg.retention;
    if (r.kind === 'last-n') {
      if (t.live > r.n) this.#dropBelow(t, t.head - r.n);
    } else if (t.keys && rec.key !== undefined) {
      const prev = t.keys.get(rec.key);
      t.keys.set(rec.key, offset);
      if (prev !== undefined && prev >= t.tail) {
        t.dirty++;
        if (t.dirty >= this.#dirtyMin && t.dirty >= t.live * DIRTY_RATIO) this.#compactKeys(t);
      }
    }
    return offset;
  }

  read(topic: string, fromOffset: number, max: number): BusRecord[] {
    const t = this.#topic(topic);
    const out: BusRecord[] = [];
    let o = Math.max(fromOffset, t.tail);
    while (o < t.head && out.length < max) {
      const ci = Math.floor(o / this.#size);
      const chunk = t.chunks[ci - t.base];
      const end = Math.min((ci + 1) * this.#size, t.head);
      if (!chunk) {
        o = end;
        continue;
      }
      for (; o < end && out.length < max; o++) {
        const rec = chunk[o % this.#size];
        if (rec) out.push(rec);
      }
    }
    return out;
  }

  head(topic: string): number {
    return this.#topic(topic).head;
  }

  tail(topic: string): number {
    return this.#topic(topic).tail;
  }

  commit(topic: string, consumer: string, offset: number): void {
    const t = this.#topic(topic);
    t.commits.set(consumer, offset);
    if (t.durable) this.#storage.saveOffsets({ [topic]: Object.fromEntries(t.commits) });
  }

  committed(topic: string, consumer: string): number | undefined {
    return this.#topic(topic).commits.get(consumer);
  }

  durable(topic: string): boolean {
    return this.#topic(topic).durable;
  }

  flush(): Promise<void> {
    return this.#storage.flush();
  }

  compact(topic: string): void {
    const t = this.#topic(topic);
    const r = t.cfg.retention;
    if (r.kind === 'time') this.#expire(t, this.#now() - r.ms);
    else if (r.kind === 'compacted') this.#compactKeys(t);
  }

  /** Drops every record below `offset` (last-n). */
  #dropBelow(t: Topic, offset: number): void {
    if (offset <= t.tail) return;
    t.live -= this.#countLive(t, t.tail, offset);
    t.tail = offset;
    this.#freeChunks(t);
  }

  /** Records in `[from, to)` still held. Last-n topics have no holes, so this is `to - from` there. */
  #countLive(t: Topic, from: number, to: number): number {
    if (t.cfg.retention.kind === 'last-n') return to - from;
    let n = 0;
    for (let o = from; o < to; o++) if (this.#at(t, o)) n++;
    return n;
  }

  /** Drops records from the tail while the oldest is older than `cutoff` (time). */
  #expire(t: Topic, cutoff: number): void {
    let o = t.tail;
    while (o < t.head) {
      const rec = this.#at(t, o);
      if (rec && rec.ts >= cutoff) break;
      if (rec) t.live--;
      o = rec || this.#chunkOf(t, o) ? o + 1 : (Math.floor(o / this.#size) + 1) * this.#size;
    }
    t.tail = Math.min(o, t.head);
    this.#freeChunks(t);
  }

  /** Drops records superseded by a later record with the same key; keyless records stay. */
  #compactKeys(t: Topic): void {
    const keys = t.keys;
    if (!keys) return;
    for (let ci = 0; ci < t.chunks.length; ci++) {
      const chunk = t.chunks[ci];
      if (!chunk) continue;
      let kept = 0;
      for (let s = 0; s < chunk.length; s++) {
        const rec = chunk[s];
        if (!rec) continue;
        if (rec.offset < t.tail || (rec.key !== undefined && keys.get(rec.key) !== rec.offset)) {
          chunk[s] = undefined;
          if (rec.offset >= t.tail) t.live--;
        } else {
          kept++;
        }
      }
      if (kept === 0) t.chunks[ci] = null;
    }
    t.dirty = 0;
    while (t.tail < t.head && !this.#at(t, t.tail)) {
      t.tail = this.#chunkOf(t, t.tail)
        ? t.tail + 1
        : (Math.floor(t.tail / this.#size) + 1) * this.#size;
    }
    t.tail = Math.min(t.tail, t.head);
    this.#freeChunks(t);
  }

  #chunkOf(t: Topic, offset: number): Chunk | undefined {
    return t.chunks[Math.floor(offset / this.#size) - t.base];
  }

  #at(t: Topic, offset: number): BusRecord | undefined {
    return this.#chunkOf(t, offset)?.[offset % this.#size];
  }

  /** Frees whole chunks below the tail. */
  #freeChunks(t: Topic): void {
    const keep = Math.floor(t.tail / this.#size);
    const drop = Math.min(keep - t.base, t.chunks.length);
    if (drop > 0) {
      t.chunks.splice(0, drop);
      t.base += drop;
    }
    if (t.chunks.length === 0) t.base = Math.floor(t.head / this.#size);
  }

  /** Chunks held for a topic, for tests and metrics. */
  chunkCount(topic: string): number {
    return this.#topic(topic).chunks.length;
  }
}
