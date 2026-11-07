import { decode, encode } from '@isoloop/codec';
import type { BusRecord } from '@isoloop/protocol';

// One record on disk (M2b task 5, ADR 0007):
//
//   u32 length   bytes after the 8-byte header
//   u32 crc32    of those bytes
//   f64 offset   the record's offset, readable without decoding the rest
//   ...          the record, `isoloop-codec@1`: [ts, producer, value, key,
//                req, epoch, seq], trailing undefineds left out
//
// Little-endian throughout. A torn write leaves a frame whose length runs past
// the file's end or whose CRC doesn't match; recovery truncates there.
//
// A topic's committed offsets use the same frame (`pack`), with a generation
// number in place of the offset (opfs.ts).

export const HEADER = 8;
const OFFSET = 8;

/**
 * A record as stored: a `BusRecord` plus the publish's `(epoch, seq)`, which
 * deduplicates re-sent publishes after a bus crash (ADR 0007, step 5).
 */
export type StoredRecord = BusRecord & { epoch?: number; seq?: number };

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb8_8320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE 802.3, as in zip and PNG). */
export function crc32(bytes: Uint8Array, start = 0, end: number = bytes.length): number {
  let c = 0xffff_ffff;
  for (let i = start; i < end; i++) c = (TABLE[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffff_ffff) >>> 0;
}

/** A frame: `number` in the header, `value` encoded after it. */
export function pack(number: number, value: unknown): Uint8Array {
  const body = encode(value);
  const out = new Uint8Array(HEADER + OFFSET + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, OFFSET + body.length, true);
  view.setFloat64(HEADER, number, true);
  out.set(body, HEADER + OFFSET);
  view.setUint32(4, crc32(out, HEADER), true);
  return out;
}

/** The value of a frame written by `pack`. */
export function unpack(frame: Uint8Array): unknown {
  return decode(frame.subarray(HEADER + OFFSET));
}

/** Encodes a record as one frame. Throws the codec's `not_encodable`. */
export function encodeFrame(rec: StoredRecord): Uint8Array {
  const fields: unknown[] = [rec.ts, rec.producer, rec.value, rec.key, rec.req, rec.epoch, rec.seq];
  while (fields.length > 3 && fields.at(-1) === undefined) fields.pop();
  return pack(rec.offset, fields);
}

/** The offset in a frame's header. */
export function frameOffset(frame: Uint8Array): number {
  return new DataView(frame.buffer, frame.byteOffset).getFloat64(HEADER, true);
}

export type FrameScan = {
  /** Complete frames, in file order, as views into the scanned bytes. */
  frames: Uint8Array[];
  /** Bytes up to the end of the last complete frame: where a torn tail starts. */
  valid: number;
};

/** Splits bytes into frames, stopping at the first torn or corrupt one. */
export function scanFrames(bytes: Uint8Array): FrameScan {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames: Uint8Array[] = [];
  let at = 0;
  while (at + HEADER <= bytes.length) {
    const length = view.getUint32(at, true);
    const end = at + HEADER + length;
    if (length < OFFSET || end > bytes.length) break;
    if (crc32(bytes, at + HEADER, end) !== view.getUint32(at + 4, true)) break;
    frames.push(bytes.subarray(at, end));
    at = end;
  }
  return { frames, valid: at };
}

const isList = (x: unknown): x is readonly unknown[] => Array.isArray(x);

const isReq = (x: unknown): x is NonNullable<BusRecord['req']> =>
  typeof x === 'object' &&
  x !== null &&
  typeof Reflect.get(x, 'from') === 'string' &&
  typeof Reflect.get(x, 'id') === 'string';

/** Decodes one frame written by `encodeFrame`. */
export function decodeFrame(frame: Uint8Array): StoredRecord {
  const offset = frameOffset(frame);
  const fields = unpack(frame);
  const list = isList(fields) ? fields : [];
  const [ts, producer, value, key, req, epoch, seq] = list;
  if (typeof ts !== 'number' || typeof producer !== 'string') {
    throw new Error(`frame at offset ${offset} is not a record`);
  }
  const rec: StoredRecord = { offset, value, ts, producer };
  if (typeof key === 'string') rec.key = key;
  if (isReq(req)) rec.req = req;
  if (typeof epoch === 'number') rec.epoch = epoch;
  if (typeof seq === 'number') rec.seq = seq;
  return rec;
}
