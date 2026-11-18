/*
 * Record previews for the inspection feed (ADR 0020, decision 3): a value as
 * JSON-like text, cut to a fixed length, so a devtools view never holds a
 * large record twice. Values are structured-cloneable, so this handles what
 * `JSON.stringify` can't: bigints, `undefined`, cycles, `Map`, `Set`,
 * `Date`, typed arrays, and stops writing once it has enough.
 */
import { PREVIEW_CHARS, type BusRecord, type RecordPreview } from '@isoloop/protocol';
import { estimateSize } from './size';

/** Typed arrays and `ArrayBuffer`s show their length, not their contents. */
const binary = (v: object): string | undefined => {
  if (v instanceof ArrayBuffer) return `ArrayBuffer(${v.byteLength})`;
  if (ArrayBuffer.isView(v)) {
    const len = 'length' in v && typeof v.length === 'number' ? v.length : v.byteLength;
    return `${v.constructor.name}(${len})`;
  }
  return undefined;
};

/** `value` as text, at most `max` characters. `truncated` when it was longer. */
export function previewText(
  value: unknown,
  max: number = PREVIEW_CHARS,
): { text: string; truncated: boolean } {
  let out = '';
  let full = false;
  const seen = new Set<object>();
  const put = (s: string): void => {
    if (full) return;
    if (out.length + s.length > max) {
      out += s.slice(0, max - out.length);
      full = true;
      return;
    }
    out += s;
  };
  const walk = (v: unknown): void => {
    if (full) return;
    switch (typeof v) {
      case 'string':
        put(JSON.stringify(v.length > max ? v.slice(0, max) : v));
        if (v.length > max) full = true;
        return;
      case 'number':
        put(String(v));
        return;
      case 'bigint':
        put(`${v}n`);
        return;
      case 'boolean':
        put(String(v));
        return;
      case 'undefined':
        put('undefined');
        return;
      case 'symbol':
      case 'function':
        put('null');
        return;
      case 'object':
        break;
    }
    if (v === null) return put('null');
    if (seen.has(v)) return put('[Circular]');
    const bin = binary(v);
    if (bin !== undefined) return put(bin);
    if (v instanceof Date) return put(Number.isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString());
    if (v instanceof RegExp) return put(String(v));
    seen.add(v);
    if (Array.isArray(v)) {
      put('[');
      v.forEach((x, i) => {
        if (i > 0) put(',');
        walk(x);
      });
      put(']');
    } else if (v instanceof Map) {
      put('Map{');
      let i = 0;
      for (const [k, x] of v) {
        if (full) break;
        if (i++ > 0) put(',');
        walk(k);
        put('=>');
        walk(x);
      }
      put('}');
    } else if (v instanceof Set) {
      put('Set[');
      let i = 0;
      for (const x of v) {
        if (full) break;
        if (i++ > 0) put(',');
        walk(x);
      }
      put(']');
    } else if (v instanceof Error) {
      put(JSON.stringify(`${v.name}: ${v.message}`));
    } else {
      put('{');
      let i = 0;
      for (const k of Object.keys(v)) {
        if (full) break;
        if (i++ > 0) put(',');
        put(JSON.stringify(k));
        put(':');
        walk(Reflect.get(v, k));
      }
      put('}');
    }
    seen.delete(v);
  };
  walk(value);
  return { text: out, truncated: full };
}

/** A retained record as the inspection feed shows it. */
export function recordPreview(topic: string, r: BusRecord, bytes?: number): RecordPreview {
  const { text, truncated } = previewText(r.value);
  return {
    topic,
    offset: r.offset,
    ...(r.key === undefined ? {} : { key: r.key }),
    ts: r.ts,
    producer: r.producer,
    ...(r.req === undefined ? {} : { req: r.req }),
    bytes: bytes ?? estimateSize(r.value),
    preview: text,
    truncated,
  };
}
