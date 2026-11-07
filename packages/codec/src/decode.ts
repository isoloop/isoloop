import { CodecError } from './errors';
import * as F from './format';

const utf8 = new TextDecoder('utf-8', { fatal: true });

class Reader {
  readonly buf: Uint8Array;
  readonly view: DataView;
  pos = 0;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  need(n: number): void {
    if (this.pos + n > this.buf.length) throw new CodecError('malformed', 'truncated');
  }

  byte(): number {
    this.need(1);
    return this.buf[this.pos++] ?? 0;
  }

  varint(): number {
    let n = 0;
    let scale = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.byte();
      n += (b & 0x7f) * scale;
      if (b < 0x80) {
        if (n > Number.MAX_SAFE_INTEGER) break;
        return n;
      }
      scale *= 0x80;
    }
    throw new CodecError('malformed', 'varint out of range');
  }
}

/**
 * Decodes bytes written by `encode`. Throws a `CodecError` with code
 * `malformed` if they're truncated, carry an unknown tag or have bytes left
 * over.
 */
export function decode(bytes: Uint8Array): unknown {
  const r = new Reader(bytes);
  const v = read(r, 0);
  if (r.pos !== bytes.length) throw new CodecError('malformed', 'trailing bytes');
  return v;
}

function read(r: Reader, depth: number): unknown {
  const tag = r.byte();
  if (tag < F.FIXSTR) return tag;
  if (tag < F.FIXARRAY) return string(r, tag - F.FIXSTR);
  if (tag < F.FIXOBJECT) return array(r, tag - F.FIXARRAY, depth);
  if (tag < F.UNDEFINED) return object(r, tag - F.FIXOBJECT, depth);
  if (tag >= F.NEG_FIXINT) return tag - 0x100;
  switch (tag) {
    case F.UNDEFINED:
      return undefined;
    case F.NULL:
      return null;
    case F.FALSE:
      return false;
    case F.TRUE:
      return true;
    case F.UINT:
      return r.varint();
    case F.NINT:
      return -r.varint() - 1;
    case F.FLOAT64: {
      r.need(8);
      const v = r.view.getFloat64(r.pos, true);
      r.pos += 8;
      return v;
    }
    case F.STR:
      return string(r, r.varint());
    case F.ARRAY:
      return array(r, r.varint(), depth);
    case F.OBJECT:
      return object(r, r.varint(), depth);
    default:
      throw new CodecError('malformed', `unknown tag 0x${tag.toString(16)}`);
  }
}

function utf8Decode(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    throw new CodecError('malformed', 'invalid UTF-8');
  }
}

function string(r: Reader, n: number): string {
  r.need(n);
  const buf = r.buf;
  const start = r.pos;
  r.pos += n;
  // Short ASCII strings (most keys) are faster by hand than through TextDecoder.
  if (n <= 32) {
    let s = '';
    for (let i = start; i < start + n; i++) {
      const b = buf[i] ?? 0;
      if (b >= 0x80) return utf8Decode(buf.subarray(start, start + n));
      s += String.fromCharCode(b);
    }
    return s;
  }
  return utf8Decode(buf.subarray(start, start + n));
}

function nest(depth: number): number {
  if (depth >= F.MAX_DEPTH) throw new CodecError('malformed', `nested deeper than ${F.MAX_DEPTH}`);
  return depth + 1;
}

function array(r: Reader, n: number, depth: number): unknown[] {
  const d = nest(depth);
  // Each item takes at least one byte, so a count past the bytes left is corrupt.
  r.need(n);
  const a: unknown[] = [];
  for (let i = 0; i < n; i++) a.push(read(r, d));
  return a;
}

function object(r: Reader, n: number, depth: number): Record<string, unknown> {
  const d = nest(depth);
  r.need(n * 2);
  const o: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    const k = read(r, d);
    if (typeof k !== 'string') throw new CodecError('malformed', 'object key is not a string');
    const v = read(r, d);
    // An own `__proto__` key must stay a key, not set the prototype.
    if (k === '__proto__') {
      Object.defineProperty(o, k, {
        value: v,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } else o[k] = v;
  }
  return o;
}
