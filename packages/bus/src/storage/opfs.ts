import type { LogStorage, StoredState } from '../engine/types';
import { frameOffset, pack, scanFrames, unpack } from './frame';

/** Segment files roll over past this size (design §6.2). */
export const SEGMENT_BYTES: number = 4 * 1024 * 1024;
/** Group commit: a batch is written after this long… */
export const COMMIT_MS = 5;
/** …or once it holds this many records, whichever comes first. */
export const COMMIT_RECORDS = 256;

export type OpfsStorageOptions = {
  /** Directory the topics live under. Default `isoloop/topics` in the origin's OPFS root. */
  root?: FileSystemDirectoryHandle;
  segmentBytes?: number;
  commitMs?: number;
  commitRecords?: number;
};

/** The segment being appended to, held open: sync access handles are exclusive. */
type Active = { name: string; handle: FileSystemSyncAccessHandle; size: number };

type TopicFiles = {
  dir: FileSystemDirectoryHandle;
  /** Generation of the newest offsets slot written; 0 before the first. */
  generation: number;
  /** First offset of each segment, ascending; the file is named after it. */
  segments: number[];
  active: Active | undefined;
};

const SEGMENT = /^(\d{16})\.seg$/;

// Committed offsets: two slot files written in turn, each one frame holding a
// generation and the offsets. A write killed halfway leaves a torn slot, and
// the other one, a generation older, is read instead: the old offsets or the
// new ones, never half. OPFS has no atomic rename for this.
const SLOTS = ['offsets.0', 'offsets.1'] as const;

type Commits = Record<string, number>;

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
    } catch {
      continue;
    }
    const frame = scanFrames(bytes).frames[0];
    if (!frame) continue;
    const generation = frameOffset(frame);
    const commits = unpack(frame);
    if (generation > best.generation && isCommits(commits)) best = { generation, commits };
  }
  return best;
}
const segmentName = (first: number): string => `${String(first).padStart(16, '0')}.seg`;

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
  const handle = await file.createSyncAccessHandle();
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
  readonly #opts: Required<Omit<OpfsStorageOptions, 'root'>>;
  #root: FileSystemDirectoryHandle | undefined;
  readonly #rootOption: FileSystemDirectoryHandle | undefined;
  readonly #topics = new Map<string, TopicFiles>();
  readonly #pending = new Map<string, Uint8Array[]>();
  /** Offsets to write at the next commit, per topic: the latest call wins. */
  readonly #offsets = new Map<string, Commits>();
  #count = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #waiters: { resolve: () => void; reject: (e: Error) => void }[] = [];
  /** A failed commit fails every flush after it: the files may be behind memory. */
  #failed: Error | undefined;
  /** Commits run one at a time, in order: opening a segment is async. */
  #chain: Promise<void> = Promise.resolve();

  constructor(opts: OpfsStorageOptions = {}) {
    this.#rootOption = opts.root;
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

  async open(): Promise<StoredState> {
    const root = (this.#root ??= this.#rootOption ?? (await defaultRoot()));
    const state: StoredState = { topics: [], offsets: {} };
    const found = await Promise.all(
      (await names(root)).map(async (entry) => {
        const topic = decodeURIComponent(entry);
        const files = await this.#files(topic);
        const saved = await readOffsets(files.dir);
        files.generation = saved.generation;
        if (Object.keys(saved.commits).length > 0) state.offsets[topic] = saved.commits;
        const first = files.segments[0];
        const last = files.segments.at(-1);
        if (first === undefined || last === undefined) return undefined;
        const { frames } = scanFrames(await readFile(files.dir, segmentName(last)));
        const lastFrame = frames.at(-1);
        const head = lastFrame ? frameOffset(lastFrame) + 1 : last;
        return { topic, tail: first, head };
      }),
    );
    for (const t of found) if (t) state.topics.push(t);
    return state;
  }

  async #files(topic: string): Promise<TopicFiles> {
    const known = this.#topics.get(topic);
    if (known) return known;
    const root = (this.#root ??= this.#rootOption ?? (await defaultRoot()));
    const dir = await root.getDirectoryHandle(dirName(topic), { create: true });
    const segments: number[] = [];
    for (const name of await names(dir)) {
      const m = SEGMENT.exec(name);
      if (m?.[1] !== undefined) segments.push(Number(m[1]));
    }
    segments.sort((a, b) => a - b);
    const files: TopicFiles = { dir, generation: 0, segments, active: undefined };
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
    if (this.#count === 0 && this.#offsets.size === 0) return Promise.resolve();
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
    const waiters = this.#waiters;
    this.#pending.clear();
    this.#offsets.clear();
    this.#count = 0;
    this.#waiters = [];
    this.#chain = this.#chain.then(() => this.#run(batch, offsets, waiters));
    return this.#chain;
  }

  async #run(
    batch: [string, Uint8Array[]][],
    offsets: [string, Commits][],
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
    const handle = await file.createSyncAccessHandle();
    const active: Active = { name, handle, size: handle.getSize() };
    files.active = active;
    files.segments.push(first);
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
    const frame = pack(generation, commits);
    const file = await files.dir.getFileHandle(slot, { create: true });
    const handle = await file.createSyncAccessHandle();
    try {
      handle.write(frame, { at: 0 });
      handle.truncate(frame.length);
      handle.flush();
    } finally {
      handle.close();
    }
    files.generation = generation;
  }

  rewrite(_topic: string, _keep: (offset: number) => boolean): Promise<void> {
    // M2b tasks 9 and 10.
    return Promise.resolve();
  }

  /** The frames of the segment holding `fromOffset`, from that offset on. */
  async readSegment(topic: string, fromOffset: number): Promise<Uint8Array[]> {
    const files = await this.#files(topic);
    let first: number | undefined;
    for (const s of files.segments) if (s <= fromOffset) first = s;
    if (first === undefined) first = files.segments[0];
    if (first === undefined) return [];
    const name = segmentName(first);
    const bytes =
      files.active?.name === name ? readAll(files.active.handle) : await readFile(files.dir, name);
    return scanFrames(bytes).frames.filter((f) => frameOffset(f) >= fromOffset);
  }

  quarantineNewest(): Promise<string[]> {
    // M2b task 12.
    return Promise.resolve([]);
  }

  /** Segment files of a topic, oldest first. For tests and metrics. */
  async segments(topic: string): Promise<string[]> {
    return (await this.#files(topic)).segments.map(segmentName);
  }

  /** Writes what's pending, then releases every file handle. */
  async close(): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    if (this.#count > 0 || this.#offsets.size > 0) void this.#commit();
    await this.#chain;
    for (const files of this.#topics.values()) {
      files.active?.handle.close();
      files.active = undefined;
    }
    this.#topics.clear();
  }
}
