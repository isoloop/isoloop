import { describe, expect, it } from 'vitest';
import {
  crc32,
  decodeFrame,
  encodeFrame,
  frameOffset,
  scanFrames,
  type StoredRecord,
} from './frame';

const rec = (offset: number, extra: Partial<StoredRecord> = {}): StoredRecord => ({
  offset,
  value: { n: offset },
  ts: 1_000 + offset,
  producer: 'A',
  ...extra,
});

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

describe('frames (M2b task 5)', () => {
  it('crc32 is the IEEE CRC', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf4_3926);
  });

  it('round-trips a record, with every optional field', () => {
    for (const r of [
      rec(0),
      rec(7, { key: 'k' }),
      rec(9, { req: { from: 'B', id: 'm1' }, epoch: 2, seq: 41 }),
    ]) {
      const f = encodeFrame(r);
      expect(frameOffset(f)).toBe(r.offset);
      expect(decodeFrame(f)).toEqual(r);
    }
  });

  it('scans complete frames and stops at a torn or corrupt one', () => {
    const frames = [0, 1, 2].map((o) => encodeFrame(rec(o)));
    const whole = concat(frames);
    expect(scanFrames(whole).frames.map((f) => frameOffset(f))).toEqual([0, 1, 2]);
    expect(scanFrames(whole).valid).toBe(whole.length);

    const torn = whole.subarray(0, whole.length - 3);
    const tornScan = scanFrames(torn);
    expect(tornScan.frames.map((f) => frameOffset(f))).toEqual([0, 1]);
    expect(tornScan.valid).toBe((frames[0]?.length ?? 0) + (frames[1]?.length ?? 0));

    const flipped = whole.slice();
    const at = (frames[0]?.length ?? 0) + 20;
    flipped[at] = (flipped[at] ?? 0) ^ 0xff;
    expect(scanFrames(flipped).frames.map((f) => frameOffset(f))).toEqual([0]);

    expect(scanFrames(new Uint8Array(64)).frames).toEqual([]);
  });
});
