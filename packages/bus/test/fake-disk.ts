import type { LogStorage, StoredState } from '../src/engine/types';
import { frameOffset } from '../src/storage/frame';

/**
 * A durable `LogStorage` in memory, for Node tests: frames are kept in
 * segments of `perSegment` frames, the way OpfsStorage keeps them in files,
 * and `readSegment` answers one segment at a time.
 */
export class FakeDisk implements LogStorage {
  readonly kind = 'opfs' as const;
  readonly #segments = new Map<string, Uint8Array[][]>();
  readonly #perSegment: number;
  /** How many `readSegment` calls were made. */
  reads = 0;

  constructor(perSegment = 64) {
    this.#perSegment = perSegment;
  }

  open(): Promise<StoredState> {
    return Promise.resolve({ topics: [], offsets: {} });
  }

  appendBatch(topic: string, encoded: Uint8Array[]): void {
    let segs = this.#segments.get(topic);
    if (!segs) {
      segs = [];
      this.#segments.set(topic, segs);
    }
    for (const frame of encoded) {
      let last = segs.at(-1);
      if (!last || last.length >= this.#perSegment) {
        last = [];
        segs.push(last);
      }
      last.push(frame.slice());
    }
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }

  saveOffsets(_offsets: Record<string, Record<string, number>>): void {}

  dropBelow(topic: string, tail: number): void {
    const segs = this.#segments.get(topic) ?? [];
    while (segs.length > 1 && frameOffset(segs[1]?.[0] ?? new Uint8Array(16)) <= tail) segs.shift();
  }

  rewrite(
    _topic: string,
    _keep: (offset: number, key: string | undefined) => boolean,
  ): Promise<void> {
    return Promise.resolve();
  }

  readSegment(topic: string, fromOffset: number): Promise<Uint8Array[]> {
    this.reads++;
    const segs = this.#segments.get(topic) ?? [];
    let i = 0;
    while (i + 1 < segs.length && frameOffset(segs[i + 1]?.[0] ?? new Uint8Array(16)) <= fromOffset)
      i++;
    for (; i < segs.length; i++) {
      const frames = (segs[i] ?? []).filter((f) => frameOffset(f) >= fromOffset);
      if (frames.length > 0) return Promise.resolve(frames);
    }
    return Promise.resolve([]);
  }

  quarantineNewest(): Promise<string[]> {
    return Promise.resolve([]);
  }
}
