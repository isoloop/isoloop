import { CodecError } from './errors';
import * as F from './format';

// Copied into module consts once: under Vitest's module transform every
// `F.X` would be a property read in the hot loop.
const {
  FIXSTR,
  FIXARRAY,
  FIXOBJECT,
  UNDEFINED,
  NULL,
  FALSE,
  TRUE,
  UINT,
  NINT,
  FLOAT64,
  STR,
  ARRAY,
  OBJECT,
  NEG_FIXINT,
  FIXSTR_MAX,
  MAX_DEPTH,
  BIGINT,
  NBIGINT,
  DATE,
  MAP,
  SET,
  ARRAYBUFFER,
  VIEW,
  VIEW_KINDS,
} = F;

const utf8 = new TextDecoder('utf-8', { fatal: true });

// The decoder's state lives at module level, not on an object: decoding is
// synchronous and runs no user code, so one call at a time uses it, and V8
// keeps module bindings in registers better than fields.
let src: Uint8Array = new Uint8Array(0);
let pos = 0;
let end = 0;

/**
 * Decodes bytes written by `encode`. Throws a `CodecError` with code
 * `malformed` if they're truncated, carry an unknown tag or have bytes left
 * over.
 */
export function decode(bytes: Uint8Array): unknown {
  src = bytes;
  pos = 0;
  end = bytes.length;
  const v = read(0);
  if (pos !== end) throw new CodecError('malformed', 'trailing bytes');
  return v;
}

// float64 through a scratch buffer: cheaper than a DataView per decode call.
// Typed arrays use the platform's byte order; the format is little-endian.
const f64 = new Float64Array(1);
const f64b = new Uint8Array(f64.buffer);
const LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
if (!LE) throw new Error('@isoloop/codec needs a little-endian platform');

const truncated = (): CodecError => new CodecError('malformed', 'truncated');

function byte(): number {
  if (pos >= end) throw truncated();
  return src[pos++] ?? 0;
}

function varint(): number {
  let b = byte();
  if (b < 0x80) return b;
  // The low 28 bits with bit operations, the rest with multiplies.
  let n = b & 0x7f;
  for (let shift = 7; shift < 28; shift += 7) {
    b = byte();
    n |= (b & 0x7f) << shift;
    if (b < 0x80) return n;
  }
  let scale = 0x1000_0000;
  for (let i = 4; i < 8; i++) {
    b = byte();
    n += (b & 0x7f) * scale;
    if (b < 0x80) {
      if (n > Number.MAX_SAFE_INTEGER) break;
      return n;
    }
    scale *= 0x80;
  }
  throw new CodecError('malformed', 'varint out of range');
}

function float64(): number {
  if (pos + 8 > end) throw truncated();
  for (let i = 0; i < 8; i++) f64b[i] = src[pos + i] ?? 0;
  pos += 8;
  return f64[0] ?? 0;
}

function read(depth: number): unknown {
  const tag = byte();
  if (tag < FIXSTR) return tag;
  if (tag < FIXARRAY) return string(tag - FIXSTR);
  if (tag < FIXOBJECT) return array(tag - FIXARRAY, depth);
  if (tag < UNDEFINED) return object(tag - FIXOBJECT, depth);
  if (tag >= NEG_FIXINT) return tag - 0x100;
  switch (tag) {
    case FLOAT64:
      return float64();
    case UNDEFINED:
      return undefined;
    case NULL:
      return null;
    case FALSE:
      return false;
    case TRUE:
      return true;
    case UINT:
      return varint();
    case NINT:
      return -varint() - 1;
    case STR:
      return string(varint());
    case ARRAY:
      return array(varint(), depth);
    case OBJECT:
      return object(varint(), depth);
    case BIGINT:
      return bigint();
    case NBIGINT:
      return -bigint();
    case DATE:
      return new Date(float64());
    case MAP:
      return map(varint(), depth);
    case SET:
      return set(varint(), depth);
    case ARRAYBUFFER:
      return copy(varint());
    case VIEW:
      return typed();
    default:
      throw new CodecError('malformed', `unknown tag 0x${tag.toString(16)}`);
  }
}

function utf8Decode(start: number, stop: number): string {
  try {
    return utf8.decode(src.subarray(start, stop));
  } catch {
    throw new CodecError('malformed', 'invalid UTF-8');
  }
}

// Short strings repeat across records (keys, symbols, enum-like values), so
// the last one read at each slot of a small hash table is kept, bytes and
// string, and reused when the same bytes come again.
const SLOTS = 4096;
const CACHED = 16;
const slotBytes = new Uint8Array(SLOTS * CACHED);
const slotLength = new Uint8Array(SLOTS);
const slotString: string[] = Array.from({ length: SLOTS }, () => '');

function string(n: number): string {
  const start = pos;
  const stop = start + n;
  if (stop > end) throw truncated();
  pos = stop;
  if (n === 0) return '';
  if (n > CACHED) return n > 32 ? utf8Decode(start, stop) : ascii(start, stop);
  let h = n;
  for (let i = start; i < stop; i++) h = (Math.imul(h, 31) + (src[i] ?? 0)) | 0;
  const slot = (h ^ (h >>> 12)) & (SLOTS - 1);
  const base = slot * CACHED;
  if (slotLength[slot] === n) {
    let i = 0;
    while (i < n && slotBytes[base + i] === src[start + i]) i++;
    if (i === n) return slotString[slot] ?? '';
  }
  const s = ascii(start, stop);
  slotBytes.set(src.subarray(start, stop), base);
  slotLength[slot] = n;
  slotString[slot] = s;
  return s;
}

const fcc = String.fromCharCode;

/** Up to 32 bytes: by hand when ASCII, which beats TextDecoder's call overhead. */
function ascii(start: number, stop: number): string {
  let s = '';
  let i = start;
  for (; i + 4 <= stop; i += 4) {
    const a = src[i] ?? 0;
    const b = src[i + 1] ?? 0;
    const c = src[i + 2] ?? 0;
    const d = src[i + 3] ?? 0;
    if ((a | b | c | d) >= 0x80) return utf8Decode(start, stop);
    s += fcc(a, b, c, d);
  }
  for (; i < stop; i++) {
    const a = src[i] ?? 0;
    if (a >= 0x80) return utf8Decode(start, stop);
    s += fcc(a);
  }
  return s;
}

function key(): string {
  const tag = byte();
  if (tag >= FIXSTR && tag <= FIXSTR + FIXSTR_MAX) return string(tag - FIXSTR);
  if (tag === STR) return string(varint());
  throw new CodecError('malformed', 'object key is not a string');
}

function nest(depth: number): number {
  if (depth >= MAX_DEPTH) throw new CodecError('malformed', `nested deeper than ${MAX_DEPTH}`);
  return depth + 1;
}

function array(n: number, depth: number): unknown[] {
  const d = nest(depth);
  // Each item takes at least one byte, so a count past the bytes left is corrupt.
  if (pos + n > end) throw truncated();
  const a: unknown[] = [];
  for (let i = 0; i < n; i++) a.push(read(d));
  return a;
}

function object(n: number, depth: number): Record<string, unknown> {
  const d = nest(depth);
  if (pos + n * 2 > end) throw truncated();
  const o: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    const k = key();
    const v = read(d);
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

/** n bytes, copied into their own ArrayBuffer. */
function copy(n: number): ArrayBuffer {
  if (pos + n > end) throw truncated();
  const out = new ArrayBuffer(n);
  new Uint8Array(out).set(src.subarray(pos, pos + n));
  pos += n;
  return out;
}

function bigint(): bigint {
  const n = varint();
  if (pos + n > end) throw truncated();
  let v = 0n;
  for (let i = pos + n - 1; i >= pos; i--) v = (v << 8n) | BigInt(src[i] ?? 0);
  pos += n;
  return v;
}

function map(n: number, depth: number): Map<unknown, unknown> {
  const d = nest(depth);
  if (pos + n * 2 > end) throw truncated();
  const m = new Map<unknown, unknown>();
  for (let i = 0; i < n; i++) {
    const k = read(d);
    m.set(k, read(d));
  }
  return m;
}

function set(n: number, depth: number): Set<unknown> {
  const d = nest(depth);
  if (pos + n > end) throw truncated();
  const s = new Set<unknown>();
  for (let i = 0; i < n; i++) s.add(read(d));
  return s;
}

const VIEWS: Record<F.ViewKind, (b: ArrayBuffer) => ArrayBufferView> = {
  Int8Array: (b) => new Int8Array(b),
  Uint8Array: (b) => new Uint8Array(b),
  Uint8ClampedArray: (b) => new Uint8ClampedArray(b),
  Int16Array: (b) => new Int16Array(b),
  Uint16Array: (b) => new Uint16Array(b),
  Int32Array: (b) => new Int32Array(b),
  Uint32Array: (b) => new Uint32Array(b),
  Float32Array: (b) => new Float32Array(b),
  Float64Array: (b) => new Float64Array(b),
  BigInt64Array: (b) => new BigInt64Array(b),
  BigUint64Array: (b) => new BigUint64Array(b),
  DataView: (b) => new DataView(b),
};

function typed(): ArrayBufferView {
  const kind = VIEW_KINDS[byte()];
  if (kind === undefined) throw new CodecError('malformed', 'unknown typed array kind');
  const b = copy(varint());
  try {
    return VIEWS[kind](b);
  } catch {
    throw new CodecError('malformed', `${kind} byte length ${b.byteLength}`);
  }
}
