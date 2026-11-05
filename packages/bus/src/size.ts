/**
 * A rough structured size of a value in bytes, for `maxRecordBytes` (design
 * §6.1). Strings count two bytes per UTF-16 unit, numbers eight, object keys
 * like strings, plus a little per entry. Cycles count once. Cheap rather than
 * exact: it only has to tell a 1 KiB record from a 1 MiB one.
 */
export function estimateSize(value: unknown, limit: number = Infinity): number {
  const seen = new Set<object>();
  const stack: unknown[] = [value];
  let size = 0;
  while (stack.length > 0 && size <= limit) {
    const v = stack.pop();
    switch (typeof v) {
      case 'string':
        size += 2 * v.length + 4;
        continue;
      case 'number':
      case 'bigint':
        size += 8;
        continue;
      case 'boolean':
      case 'undefined':
        size += 1;
        continue;
      case 'symbol':
      case 'function':
        continue;
      case 'object':
        break;
    }
    if (v === null) {
      size += 1;
      continue;
    }
    if (seen.has(v)) continue;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      size += v.byteLength + 8;
    } else if (v instanceof ArrayBuffer) {
      size += v.byteLength + 8;
    } else if (Array.isArray(v)) {
      size += 8 + v.length;
      for (const x of v) stack.push(x);
    } else if (v instanceof Map) {
      size += 8;
      for (const [k, x] of v) stack.push(k, x);
    } else if (v instanceof Set) {
      size += 8;
      for (const x of v) stack.push(x);
    } else {
      size += 8;
      for (const [k, x] of Object.entries(v)) {
        size += 2 * k.length + 4;
        stack.push(x);
      }
    }
  }
  return size;
}
