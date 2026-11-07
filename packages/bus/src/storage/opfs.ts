import type { LogStorage, StoredState } from '../engine/types';
import { decodeFrame, frameOffset, pack, scanFrames, unpack } from './frame';
import { syncHandle } from './handle';
import { nextOffset, scanSegment } from './recover';
import { quarantineNewest, quarantinedHead } from './safe-mode';

/** Segment files roll over past this size (design §6.2). */
export const SEGMENT_BYTES: number = 4 * 1024 * 1024;
/** Group commit: a batch is written after this long… */
export const COMMIT_MS = 5;
/** …or once it holds this many records, whichever comes first. */
export const COMMIT_RECORDS = 256;

/** Where a compaction has got to; the test hook stops there to stand in for a crash. */
export type CompactionStep = 'begin' | 'output' | 'done';

export type OpfsStorageOptions = {
  /** Directory the topics live under. Default `isoloop/topics` in the origin's OPFS root. */
  root?: FileSystemDirectoryHandle;
  segmentBytes?: number;
  commitMs?: number;
  commitRecords?: number;
  /** Tests only: awaited at each step of a compaction. */
  onCompactionStep?: (step: CompactionStep) => void | Promise<void>;
};

/** A segment file: its first offset, and its name. */
type Seg = { first: number; name: string };

/** The segment being appended to, held open: sync access handles are exclusive. */
type Active = { name: string; handle: FileSystemSyncAccessHandle; size: number };

type TopicFiles = {
  dir: FileSystemDirectoryHandle;
  /** Generation of the newest offsets slot written; 0 before the first. */
  generation: number;
  /** Ascending by first offset; ranges never overlap. */
  segments: Seg[];
  active: Active | undefined;
  /** Highest compaction generation in a segment name. */
  compactions: number;
  /** Retention waiting for a running compaction to finish. */
  deferredDrop: number | undefined;
  /** The offset after every segment safe mode set aside; 0 when none is. */
  quarantined: number;
};

// A segment is named after its first offset. A compaction's output also
// carries the compaction's generation, so it never takes the name of a
// segment it replaces: `0000000000000000.3.seg`.
const SEGMENT = /^(\d{16})(?:\.(\d+))?\.seg$/;

// Compaction (M2b task 10) writes its output next to the segments it
// replaces, then swaps. Two marker frames make a crash at any point safe:
// `compact.begin` (the generation) is on disk before any output, and
// `compact.done` (the generation and the replaced segments) once all output
// is. On open, a `done` finishes the swap and a lone `begin` rolls it back by
// deleting that generation's output, so a crash leaves the old segments or
// the new ones, never both.
const BEGIN = 'compact.begin';
const DONE = 'compact.done';

// Committed offsets: two slot files written in turn, each one frame holding a
// generation and the offsets. A write killed halfway leaves a torn slot, and
// the other one, a generation older, is read instead: the old offsets or the
// new ones, never half. OPFS has no atomic rename for this.
const SLOTS = ['offsets.0', 'offsets.1'] as const;

type Commits = Record<string, number>;

/** The file isn't there. Any other error (one still held, I/O) is not the same as missing. */
const notFound = (e: unknown): boolean => e instanceof DOMException && e.name === 'NotFoundError';

/** Whether compaction keeps a record, from its offset and key. */
type Keep = (offset: number, key: string | undefined) => boolean;

const isCommits = (x: unknown): x is Commits =>
  typeof x === 'object' &&
  x !== null &&
  !Array.isArray(x) &&
  Object.values(x).every((v) => typeof v === 'number');

/** The newest intact slot of a topic: its generation and offsets. */
async function readOffsets(
  dir: FileSystemDirectoryHandle,
): Promise<{ generation: number; commits: Commits }> {
  let best = { generation: 0, commits: {} };
  for (const slot of SLOTS) {
    let bytes: Uint8Array;
    try {
      // oxlint-disable-next-line no-await-in-loop -- two small files
      bytes = await readFile(dir, slot);
    } catch (e) {
      if (notFound(e)) continue;
      throw e;
    }
    const frame = scanFrames(bytes).frames[0];
    if (!frame) continue;
    const generation = frameOffset(frame);
    const commits = unpack(frame);
    if (generation > best.generation && isCommits(commits)) best = { generation, commits };
  }
  return best;
}
const segmentName = (first: number, generation = 0): string =>
  `${String(first).padStart(16, '0')}${generation > 0 ? `.${generation}` : ''}.seg`;

/** A marker frame: its generation and, for `done`, the segments it replaced. */
async function readMarker(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<{ generation: number; replaced: string[] } | undefined> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(dir, name);
  } catch (e) {
    if (notFound(e)) return undefined;
    throw e;
  }
  const frame = scanFrames(bytes).frames[0];
  if (!frame) return undefined;
  const value = unpack(frame);
  const replaced = Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : [];
  return { generation: frameOffset(frame), replaced };
}

/** Writes a whole small file and flushes it. */
async function writeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  bytes: Uint8Array,
): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const handle = await syncHandle(file);
  try {
    handle.write(bytes, { at: 0 });
    handle.truncate(bytes.length);
    handle.flush();
  } finally {
    handle.close();
  }
}

/** Deletes a file; one already gone is fine. */
async function remove(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await dir.removeEntry(name);
  } catch (e) {
    if (!notFound(e)) throw e;
  }
}

/** Topic names may hold characters a file name can't. */
const dirName = (topic: string): string => encodeURIComponent(topic);

async function defaultRoot(): Promise<FileSystemDirectoryHandle> {
  const origin = await navigator.storage.getDirectory();
  const isoloop = await origin.getDirectoryHandle('isoloop', { create: true });
  return isoloop.getDirectoryHandle('topics', { create: true });
}

async function names(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const out: string[] = [];
  for await (const name of dir.keys()) out.push(name);
  return out;
}

/** Reads a whole file through a sync access handle, closing it after. */
async function readFile(dir: FileSystemDirectoryHandle, name: string): Promise<Uint8Array> {
  const file = await dir.getFileHandle(name);
  const handle = await syncHandle(file);
  try {
    return readAll(handle);
  } finally {
    handle.close();
  }
}

function readAll(handle: FileSystemSyncAccessHandle): Uint8Array {
  const bytes = new Uint8Array(handle.getSize());
  handle.read(bytes, { at: 0 });
  return bytes;
}

/**
 * Persistent topics in the Origin Private File System (ADR 0007, design §6.2).
 * One directory per topic, holding segment files of length-prefixed, CRC'd
 * frames (frame.ts), each named after its first offset. Writes go through
 * sync access handles, so this runs in a dedicated worker only: the bus
 * worker.
 *
 * `appendBatch` buffers; a group commit writes the buffer every `commitMs` or
 * every `commitRecords` records, and `flush()` resolves once everything
 * appended before it is written and flushed to disk.
 */
export class OpfsStorage implements LogStorage {
  readonly kind = 'opfs' as const;
  readonly #opts: Required<Omit<OpfsStorageOptions, 'root' | 'onCompactionStep'>>;
  readonly #onStep: OpfsStorageOptions['onCompactionStep'];
  #root: FileSystemDirectoryHandle | undefined;
  readonly #rootOption: FileSystemDirectoryHandle | undefined;
  readonly #topics = new Map<string, TopicFiles>();
  readonly #pending = new Map<string, Uint8Array[]>();
  /** Offsets to write at the next commit, per topic: the latest call wins. */
  readonly #offsets = new Map<string, Commits>();
  /** Retention to apply after the next commit's writes, per topic. */
  readonly #drops = new Map<string, number>();
  #count = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #waiters: { resolve: () => void; reject: (e: Error) => void }[] = [];
  /** A failed commit fails every flush after it: the files may be behind memory. */
  #failed: Error | undefined;
  /** Commits run one at a time, in order: opening a segment is async. */
  #chain: Promise<void> = Promise.resolve();
  /** Per topic: the compaction running, and the one queued behind it. */
  readonly #rewrites = new Map<
    string,
    { running: Promise<void>; queued?: { keep: Keep; promise: Promise<void> } | undefined }
  >();
  #closing = false;

  constructor(opts: OpfsStorageOptions = {}) {
    this.#rootOption = opts.root;
    this.#onStep = opts.onCompactionStep;
    this.#opts = {
      segmentBytes: opts.segmentBytes ?? SEGMENT_BYTES,
      commitMs: opts.commitMs ?? COMMIT_MS,
      commitRecords: opts.commitRecords ?? COMMIT_RECORDS,
    };
  }

  /** Whether this context can use OPFS sync access handles at all. */
  static available(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.storage?.getDirectory === 'function' &&
      typeof FileSystemFileHandle !== 'undefined' &&
      'createSyncAccessHandle' in FileSystemFileHandle.prototype
    );
  }

  /**
   * Recovery (M2b task 7): finds every topic on disk, truncates a torn tail
   * off each topic's newest segment, and restores committed offsets. A frame
   * corrupted inside a segment is skipped on every read (recover.ts).
   */
  async open(): Promise<StoredState> {
    const root = (this.#root ??= this.#rootOption ?? (await defaultRoot()));
    const state: StoredState = { topics: [], offsets: {} };
    const found = await Promise.all(
      (await names(root)).map(async (entry) => {
        const topic = decodeURIComponent(entry);
        const files = await this.#files(topic);
        await this.#settleCompaction(files);
        const saved = await readOffsets(files.dir);
        files.generation = saved.generation;
        if (Object.keys(saved.commits).length > 0) state.offsets[topic] = saved.commits;
        const first = files.segments[0];
        const last = files.segments.at(-1);
        // Offsets a quarantined segment used are skipped, never reused (I5).
        const floor = files.quarantined;
        if (first === undefined || last === undefined)
          return floor > 0 ? { topic, tail: floor, head: floor } : undefined;
        const head = Math.max(floor, await this.#recoverNewest(files, last));
        return { topic, tail: first.first, head };
      }),
    );
    for (const t of found) if (t) state.topics.push(t);
    state.topics.sort((a, b) => (a.topic < b.topic ? -1 : 1));
    return state;
  }

  /** Truncates the newest segment after its last intact frame; returns the head. */
  async #recoverNewest(files: TopicFiles, seg: Seg): Promise<number> {
    const handle = await syncHandle(await files.dir.getFileHandle(seg.name));
    try {
      const bytes = readAll(handle);
      const scan = scanSegment(bytes);
      if (scan.valid < bytes.length) {
        handle.truncate(scan.valid);
        handle.flush();
      }
      return nextOffset(scan, seg.first);
    } finally {
      handle.close();
    }
  }

  async #files(topic: string): Promise<TopicFiles> {
    const known = this.#topics.get(topic);
    if (known) return known;
    const root = (this.#root ??= this.#rootOption ?? (await defaultRoot()));
    const dir = await root.getDirectoryHandle(dirName(topic), { create: true });
    const segments: Seg[] = [];
    let compactions = 0;
    const all = await names(dir);
    for (const name of all) {
      const m = SEGMENT.exec(name);
      if (m?.[1] === undefined) continue;
      segments.push({ first: Number(m[1]), name });
      compactions = Math.max(compactions, Number(m[2] ?? 0));
    }
    segments.sort((a, b) => a.first - b.first);
    const files: TopicFiles = {
      dir,
      generation: 0,
      segments,
      active: undefined,
      compactions,
      deferredDrop: undefined,
      quarantined: quarantinedHead(all),
    };
    this.#topics.set(topic, files);
    return files;
  }

  appendBatch(topic: string, encoded: Uint8Array[]): void {
    let list = this.#pending.get(topic);
    if (!list) {
      list = [];
      this.#pending.set(topic, list);
    }
    for (const frame of encoded) list.push(frame);
    this.#count += encoded.length;
    if (this.#count >= this.#opts.commitRecords) this.#commitSoon(0);
    else this.#commitSoon(this.#opts.commitMs);
  }

  flush(): Promise<void> {
    if (this.#failed !== undefined) return Promise.reject(this.#failed);
    if (this.#count === 0 && this.#offsets.size === 0 && this.#drops.size === 0) {
      // Nothing waiting, but a commit may still be writing: wait for it.
      return this.#chain.then(() => {
        if (this.#failed !== undefined) throw this.#failed;
      });
    }
    return new Promise((resolve, reject) => this.#waiters.push({ resolve, reject }));
  }

  #commitSoon(ms: number): void {
    if (this.#timer !== undefined) {
      if (ms > 0) return;
      clearTimeout(this.#timer);
    }
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#commit();
    }, ms);
  }

  /** Takes the pending batch and queues its write behind any commit still running. */
  #commit(): Promise<void> {
    const batch = [...this.#pending];
    const offsets = [...this.#offsets];
    const drops = [...this.#drops];
    const waiters = this.#waiters;
    this.#pending.clear();
    this.#offsets.clear();
    this.#drops.clear();
    this.#count = 0;
    this.#waiters = [];
    this.#chain = this.#chain.then(() => this.#run(batch, offsets, drops, waiters));
    return this.#chain;
  }

  async #run(
    batch: [string, Uint8Array[]][],
    offsets: [string, Commits][],
    drops: [string, number][],
    waiters: { resolve: () => void; reject: (e: Error) => void }[],
  ): Promise<void> {
    try {
      if (this.#failed !== undefined) throw this.#failed;
      for (const [topic, frames] of batch) {
        // Topics commit one after another, in order.
        // oxlint-disable-next-line no-await-in-loop
        const files = this.#topics.get(topic) ?? (await this.#files(topic));
        // oxlint-disable-next-line no-await-in-loop
        await this.#write(files, frames);
      }
      // Offsets after records, so a commit never points past what's on disk.
      for (const [topic, commits] of offsets) {
        // oxlint-disable-next-line no-await-in-loop
        const files = this.#topics.get(topic) ?? (await this.#files(topic));
        // oxlint-disable-next-line no-await-in-loop
        await this.#writeOffsets(files, commits);
      }
      for (const [topic, tail] of drops) {
        // oxlint-disable-next-line no-await-in-loop
        const files = this.#topics.get(topic) ?? (await this.#files(topic));
        if (this.#rewrites.has(topic)) {
          // The compaction may be reading these segments; it drops them after its swap.
          files.deferredDrop = Math.max(tail, files.deferredDrop ?? 0);
          continue;
        }
        // oxlint-disable-next-line no-await-in-loop
        await this.#drop(files, tail);
      }
      for (const w of waiters) w.resolve();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.#failed = err;
      for (const w of waiters) w.reject(err);
    }
  }

  /** Writes frames to a topic's segments, rolling over at `segmentBytes`. */
  async #write(files: TopicFiles, frames: Uint8Array[]): Promise<void> {
    let i = 0;
    while (i < frames.length) {
      const first = frames[i] ?? new Uint8Array();
      let active = files.active;
      if (!active || (active.size > 0 && active.size + first.length > this.#opts.segmentBytes)) {
        // oxlint-disable-next-line no-await-in-loop -- one roll at a time
        active = await this.#roll(files, frameOffset(first));
      }
      // As many frames as fit in this segment, in one write.
      let bytes = 0;
      let j = i;
      while (j < frames.length) {
        const len = frames[j]?.length ?? 0;
        if (j > i && active.size + bytes + len > this.#opts.segmentBytes) break;
        bytes += len;
        j++;
      }
      const chunk = new Uint8Array(bytes);
      let at = 0;
      for (let k = i; k < j; k++) {
        const f = frames[k] ?? new Uint8Array();
        chunk.set(f, at);
        at += f.length;
      }
      const written = active.handle.write(chunk, { at: active.size });
      if (written !== bytes) throw new Error(`short write: ${written} of ${bytes} bytes`);
      active.size += bytes;
      active.handle.flush();
      i = j;
    }
  }

  async #roll(files: TopicFiles, first: number): Promise<Active> {
    if (files.active) {
      files.active.handle.flush();
      files.active.handle.close();
    }
    const name = segmentName(first);
    const file = await files.dir.getFileHandle(name, { create: true });
    const handle = await syncHandle(file);
    const active: Active = { name, handle, size: handle.getSize() };
    files.active = active;
    files.segments.push({ first, name });
    return active;
  }

  saveOffsets(offsets: Record<string, Record<string, number>>): void {
    for (const [topic, commits] of Object.entries(offsets))
      this.#offsets.set(topic, { ...commits });
    this.#commitSoon(this.#opts.commitMs);
  }

  /** Writes the next generation to the slot not holding the newest one. */
  async #writeOffsets(files: TopicFiles, commits: Commits): Promise<void> {
    const generation = files.generation + 1;
    const slot = SLOTS[generation % 2] ?? SLOTS[0];
    await writeFile(files.dir, slot, pack(generation, commits));
    files.generation = generation;
  }

  dropBelow(topic: string, tail: number): void {
    // Applied at the next commit, after its writes: the segments to delete
    // may not be written yet.
    this.#drops.set(topic, Math.max(tail, this.#drops.get(topic) ?? 0));
    this.#commitSoon(this.#opts.commitMs);
  }

  /** Deletes a topic's segments whose records all sit below `tail`. */
  async #drop(files: TopicFiles, tail: number): Promise<void> {
    // A segment's records all sit below the next segment's first offset.
    let n = 0;
    while (n + 1 < files.segments.length && (files.segments[n + 1]?.first ?? 0) <= tail) n++;
    for (const seg of files.segments.splice(0, n)) {
      // oxlint-disable-next-line no-await-in-loop -- one file at a time
      await remove(files.dir, seg.name);
    }
  }

  /**
   * Compaction on disk (M2b task 10): rewrites a topic's sealed segments,
   * keeping the records `keep` accepts, and swaps the output in. The newest
   * segment, which appends go to, is left alone, so appends during a
   * compaction land after it. Runs in the background one segment at a time,
   * each step queued with the commits, so a commit waits for one segment at
   * most. A call while one runs queues one more run, with the latest `keep`.
   */
  rewrite(topic: string, keep: Keep): Promise<void> {
    const state = this.#rewrites.get(topic);
    if (state?.queued) {
      state.queued.keep = keep;
      return state.queued.promise;
    }
    if (state) {
      const queued = {
        keep,
        promise: state.running.then(() => {
          const s = this.#rewrites.get(topic);
          const next = s?.queued?.keep ?? keep;
          if (s) {
            s.queued = undefined;
            s.running = this.#compact(topic, next);
          }
          return s?.running;
        }),
      };
      state.queued = queued;
      return queued.promise;
    }
    const running = this.#compact(topic, keep);
    this.#rewrites.set(topic, { running });
    return running;
  }

  /** The topic's compaction, if one is running or queued; resolves when it ends. */
  compacting(topic: string): Promise<void> {
    const state = this.#rewrites.get(topic);
    return (state?.queued?.promise ?? state?.running ?? Promise.resolve()).then(() => {});
  }

  /** Runs `fn` in the commit chain, between commits. */
  #step<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#chain = this.#chain.then(() => fn().then(resolve, reject));
    });
  }

  async #compact(topic: string, keep: Keep): Promise<void> {
    try {
      await this.#compactOnce(topic, keep);
    } finally {
      const state = this.#rewrites.get(topic);
      if (state && !state.queued) this.#rewrites.delete(topic);
    }
  }

  async #compactOnce(topic: string, keep: Keep): Promise<void> {
    const files = await this.#files(topic);
    // What was appended before the call is compacted too: on disk first.
    await this.flush();
    // A compaction an earlier failure left behind is finished or undone first.
    await this.#step(() => this.#settleCompaction(files));
    // Sealed segments only: the newest one is where appends go.
    const inputs = files.segments.slice(0, -1);
    if (inputs.length === 0) return;
    const generation = files.compactions + 1;
    const replaced: Seg[] = [];
    const outputs: Seg[] = [];
    let out: Active | undefined;
    const closeOut = (): void => {
      out?.handle.flush();
      out?.handle.close();
      out = undefined;
    };
    let begun = false;
    let done = false;
    try {
      for (const input of inputs) {
        if (this.#closing) throw new Error('storage closed');
        // oxlint-disable-next-line no-await-in-loop -- one segment per step
        const wrote = await this.#step(async () => {
          const frames = scanSegment(await readFile(files.dir, input.name)).frames;
          const kept = frames.filter((f) => {
            const rec = decodeFrame(f);
            return keep(rec.offset, rec.key);
          });
          if (kept.length === frames.length) {
            // Nothing to drop: the segment stays, and output after it starts a new file.
            closeOut();
            return false;
          }
          if (!begun) {
            await writeFile(files.dir, BEGIN, pack(generation, []));
            files.compactions = generation;
            begun = true;
          }
          replaced.push(input);
          for (const f of kept) {
            if (!out || (out.size > 0 && out.size + f.length > this.#opts.segmentBytes)) {
              closeOut();
              const seg = { first: frameOffset(f), name: segmentName(frameOffset(f), generation) };
              // oxlint-disable-next-line no-await-in-loop -- output files open one at a time
              const file = await files.dir.getFileHandle(seg.name, { create: true });
              // oxlint-disable-next-line no-await-in-loop
              const handle = await syncHandle(file);
              out = { name: seg.name, handle, size: 0 };
              outputs.push(seg);
            }
            const n = out.handle.write(f, { at: out.size });
            if (n !== f.length) throw new Error(`short write: ${n} of ${f.length} bytes`);
            out.size += n;
          }
          out?.handle.flush();
          return true;
        });
        if (wrote) {
          // oxlint-disable-next-line no-await-in-loop
          await this.#onStep?.(replaced.length === 1 ? 'begin' : 'output');
        }
      }
      if (!begun) return;
      await this.#step(() => {
        closeOut();
        return Promise.resolve();
      });
      // Whatever superseded a dropped record was appended before `keep` said
      // so: once that is on disk, the swap can't lose a key.
      await this.flush();
      await this.#step(async () => {
        await writeFile(
          files.dir,
          DONE,
          pack(
            generation,
            replaced.map((s) => s.name),
          ),
        );
        done = true;
      });
      await this.#onStep?.('done');
      await this.#step(async () => {
        const gone = new Set(replaced.map((s) => s.name));
        const segments = files.segments.filter((s) => !gone.has(s.name));
        segments.push(...outputs);
        segments.sort((a, b) => a.first - b.first);
        files.segments = segments;
        await this.#settleCompaction(files);
        if (files.deferredDrop !== undefined) {
          await this.#drop(files, files.deferredDrop);
          files.deferredDrop = undefined;
        }
      });
    } catch (e) {
      // Undone now if possible; otherwise the markers undo or finish it on the next open.
      if (!done && begun) {
        await this.#step(async () => {
          closeOut();
          await this.#settleCompaction(files);
        }).catch(() => {});
      }
      throw e;
    }
  }

  /**
   * Finishes or undoes a compaction from its markers (see BEGIN): with `done`,
   * deletes the segments it replaced; with only `begin`, deletes its output.
   */
  async #settleCompaction(files: TopicFiles): Promise<void> {
    const done = await readMarker(files.dir, DONE);
    const begin = done ? undefined : await readMarker(files.dir, BEGIN);
    const replaced = new Set(done?.replaced);
    const suffix = begin ? `.${begin.generation}.seg` : undefined;
    // With `done`, its replaced segments go; with only `begin`, its output.
    const drop = (s: Seg): boolean =>
      replaced.has(s.name) || (suffix !== undefined && s.name.endsWith(suffix));
    for (const s of files.segments.filter(drop)) {
      // oxlint-disable-next-line no-await-in-loop -- one file at a time
      await remove(files.dir, s.name);
    }
    if (done)
      for (const name of done.replaced) {
        // A replaced segment no longer listed may still be on disk.
        // oxlint-disable-next-line no-await-in-loop
        await remove(files.dir, name);
      }
    files.segments = files.segments.filter((s) => !drop(s));
    await remove(files.dir, DONE);
    await remove(files.dir, BEGIN);
  }

  /**
   * The frames of the segment holding `fromOffset`, from that offset on. When
   * that segment has none left (its tail was corrupt), the next one's. Empty
   * past the newest record.
   */
  async readSegment(topic: string, fromOffset: number): Promise<Uint8Array[]> {
    const files = await this.#files(topic);
    // In the chain, so a compaction's swap never deletes a file mid-read.
    return this.#step(() => this.#readFrom(files, fromOffset));
  }

  async #readFrom(files: TopicFiles, fromOffset: number): Promise<Uint8Array[]> {
    let i = 0;
    while (i + 1 < files.segments.length && (files.segments[i + 1]?.first ?? 0) <= fromOffset) i++;
    for (; i < files.segments.length; i++) {
      const name = files.segments[i]?.name ?? '';
      const bytes =
        files.active?.name === name
          ? readAll(files.active.handle)
          : // oxlint-disable-next-line no-await-in-loop -- usually the first segment answers
            await readFile(files.dir, name);
      const frames = scanSegment(bytes).frames.filter((f) => frameOffset(f) >= fromOffset);
      if (frames.length > 0) return frames;
    }
    return [];
  }

  /** Safe mode: call before `open`. See safe-mode.ts. */
  async quarantineNewest(): Promise<string[]> {
    const root = (this.#root ??= this.#rootOption ?? (await defaultRoot()));
    return quarantineNewest(root);
  }

  /** Segment files of a topic, oldest first. For tests and metrics. */
  async segments(topic: string): Promise<string[]> {
    return (await this.#files(topic)).segments.map((s) => s.name);
  }

  /** Writes what's pending, then releases every file handle. */
  async close(): Promise<void> {
    // A running compaction stops at its next step and is undone.
    this.#closing = true;
    await Promise.all(
      [...this.#rewrites.values()].map((s) => (s.queued?.promise ?? s.running).catch(() => {})),
    );
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    if (this.#count > 0 || this.#offsets.size > 0 || this.#drops.size > 0) void this.#commit();
    await this.#chain;
    for (const files of this.#topics.values()) {
      files.active?.handle.close();
      files.active = undefined;
    }
    this.#topics.clear();
  }
}
