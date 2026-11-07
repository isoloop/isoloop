import { decode, encode } from '@isoloop/codec';
import * as msgpack from '@msgpack/msgpack';
import * as cbor from 'cbor-x';
import * as msgpackr from 'msgpackr';
import { sets } from './records';

export interface Codec {
  name: string;
  encode: (v: unknown) => Uint8Array;
  decode: (b: Uint8Array) => unknown;
}

const te = new TextEncoder();
const td = new TextDecoder();
// Records are written one by one to the log, so no codec may share state
// across them (msgpackr's and cbor-x's record structures).
const packr = new msgpackr.Packr({ useRecords: false });
const cborx = new cbor.Encoder({ useRecords: false, pack: false });

export const LIBRARIES = ['@msgpack/msgpack', 'msgpackr', 'cbor-x'];

export const codecs: Codec[] = [
  { name: '@isoloop/codec', encode, decode },
  {
    name: 'JSON + UTF-8',
    encode: (v) => te.encode(JSON.stringify(v)),
    decode: (b): unknown => JSON.parse(td.decode(b)),
  },
  { name: '@msgpack/msgpack', encode: (v) => msgpack.encode(v), decode: (b) => msgpack.decode(b) },
  { name: 'msgpackr', encode: (v) => packr.pack(v), decode: (b): unknown => packr.unpack(b) },
  { name: 'cbor-x', encode: (v) => cborx.encode(v), decode: (b): unknown => cborx.decode(b) },
];

export interface Row {
  enc: number;
  dec: number;
  bytes: number;
}

export const N = 100_000;
const ROUNDS = 5;

const best = (fn: () => void): number => {
  let min = Infinity;
  for (let r = 0; r < ROUNDS; r++) {
    const t0 = performance.now();
    fn();
    min = Math.min(min, performance.now() - t0);
  }
  return min;
};

const rate = (ms: number): number => Math.round((N / ms) * 1000);
const fmt = (n: number): string => n.toLocaleString('en');

/**
 * Times every codec on every record set and returns the report: encode and
 * decode rates (records/s, best of 5 rounds of N), mean bytes per record, and
 * each library's speed relative to `@isoloop/codec` (the 2× rule).
 */
export function run(all: Codec[], check: (a: unknown, b: unknown) => void): string {
  const out: string[] = [];
  const table: Record<string, Record<string, Row>> = {};
  for (const [set, make] of sets) {
    const records = Array.from({ length: N }, (_, i) => make(i));
    out.push(`\n${set} (${fmt(N)} records, best of ${ROUNDS})`);
    out.push(
      `${'codec'.padEnd(24)}${'encode/s'.padStart(12)}${'decode/s'.padStart(12)}${'bytes'.padStart(8)}`,
    );
    for (const c of all) {
      const encoded = records.map((r) => c.encode(r));
      for (let i = 0; i < 1000; i++) check(c.decode(encoded[i] ?? new Uint8Array()), records[i]);
      const enc = best(() => {
        for (const r of records) c.encode(r);
      });
      const dec = best(() => {
        for (const b of encoded) c.decode(b);
      });
      const bytes = encoded.reduce((s, b) => s + b.length, 0) / N;
      (table[set] ??= {})[c.name] = { enc: rate(enc), dec: rate(dec), bytes };
      out.push(
        `${c.name.padEnd(24)}${fmt(rate(enc)).padStart(12)}${fmt(rate(dec)).padStart(12)}${bytes.toFixed(1).padStart(8)}`,
      );
    }
  }
  out.push('\nspeed relative to @isoloop/codec (encode, decode)');
  for (const [set, byCodec] of Object.entries(table)) {
    const own = byCodec['@isoloop/codec'];
    for (const lib of LIBRARIES) {
      const r = byCodec[lib];
      if (!own || !r) continue;
      out.push(
        `${set.padEnd(14)}${lib.padEnd(20)}${(r.enc / own.enc).toFixed(2).padStart(6)}×${(r.dec / own.dec).toFixed(2).padStart(7)}×`,
      );
    }
  }
  return out.join('\n');
}
