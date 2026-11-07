import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CodecError, decode, encode } from './index';

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

/** The structured-clone values of codec task 3: plain data, no class instances. */
const plain = fc.anything({
  withBigInt: false,
  withBoxedValues: false,
  withDate: false,
  withMap: false,
  withSet: false,
  withNullPrototype: false,
  withObjectString: false,
  withTypedArray: false,
  withSparseArray: false,
  stringUnit: 'grapheme',
});

describe('round trip', () => {
  it('decode(encode(v)) equals v for generated values', () => {
    fc.assert(
      fc.property(plain, (v) => {
        expect(decode(encode(v))).toStrictEqual(v);
      }),
      { numRuns: 2000 },
    );
  });

  it('keeps every number exactly', () => {
    fc.assert(
      fc.property(fc.oneof(fc.double(), fc.integer(), fc.maxSafeInteger()), (n) => {
        expect(Object.is(decode(encode(n)), n)).toBe(true);
      }),
      { numRuns: 5000 },
    );
  });

  it('keeps every string exactly, lone surrogates aside', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 200 }), (s) => {
        expect(decode(encode(s))).toBe(s);
      }),
    );
  });

  it('keeps an own __proto__ key as a key', () => {
    const v: unknown = JSON.parse('{"__proto__": {"x": 1}, "a": 2}');
    const back = decode(encode(v));
    expect(Object.getPrototypeOf(back)).toBe(Object.prototype);
    expect(Object.keys(back ?? {})).toEqual(['__proto__', 'a']);
    expect(back).toStrictEqual(v);
  });

  it('reads an array hole as undefined', () => {
    // oxlint-disable-next-line no-sparse-arrays -- the hole is the point
    expect(decode(encode([1, , 3]))).toStrictEqual([1, undefined, 3]);
  });

  it('round-trips long strings and large containers', () => {
    const v = {
      long: 'x'.repeat(100_000),
      wide: 'é'.repeat(5000),
      items: Array.from({ length: 1000 }, (_, i) => ({ i, s: `item-${i}` })),
    };
    expect(decode(encode(v))).toStrictEqual(v);
  });
});

describe('the other structured-clone types', () => {
  const everything = fc.anything({
    withBigInt: true,
    withDate: true,
    withMap: true,
    withSet: true,
    withTypedArray: true,
    withBoxedValues: false,
    withNullPrototype: false,
    withObjectString: false,
    withSparseArray: false,
    stringUnit: 'grapheme',
  });

  it('decode(encode(v)) equals v for generated values', () => {
    fc.assert(
      fc.property(everything, (v) => {
        expect(decode(encode(v))).toStrictEqual(v);
      }),
      { numRuns: 2000 },
    );
  });

  it.each<[string, unknown]>([
    ['0n', 0n],
    ['a large bigint', 2n ** 200n + 12_345n],
    ['a negative bigint', -(2n ** 64n) - 1n],
    ['a Date', new Date(1_762_500_000_000)],
    ['an invalid Date', new Date(Number.NaN)],
    [
      'a Map with object keys',
      new Map<unknown, unknown>([
        [{ a: 1 }, 'x'],
        [2n, [1, 2]],
      ]),
    ],
    ['a Set', new Set([1, 'a', null, undefined])],
    ['an ArrayBuffer', new Uint8Array([1, 2, 3]).buffer],
    ['an empty ArrayBuffer', new ArrayBuffer(0)],
    ['a Float64Array', new Float64Array([1.5, -0, Number.NaN])],
    ['a BigInt64Array', new BigInt64Array([-1n, 2n ** 62n])],
    ['a DataView', new DataView(new Uint8Array([9, 8, 7]).buffer)],
    [
      'nested',
      { when: new Date(0), tags: new Set(['a']), by: new Map([['k', new Uint16Array([1, 2])]]) },
    ],
  ])('%s', (_name, v) => {
    expect(decode(encode(v))).toStrictEqual(v);
  });

  it('a view writes only its own bytes, into a buffer of its own', () => {
    const backing = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const view = new Uint16Array(backing.buffer, 2, 2);
    const back = decode(encode(view));
    expect(back).toStrictEqual(new Uint16Array([0x0302, 0x0504]));
    expect(back instanceof Uint16Array && back.buffer.byteLength).toBe(4);
  });

  it.each<[string, unknown, string]>([
    ['0n', 0n, 'ca 00'],
    ['255n', 255n, 'ca 01 ff'],
    ['-256n', -256n, 'cb 02 00 01'],
    ['Date(0)', new Date(0), 'cc 00 00 00 00 00 00 00 00'],
    ['Map { 1 => 2 }', new Map([[1, 2]]), 'cd 01 01 02'],
    ['Set { 1 }', new Set([1]), 'ce 01 01'],
    ['ArrayBuffer [1, 2]', new Uint8Array([1, 2]).buffer, 'cf 02 01 02'],
    ['Uint16Array [1]', new Uint16Array([1]), 'd0 04 02 01 00'],
  ])('byte layout: %s', (_name, value, bytes) => {
    expect(hex(encode(value))).toBe(bytes);
  });

  it('a view on a SharedArrayBuffer throws not_encodable', () => {
    expect(() => encode(new Uint8Array(new SharedArrayBuffer(4)))).toThrow(/not_encodable/);
  });

  it.each<[string, Uint8Array]>([
    ['unknown view kind', new Uint8Array([0xd0, 0x40, 0x00])],
    ['view length not a multiple of its element', new Uint8Array([0xd0, 0x08, 0x03, 1, 2, 3])],
    ['truncated bigint', new Uint8Array([0xca, 0x04, 1])],
    ['truncated Date', new Uint8Array([0xcc, 0, 0])],
  ])('malformed: %s', (_name, bytes) => {
    expect(() => decode(bytes)).toThrow(/malformed/);
  });
});

describe('shared chunks', () => {
  it('earlier results stay intact as later ones fill and outgrow the chunk', () => {
    const values = Array.from({ length: 5000 }, (_, i) => ({ i, s: 'x'.repeat(i % 300) }));
    const encoded = values.map((v) => encode(v));
    encoded.forEach((b, i) => expect(decode(b)).toStrictEqual(values[i]));
  });

  it('a value larger than a chunk', () => {
    const big = { s: 'y'.repeat(100_000), a: Array.from({ length: 10_000 }, (_, i) => i) };
    const before = encode('before');
    const b = encode(big);
    expect(decode(b)).toStrictEqual(big);
    expect(decode(before)).toBe('before');
  });

  it('a failed encode leaves earlier results and the next one intact', () => {
    const a = encode({ a: 1 });
    expect(() => encode({ big: 'z'.repeat(20_000), f: () => 1 })).toThrow();
    const b = encode({ b: 2 });
    expect(decode(a)).toEqual({ a: 1 });
    expect(decode(b)).toEqual({ b: 2 });
  });

  it('a getter that encodes during encode', () => {
    const inner: Uint8Array[] = [];
    const v = {
      x: 1,
      get y(): number {
        inner.push(encode({ nested: 'yes' }));
        return 2;
      },
    };
    expect(decode(encode(v))).toEqual({ x: 1, y: 2 });
    expect(decode(inner[0] ?? new Uint8Array())).toEqual({ nested: 'yes' });
  });
});

describe('byte layout (isoloop-codec@1)', () => {
  // Changing any of these changes the on-disk format: that needs a new version.
  it.each<[string, unknown, string]>([
    ['0', 0, '00'],
    ['127', 127, '7f'],
    ['128', 128, 'c4 80 01'],
    ['300', 300, 'c4 ac 02'],
    ['2^53 - 1', Number.MAX_SAFE_INTEGER, 'c4 ff ff ff ff ff ff ff 0f'],
    ['-1', -1, 'ff'],
    ['-32', -32, 'e0'],
    ['-33', -33, 'c5 20'],
    ['-0', -0, 'c6 00 00 00 00 00 00 00 80'],
    ['1.5', 1.5, 'c6 00 00 00 00 00 00 f8 3f'],
    ['NaN', Number.NaN, 'c6 00 00 00 00 00 00 f8 7f'],
    ['undefined', undefined, 'c0'],
    ['null', null, 'c1'],
    ['false', false, 'c2'],
    ['true', true, 'c3'],
    ['""', '', '80'],
    ['"ab"', 'ab', '82 61 62'],
    ['"é"', 'é', '82 c3 a9'],
    ['32 chars', 'a'.repeat(32), `c7 20 ${'61 '.repeat(32).trim()}`],
    ['[]', [], 'a0'],
    ['[1, "a"]', [1, 'a'], 'a2 01 81 61'],
    ['16 items', Array.from({ length: 16 }, () => 0), `c8 10 ${'00 '.repeat(16).trim()}`],
    ['{}', {}, 'b0'],
    ['{ a: 1 }', { a: 1 }, 'b1 81 61 01'],
    [
      'a trade',
      { sym: 'BTC-USD', px: 67250.5, qty: 3 },
      'b3 83 73 79 6d 87 42 54 43 2d 55 53 44 82 70 78 c6 00 00 00 00 28 6b f0 40 83 71 74 79 03',
    ],
  ])('%s', (_name, value, bytes) => {
    expect(hex(encode(value))).toBe(bytes);
  });
});

describe('not encodable', () => {
  class Point {
    x = 1;
  }
  it.each<[string, unknown]>([
    ['a function', () => 1],
    ['a symbol', Symbol('s')],
    ['a class instance', new Point()],
    ['a nested function', { a: [{ f: () => 1 }] }],
  ])('%s throws not_encodable', (_name, value) => {
    expect(() => encode(value)).toThrow(
      expect.objectContaining({ name: 'CodecError', code: 'not_encodable' }),
    );
  });

  it('a cycle throws not_encodable', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => encode(a)).toThrow(/not_encodable/);
  });

  it('still encodes after a failure', () => {
    expect(() => encode({ f: () => 1 })).toThrow();
    expect(decode(encode({ ok: true }))).toEqual({ ok: true });
  });
});

describe('malformed', () => {
  it.each<[string, Uint8Array]>([
    ['empty', new Uint8Array([])],
    ['truncated string', new Uint8Array([0x83, 0x61])],
    ['truncated float', new Uint8Array([0xc6, 0, 0])],
    ['unknown tag', new Uint8Array([0xd0])],
    ['trailing bytes', new Uint8Array([0x01, 0x02])],
    ['non-string key', new Uint8Array([0xb1, 0x01, 0x01])],
    ['huge count', new Uint8Array([0xc8, 0xff, 0xff, 0xff, 0x0f])],
    ['invalid UTF-8', new Uint8Array([0x82, 0xc3, 0x28])],
  ])('%s throws malformed', (_name, bytes) => {
    expect(() => decode(bytes)).toThrow(/malformed/);
  });

  it('never throws anything but a CodecError on random bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        try {
          decode(bytes);
        } catch (e) {
          expect(e).toBeInstanceOf(CodecError);
        }
      }),
      { numRuns: 5000 },
    );
  });

  it('decodes from a view with an offset', () => {
    const inner = encode({ a: [1, 2.5, 'x'] });
    const outer = new Uint8Array(inner.length + 7);
    outer.set(inner, 7);
    expect(decode(outer.subarray(7))).toEqual({ a: [1, 2.5, 'x'] });
  });
});
