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
  FIXSTR_MAX,
  FIXARRAY_MAX,
  FIXOBJECT_MAX,
  MAX_DEPTH,
} = F;

const utf8 = new TextEncoder();

// The encoder's state lives at module level: a chunk that successive results
// are carved from, the start of the value being written, and the position.
// Every scalar takes at most SLACK bytes, so a value checks the room once
// instead of per byte. Returning a view, not a copy, is most of the speed: a
// fresh ArrayBuffer per record costs more than encoding it.
const SLACK = 16;
const CHUNK = 16_384;
let buf = new Uint8Array(CHUNK);
let view = new DataView(buf.buffer);
let start = 0;
let pos = 0;

/** Makes room for n more bytes (plus SLACK), moving to a new chunk if needed. */
function room(n: number): void {
  const need = pos + n + SLACK;
  if (need <= buf.length) return;
  // Bytes already handed out stay in the old chunk; only the value being
  // written moves.
  const used = pos - start;
  let size = CHUNK;
  while (size < used + n + SLACK) size *= 2;
  const next = new Uint8Array(size);
  next.set(buf.subarray(start, pos));
  buf = next;
  view = new DataView(next.buffer);
  start = 0;
  pos = used;
}

/** Unsigned LEB128, for 0 ≤ n ≤ 2^53 - 1; the caller made room. */
function varint(n: number): void {
  if (n > 0xffff_ffff) {
    // Past 32 bits: the low 28 bits, then the rest, which fits in 25.
    const lo = n >>> 0;
    const hi = (n - lo) / 0x1_0000_0000;
    buf[pos++] = (lo & 0x7f) | 0x80;
    buf[pos++] = ((lo >>> 7) & 0x7f) | 0x80;
    buf[pos++] = ((lo >>> 14) & 0x7f) | 0x80;
    buf[pos++] = ((lo >>> 21) & 0x7f) | 0x80;
    n = (lo >>> 28) | (hi << 4);
  }
  while (n > 0x7f) {
    buf[pos++] = (n & 0x7f) | 0x80;
    n >>>= 7;
  }
  buf[pos++] = n;
}

/** A tag that holds counts up to `max` itself, else the long tag and a varint. */
function head(fix: number, max: number, long: number, n: number): void {
  if (n <= max) buf[pos++] = fix + n;
  else {
    buf[pos++] = long;
    varint(n);
  }
}

const varintSize = (n: number): number => {
  let size = 1;
  while (n >= 0x80) {
    n = Math.floor(n / 0x80);
    size++;
  }
  return size;
};

const isPlainObject = (v: object): v is Record<string, unknown> => {
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

const describe = (v: unknown): string => {
  if (typeof v === 'function') return 'a function';
  if (typeof v === 'symbol') return 'a symbol';
  const ctor: unknown =
    typeof v === 'object' && v !== null ? Reflect.get(v, 'constructor') : undefined;
  const name: unknown = typeof ctor === 'function' ? ctor.name : undefined;
  return typeof name === 'string' && name !== '' ? `an instance of ${name}` : 'an object';
};

let busy = false;

/**
 * Encodes `value` to bytes (`isoloop-codec@1`, see format.ts). Throws a
 * `CodecError` with code `not_encodable` for a function, a symbol, a class
 * instance or a cycle.
 *
 * The result is a view into a chunk shared with other results: copy it, or
 * read it through its `byteOffset`, before transferring its `buffer`.
 */
export function encode(value: unknown): Uint8Array {
  // A getter on the value could call encode again: that call gets its own
  // chunk and puts the outer state back when it's done.
  if (busy) {
    const outer = { buf, view, start, pos };
    buf = new Uint8Array(256);
    view = new DataView(buf.buffer);
    start = 0;
    pos = 0;
    try {
      write(value, 0);
      return buf.subarray(0, pos);
    } finally {
      ({ buf, view, start, pos } = outer);
    }
  }
  busy = true;
  start = pos;
  try {
    write(value, 0);
    const out = buf.subarray(start, pos);
    start = pos;
    return out;
  } catch (e) {
    pos = start;
    throw e;
  } finally {
    busy = false;
  }
}

function write(v: unknown, depth: number): void {
  if (pos + SLACK > buf.length) room(0);
  switch (typeof v) {
    case 'number':
      return number(v);
    case 'string':
      return string(v);
    case 'boolean':
      buf[pos++] = v ? TRUE : FALSE;
      return;
    case 'undefined':
      buf[pos++] = UNDEFINED;
      return;
    case 'object':
      if (v === null) {
        buf[pos++] = NULL;
        return;
      }
      if (depth >= MAX_DEPTH) {
        throw new CodecError('not_encodable', `nested deeper than ${MAX_DEPTH}, or a cycle`);
      }
      if (Array.isArray(v)) return array(v, depth + 1);
      if (isPlainObject(v)) return object(v, depth + 1);
      throw new CodecError('not_encodable', `${describe(v)} can't be encoded`);
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new CodecError('not_encodable', `${describe(v)} can't be encoded`);
  }
}

function number(v: number): void {
  // Cheapest checks first: uint32, then int32, then the rest of the safe
  // integers. -0 passes the uint32 check, so it's caught there.
  if (v >>> 0 === v && (v !== 0 || 1 / v > 0)) {
    if (v < 0x80) buf[pos++] = v;
    else {
      buf[pos++] = UINT;
      varint(v);
    }
    return;
  }
  if (
    v !== 0 &&
    ((v | 0) === v ||
      (Math.trunc(v) === v && v <= Number.MAX_SAFE_INTEGER && v >= -Number.MAX_SAFE_INTEGER))
  ) {
    if (v >= 0) {
      buf[pos++] = UINT;
      varint(v);
    } else if (v >= -32) buf[pos++] = 0x100 + v;
    else {
      buf[pos++] = NINT;
      varint(-v - 1);
    }
    return;
  }
  buf[pos] = FLOAT64;
  view.setFloat64(pos + 1, v, true);
  pos += 9;
}

function string(s: string): void {
  const n = s.length;
  if (n <= 64) {
    // Short strings by hand while they're ASCII.
    room(n);
    const at = pos;
    if (n <= FIXSTR_MAX) pos += 1;
    else pos += 2; // 32..64 bytes: STR and a one-byte varint
    let i = 0;
    for (; i < n; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0x80) break;
      buf[pos++] = c;
    }
    if (i === n) {
      if (n <= FIXSTR_MAX) buf[at] = FIXSTR + n;
      else {
        buf[at] = STR;
        buf[at + 1] = n;
      }
      return;
    }
    pos = at;
  }
  // At most 3 bytes per UTF-16 unit. Write past the largest possible header,
  // then move the bytes back once their length is known.
  const max = n * 3;
  const gap = 1 + varintSize(max);
  room(gap + max);
  const at = pos;
  const { written } = utf8.encodeInto(s, buf.subarray(at + gap));
  const size = written <= FIXSTR_MAX ? 1 : 1 + varintSize(written);
  if (size !== gap) buf.copyWithin(at + size, at + gap, at + gap + written);
  head(FIXSTR, FIXSTR_MAX, STR, written);
  pos = at + size + written;
}

// Containers handle numbers and strings inline, without going through
// `write`: a number passed on as `unknown` is boxed, one allocation per float.
function item(v: unknown, depth: number): void {
  if (typeof v === 'number') {
    if (pos + SLACK > buf.length) room(0);
    number(v);
  } else if (typeof v === 'string') string(v);
  else write(v, depth);
}

function array(a: readonly unknown[], depth: number): void {
  head(FIXARRAY, FIXARRAY_MAX, ARRAY, a.length);
  // A hole reads as undefined, so it encodes as one.
  for (let i = 0; i < a.length; i++) item(a[i], depth);
}

function object(o: Record<string, unknown>, depth: number): void {
  const keys = Object.keys(o);
  head(FIXOBJECT, FIXOBJECT_MAX, OBJECT, keys.length);
  for (const k of keys) {
    string(k);
    item(o[k], depth);
  }
}
