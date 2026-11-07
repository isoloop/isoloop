import { HEADER, crc32, frameOffset } from './frame';

export type SegmentScan = {
  /** Every intact frame, in file order, as views into the scanned bytes. */
  frames: Uint8Array[];
  /** Bytes up to the end of the last intact frame. Past it is a torn tail. */
  valid: number;
  /** Frames inside the segment that failed their CRC and were skipped. */
  skipped: number;
};

/** Whether an intact frame starts at `at`, or the bytes end there. */
function intactAt(bytes: Uint8Array, view: DataView, at: number): boolean {
  if (at === bytes.length) return true;
  if (at + HEADER > bytes.length) return false;
  const end = at + HEADER + view.getUint32(at, true);
  return end <= bytes.length && crc32(bytes, at + HEADER, end) === view.getUint32(at + 4, true);
}

/**
 * Recovery's scan of one segment (M2b task 7). Like `scanFrames`, but a frame
 * that fails its CRC in the middle of a segment (a flipped byte) is skipped
 * when an intact frame follows where its length says it ends, so the records
 * after it are kept. A frame that can't be stepped over, because it runs past
 * the end or what follows isn't a frame either, ends the scan: everything from
 * there is a torn tail.
 */
export function scanSegment(bytes: Uint8Array): SegmentScan {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames: Uint8Array[] = [];
  let at = 0;
  let valid = 0;
  let skipped = 0;
  while (at + HEADER <= bytes.length) {
    const length = view.getUint32(at, true);
    const end = at + HEADER + length;
    if (length < 8 || end > bytes.length) break;
    if (crc32(bytes, at + HEADER, end) === view.getUint32(at + 4, true)) {
      frames.push(bytes.subarray(at, end));
      valid = end;
    } else if (end < bytes.length && intactAt(bytes, view, end)) {
      skipped++;
      valid = end;
    } else break;
    at = end;
  }
  return { frames, valid, skipped };
}

/** The offset after the last intact frame of a scan, or `fallback` when it has none. */
export function nextOffset(scan: SegmentScan, fallback: number): number {
  const last = scan.frames.at(-1);
  return last ? frameOffset(last) + 1 : fallback;
}
