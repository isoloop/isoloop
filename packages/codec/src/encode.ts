import { CodecError } from './errors';
import * as F from './format';

const utf8 = new TextEncoder();

/** A growable byte buffer. One is reused across calls; `encode` copies out. */
class Writer {
  buf: Uint8Array = new Uint8Array(4096);
  view: DataView = new DataView(this.buf.buffer);
  pos = 0;

  ensure(n: number): void {
    const need = this.pos + n;
    if (need <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < need) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  byte(b: number): void {
    this.ensure(1);
    this.buf[this.pos++] = b;
  }

  /** Unsigned LEB128, for 0 ≤ n ≤ 2^53 - 1. */
  varint(n: number): void {
    this.ensure(8);
    const buf = this.buf;
    let pos = this.pos;
    while (n >= 0x80) {
      buf[pos++] = (n % 0x80) | 0x80;
      n = Math.floor(n / 0x80);
    }
    buf[pos++] = n;
    this.pos = pos;
  }

  /** A tag that holds counts up to `max` itself, else the long tag and a varint. */
  head(fix: number, max: number, long: number, n: number): void {
    if (n <= max) this.byte(fix + n);
    else {
      this.byte(long);
      this.varint(n);
    }
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

let shared: Writer | undefined;
let busy = false;

/**
 * Encodes `value` to bytes (`isoloop-codec@1`, see format.ts). Throws a
 * `CodecError` with code `not_encodable` for a function, a symbol, a class
 * instance or a cycle.
 */
export function encode(value: unknown): Uint8Array {
  // A getter on the value could call encode again; give it its own buffer.
  const w = busy ? new Writer() : (shared ??= new Writer());
  const reentrant = busy;
  busy = true;
  w.pos = 0;
  try {
    write(w, value, 0);
    return w.buf.slice(0, w.pos);
  } finally {
    busy = reentrant;
  }
}

function write(w: Writer, v: unknown, depth: number): void {
  switch (typeof v) {
    case 'number':
      return number(w, v);
    case 'string':
      return string(w, v);
    case 'boolean':
      return w.byte(v ? F.TRUE : F.FALSE);
    case 'undefined':
      return w.byte(F.UNDEFINED);
    case 'object':
      if (v === null) return w.byte(F.NULL);
      if (depth >= F.MAX_DEPTH) {
        throw new CodecError('not_encodable', `nested deeper than ${F.MAX_DEPTH}, or a cycle`);
      }
      if (Array.isArray(v)) return array(w, v, depth + 1);
      if (isPlainObject(v)) return object(w, v, depth + 1);
      throw new CodecError('not_encodable', `${describe(v)} can't be encoded`);
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new CodecError('not_encodable', `${describe(v)} can't be encoded`);
  }
}

function number(w: Writer, v: number): void {
  if (Number.isSafeInteger(v) && !Object.is(v, -0)) {
    if (v >= 0) {
      if (v < 0x80) return w.byte(v);
      w.byte(F.UINT);
      return w.varint(v);
    }
    if (v >= -32) return w.byte(0x100 + v);
    w.byte(F.NINT);
    return w.varint(-v - 1);
  }
  w.ensure(9);
  w.buf[w.pos] = F.FLOAT64;
  w.view.setFloat64(w.pos + 1, v, true);
  w.pos += 9;
}

function string(w: Writer, s: string): void {
  const n = s.length;
  let ascii = true;
  for (let i = 0; i < n; i++) {
    if (s.charCodeAt(i) >= 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii) {
    w.head(F.FIXSTR, F.FIXSTR_MAX, F.STR, n);
    w.ensure(n);
    const buf = w.buf;
    const pos = w.pos;
    for (let i = 0; i < n; i++) buf[pos + i] = s.charCodeAt(i);
    w.pos = pos + n;
    return;
  }
  // At most 3 bytes per UTF-16 unit. Write past the largest possible header,
  // then move the bytes back once their length is known.
  const max = n * 3;
  const room = 1 + varintSize(max);
  w.ensure(room + max);
  const start = w.pos;
  const { written } = utf8.encodeInto(s, w.buf.subarray(start + room));
  const head = written <= F.FIXSTR_MAX ? 1 : 1 + varintSize(written);
  if (head !== room) w.buf.copyWithin(start + head, start + room, start + room + written);
  w.head(F.FIXSTR, F.FIXSTR_MAX, F.STR, written);
  w.pos = start + head + written;
}

function array(w: Writer, a: readonly unknown[], depth: number): void {
  const n = a.length;
  w.head(F.FIXARRAY, F.FIXARRAY_MAX, F.ARRAY, n);
  // A hole reads as undefined, so it encodes as one.
  for (let i = 0; i < n; i++) write(w, a[i], depth);
}

function object(w: Writer, o: Record<string, unknown>, depth: number): void {
  const keys = Object.keys(o);
  w.head(F.FIXOBJECT, F.FIXOBJECT_MAX, F.OBJECT, keys.length);
  for (const k of keys) {
    string(w, k);
    write(w, o[k], depth);
  }
}
