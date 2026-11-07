import { nextOffset, scanSegment } from './recover';

const SEGMENT = /^(\d{16})(?:\.\d+)?\.seg$/;

/**
 * A segment set aside by safe mode: `<segment>.to-<next offset>.quarantined`.
 * No longer a segment, still on disk. The name keeps the offset after its
 * last record, so offsets the segment used are never handed out again (I5).
 */
export const QUARANTINED: RegExp = /\.to-(\d{16})\.quarantined$/;

const quarantinedName = (segment: string, next: number): string =>
  `${segment}.to-${String(next).padStart(16, '0')}.quarantined`;

/** The offset after every segment set aside in a topic's directory; 0 when none is. */
export function quarantinedHead(names: Iterable<string>): number {
  let head = 0;
  for (const name of names) {
    const m = QUARANTINED.exec(name);
    if (m?.[1] !== undefined) head = Math.max(head, Number(m[1]));
  }
  return head;
}

async function readWhole(dir: FileSystemDirectoryHandle, name: string): Promise<Uint8Array> {
  const src = await (await dir.getFileHandle(name)).createSyncAccessHandle();
  try {
    const bytes = new Uint8Array(src.getSize());
    src.read(bytes, { at: 0 });
    return bytes;
  } finally {
    src.close();
  }
}

async function write(dir: FileSystemDirectoryHandle, to: string, bytes: Uint8Array): Promise<void> {
  const dst = await (await dir.getFileHandle(to, { create: true })).createSyncAccessHandle();
  try {
    dst.write(bytes, { at: 0 });
    dst.truncate(bytes.length);
    dst.flush();
  } finally {
    dst.close();
  }
}

/**
 * Safe mode (ADR 0007, decision 5; M2b task 12): sets the newest segment of
 * every topic under `root` aside, so the bus starts from the one before it.
 * The segment is copied to its quarantined name and only then removed, so a
 * crash halfway leaves it in place, and it is never deleted. Returns the
 * quarantined segments as `<topic>/<name>`.
 */
export async function quarantineNewest(root: FileSystemDirectoryHandle): Promise<string[]> {
  const out: string[] = [];
  for await (const [entry, handle] of root.entries()) {
    if (handle.kind !== 'directory') continue;
    const dir = await root.getDirectoryHandle(entry);
    let newest: { first: number; name: string } | undefined;
    for await (const name of dir.keys()) {
      const m = SEGMENT.exec(name);
      if (m?.[1] === undefined) continue;
      const first = Number(m[1]);
      if (!newest || first > newest.first) newest = { first, name };
    }
    if (!newest) continue;
    const bytes = await readWhole(dir, newest.name);
    // Frame headers only: the record that crashed the bus is never decoded.
    const next = nextOffset(scanSegment(bytes), newest.first);
    await write(dir, quarantinedName(newest.name, next), bytes);
    await dir.removeEntry(newest.name);
    out.push(`${decodeURIComponent(entry)}/${newest.name}`);
  }
  out.sort();
  return out;
}
