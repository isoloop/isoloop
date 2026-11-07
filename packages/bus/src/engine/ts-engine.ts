import type { BusRecord, TopicConfig } from '@isoloop/protocol';
import { decodeFrame, encodeFrame, frameOffset } from '../storage/frame';
import { MemoryStorage, effectiveDurability } from './memory-storage';
import type {
  AppendId,
  EngineOptions,
  LogEngine,
  LogStorage,
  NewRecord,
  StoredState,
} from './types';

/** Default records per chunk. Chunk `i` holds offsets `[i * size, (i + 1) * size)`. */
export const CHUNK = 4096;

export type TsEngineOptions = EngineOptions & {
  /** Records per chunk. Default 4,096; tests use small chunks to cross boundaries often. */
  chunkSize?: number;
  /** Superseded records before a compacted topic compacts itself. Default 1,024. */
  dirtyMin?: number;
  /**
   * Durable topics: about how many encoded bytes of records each keeps in
   * memory. Older chunks are evicted; `page` reads them back from disk.
   * Default 8 MiB, two segments. The newest chunk always stays.
   */
  residentBytes?: number;
};

/** Default `residentBytes`. */
export const RESIDENT_BYTES: number = 8 * 1024 * 1024;
/** Pages of evicted records kept per engine, newest last. */
const PAGES = 8;

/** Evicted records read back from disk: the retained ones in `[from, to)`. */
type Page = { topic: string; from: number; to: number; records: BusRecord[] };

/** A compacted topic compacts itself once this share of its records is superseded… */
const DIRTY_RATIO = 0.5;
/** …and at least this many are. */
const DIRTY_MIN = 1024;

/** Appends `appended` remembers per producer and topic: the `BusClient`'s inbox limit. */
export const APPENDED_WINDOW = 1000;

/** A producer's recent appends to a durable topic: its epoch, and `seq` → offset. */
type Appended = { epoch: number; seqs: Map<number, number> };

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
  /** The tail the storage was last told to drop below. */
  dropped: number;
  /** Compacted durable topics: superseded records still on disk. */
  diskDirty: number;
  /** Offsets below this were evicted: on disk, not in memory. `base * size` once any are. */
  evictedTo: number;
  /** Durable topics: recent appends per producer, for deduplicating re-sends (ADR 0007, step 5). */
  appended: Map<string, Appended>;
  /** Encoded bytes per chunk, parallel to `chunks` (durable topics). */
  chunkBytes: number[];
  residentBytes: number;
  /** Evicted chunks with retained records, for `time` expiry: where each ends, how many, the newest `ts`. */
  evicted: { end: number; count: number; maxTs: number }[];
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
  readonly #residentBytes: number;
  #pages: Page[] = [];
  readonly #paging = new Map<string, Promise<void>>();
  /** While restoring, records are read back from disk: don't compact it under the read. */
  #restoring = false;

  constructor(opts: TsEngineOptions = {}) {
    this.#now = opts.now ?? Date.now;
    this.#size = opts.chunkSize ?? CHUNK;
    this.#dirtyMin = opts.dirtyMin ?? DIRTY_MIN;
    this.#residentBytes = opts.residentBytes ?? RESIDENT_BYTES;
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
      dropped: 0,
      diskDirty: 0,
      evictedTo: 0,
      chunkBytes: [],
      residentBytes: 0,
      evicted: [],
      appended: new Map(),
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

  append(topic: string, rec: NewRecord, id?: AppendId): number {
    const t = this.#topic(topic);
    // Encoded first: a value the codec refuses throws before anything changes.
    const frame = t.durable ? encodeFrame({ ...rec, ...id, offset: t.head }) : undefined;
    if (frame) this.#storage.appendBatch(topic, [frame]);
    if (t.durable && id) remember(t, rec.producer, id, t.head);
    return this.#place(t, rec, t.head, frame?.length ?? 0);
  }

  appended(topic: string, producer: string, id: AppendId): number | undefined {
    const a = this.#topics.get(topic)?.appended.get(producer);
    return a?.epoch === id.epoch ? a.seqs.get(id.seq) : undefined;
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
    this.#restoring = true;
    try {
      await this.#restoreTopics(state, restored);
    } finally {
      this.#restoring = false;
    }
    // What the restore found superseded on disk is compacted away now.
    for (const { topic } of restored) {
      const t = this.#topic(topic);
      if (t.keys) this.#compactKeys(t);
    }
    return restored;
  }

  async #restoreTopics(
    state: StoredState,
    restored: { topic: string; head: number }[],
  ): Promise<void> {
    for (const { topic, tail, head } of state.topics) {
      const t = this.#topics.get(topic);
      if (!t?.durable) continue;
      if (t.head !== 0) throw new Error(`${topic} isn't empty`);
      t.head = t.tail = t.dropped = tail;
      t.base = Math.floor(tail / this.#size);
      let from = tail;
      while (from < head) {
        // oxlint-disable-next-line no-await-in-loop -- segment by segment, in order
        const frames = await this.#storage.readSegment(topic, from);
        if (frames.length === 0) break;
        for (const f of frames) {
          const { offset, epoch, seq, ...rec } = decodeFrame(f);
          if (epoch !== undefined && seq !== undefined)
            remember(t, rec.producer, { epoch, seq }, offset);
          this.#place(t, rec, offset, f.length);
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
  }

  /** Stores a record at `offset` (≥ head; a gap is left as dropped slots) and applies retention. */
  #place(t: Topic, rec: NewRecord, at: number, bytes: number): number {
    t.head = at + 1;
    const offset = at;
    const ci = Math.floor(offset / this.#size);
    if (t.chunks.length === 0) {
      t.base = ci;
      t.chunkBytes = [];
    }
    let chunk = t.chunks[ci - t.base];
    if (chunk === undefined || chunk === null) {
      chunk = [];
      t.chunks[ci - t.base] = chunk;
    }
    chunk[offset % this.#size] = { ...rec, offset };
    t.live++;
    if (t.durable) {
      t.chunkBytes[ci - t.base] = (t.chunkBytes[ci - t.base] ?? 0) + bytes;
      t.residentBytes += bytes;
      if (t.residentBytes > this.#residentBytes) this.#evict(t);
    }

    const r = t.cfg.retention;
    if (r.kind === 'last-n') {
      if (t.live > r.n) this.#dropBelow(t, t.head - r.n);
    } else if (t.keys && rec.key !== undefined) {
      const prev = t.keys.get(rec.key);
      t.keys.set(rec.key, offset);
      if (prev !== undefined && t.durable) t.diskDirty++;
      if (prev !== undefined && prev >= t.tail && prev < t.evictedTo) {
        // Evicted, so in-memory compaction never sees it: dropped now.
        t.live--;
      } else if (prev !== undefined && prev >= t.tail) {
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
    // Evicted records come from pages; without one, the read stops there (see `readable`).
    while (o < t.evictedTo && out.length < max) {
      const page = this.#pageAt(t, o);
      if (!page) return out;
      for (const rec of page.records) {
        if (out.length >= max) return out;
        if (rec.offset >= o && this.#retained(t, rec)) out.push(rec);
      }
      o = page.to;
    }
    o = Math.max(o, t.evictedTo);
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

  readable(topic: string, fromOffset: number): boolean {
    return this.#unpaged(this.#topic(topic), fromOffset) === undefined;
  }

  /**
   * Where a read from `from` would stop for want of a page: the first evicted
   * offset no page covers, before any retained record. `undefined` when the
   * read can answer.
   */
  #unpaged(t: Topic, from: number): number | undefined {
    let o = Math.max(from, t.tail);
    while (o < t.evictedTo && o < t.head) {
      const page = this.#pageAt(t, o);
      if (!page) return o;
      const at = o;
      if (page.records.some((r) => r.offset >= at && this.#retained(t, r))) return undefined;
      o = page.to;
    }
    return undefined;
  }

  page(topic: string, fromOffset: number): Promise<void> {
    const t = this.#topic(topic);
    const o = this.#unpaged(t, fromOffset);
    if (o === undefined) return Promise.resolve();
    const key = `${topic}\u0000${o}`;
    let p = this.#paging.get(key);
    if (!p) {
      p = this.#readPage(t, o).finally(() => this.#paging.delete(key));
      this.#paging.set(key, p);
    }
    return p;
  }

  /**
   * Reads the segment holding `from` back from disk, and the ones after it
   * until one holds a retained record, up to where eviction ends: a page
   * always answers a read, so paging never goes round in circles.
   */
  async #readPage(t: Topic, from: number): Promise<void> {
    // Evicted records may still be in the storage's buffer.
    await this.#storage.flush();
    const records: BusRecord[] = [];
    let o = from;
    while (o < t.evictedTo && records.length === 0) {
      // oxlint-disable-next-line no-await-in-loop -- segment by segment
      const frames = await this.#storage.readSegment(t.cfg.name, o);
      if (frames.length === 0) break;
      for (const f of frames) {
        const { epoch: _e, seq: _s, ...rec } = decodeFrame(f);
        if (rec.offset >= t.evictedTo) break;
        if (this.#retained(t, rec)) records.push(rec);
        o = rec.offset + 1;
      }
      if (frameOffset(frames.at(-1) ?? new Uint8Array(16)) >= t.evictedTo) break;
    }
    // Past the last frame read, up to the next one on disk, nothing is left.
    const to = records.length > 0 ? o : t.evictedTo;
    this.#pages.push({ topic: t.cfg.name, from, to, records });
    if (this.#pages.length > PAGES) this.#pages.shift();
  }

  #pageAt(t: Topic, offset: number): Page | undefined {
    return this.#pages.find((p) => p.topic === t.cfg.name && p.from <= offset && offset < p.to);
  }

  /** Whether a record read back from disk is still retained in the log. */
  #retained(t: Topic, rec: BusRecord): boolean {
    if (rec.offset < t.tail) return false;
    return !t.keys || rec.key === undefined || t.keys.get(rec.key) === rec.offset;
  }

  /**
   * Evicts the oldest chunks until the topic fits `residentBytes` again
   * (M2b task 11). Every record of a durable topic is on disk, or in the
   * storage's buffer until the next commit; `page` reads them back.
   */
  #evict(t: Topic): void {
    while (t.residentBytes > this.#residentBytes && t.chunks.length > 1) {
      const chunk = t.chunks.shift();
      t.residentBytes -= t.chunkBytes.shift() ?? 0;
      t.base++;
      t.evictedTo = t.base * this.#size;
      let count = 0;
      let maxTs = -Infinity;
      for (const rec of chunk ?? []) {
        if (!rec || rec.offset < t.tail) continue;
        count++;
        maxTs = Math.max(maxTs, rec.ts);
      }
      if (count > 0) t.evicted.push({ end: t.evictedTo, count, maxTs });
    }
  }

  /** Lowest offset held in memory; below it, records are on disk only. For tests and metrics. */
  resident(topic: string): number {
    const t = this.#topic(topic);
    return Math.max(t.tail, t.evictedTo);
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

  flush(o?: { now?: boolean }): Promise<void> {
    return this.#storage.flush(o);
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
    // Evicted chunks expire whole, once their newest record has: their
    // records aren't in memory to check one by one.
    while (o < t.evictedTo) {
      const s = t.evicted[0];
      if (!s) {
        o = t.evictedTo;
        break;
      }
      if (s.maxTs >= cutoff) {
        t.tail = o;
        this.#freeChunks(t);
        return;
      }
      t.live -= s.count;
      t.evicted.shift();
      o = s.end;
    }
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
      if (kept === 0) {
        t.chunks[ci] = null;
        t.residentBytes -= t.chunkBytes[ci] ?? 0;
        t.chunkBytes[ci] = 0;
      }
    }
    t.dirty = 0;
    // Evicted records aren't in memory: the tail can't be moved past them here.
    while (t.tail < t.head && t.tail >= t.evictedTo && !this.#at(t, t.tail)) {
      t.tail = this.#chunkOf(t, t.tail)
        ? t.tail + 1
        : (Math.floor(t.tail / this.#size) + 1) * this.#size;
    }
    t.tail = Math.min(t.tail, t.head);
    this.#freeChunks(t);
    this.#compactDisk(t);
  }

  /**
   * Compaction on disk (M2b task 10), once at least half of what the disk
   * holds for the topic is superseded: the same rule as in memory.
   */
  #compactDisk(t: Topic): void {
    if (!t.durable || this.#restoring || t.diskDirty < this.#dirtyMin || t.diskDirty < t.live)
      return;
    t.diskDirty = 0;
    const keys = t.keys;
    const keep = (offset: number, key: string | undefined): boolean =>
      offset >= t.tail && (key === undefined || keys?.get(key) === offset);
    this.#storage.rewrite(t.cfg.name, keep).catch((e: unknown) => {
      // The old segments are still there; the next compaction tries again.
      console.warn(`[isoloop] compacting ${t.cfg.name} on disk failed`, e);
    });
  }

  #chunkOf(t: Topic, offset: number): Chunk | undefined {
    return t.chunks[Math.floor(offset / this.#size) - t.base];
  }

  #at(t: Topic, offset: number): BusRecord | undefined {
    return this.#chunkOf(t, offset)?.[offset % this.#size];
  }

  /** Frees whole chunks below the tail, and on disk the segments below it. */
  #freeChunks(t: Topic): void {
    if (t.durable && t.tail > t.dropped) {
      t.dropped = t.tail;
      this.#storage.dropBelow(t.cfg.name, t.tail);
    }
    while ((t.evicted[0]?.end ?? Infinity) <= t.tail) t.evicted.shift();
    const keep = Math.floor(t.tail / this.#size);
    const drop = Math.min(keep - t.base, t.chunks.length);
    if (drop > 0) {
      t.chunks.splice(0, drop);
      for (const b of t.chunkBytes.splice(0, drop)) t.residentBytes -= b;
      t.base += drop;
    }
    if (t.chunks.length === 0) {
      t.base = Math.floor(t.head / this.#size);
      t.chunkBytes = [];
      t.residentBytes = 0;
    }
    if (t.evictedTo > 0) t.evictedTo = Math.max(t.evictedTo, t.base * this.#size);
  }

  /** Chunks held for a topic, for tests and metrics. */
  chunkCount(topic: string): number {
    return this.#topic(topic).chunks.length;
  }
}

/** Notes that `producer` appended `id` at `offset`; a new epoch forgets the old one's. */
function remember(t: Topic, producer: string, id: AppendId, offset: number): void {
  let a = t.appended.get(producer);
  if (a?.epoch !== id.epoch) {
    a = { epoch: id.epoch, seqs: new Map() };
    t.appended.set(producer, a);
  }
  a.seqs.set(id.seq, offset);
  if (a.seqs.size > APPENDED_WINDOW) {
    const oldest = a.seqs.keys().next();
    if (!oldest.done) a.seqs.delete(oldest.value);
  }
}
