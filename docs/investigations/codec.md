# Investigation: a codec for persistent topics

- **Date:** 2026-11-07
- **Question:** M2b writes persistent topics to disk, so records need a binary encoding (ADR 0007, decision 3). Should it be a MessagePack or CBOR library, or our own codec? The rule decided on 2026-11-06 ([M2b plan](../plans/m2b-durable-log.md), task 2): our own codec unless a library is more than 2× faster on realistic records.
- **Answer:** our own codec, `@isoloop/codec`. After tuning, the fastest libraries (msgpackr and cbor-x) are at most 1.42× faster on any record set in any engine, and slower in most cases. Our codec is also the smallest on the wire and in the bundle: 3.1 KB gzipped, against 12–13 KB for msgpackr and cbor-x.

## Method

- **Records** (`bench/codec/records.ts`), 100,000 per set, generated deterministically:
  - **trades:** the markets dashboard's `trades.v1` (M3b): exchange, symbol, id, price, size, side, timestamp. 7 fields, about 90 bytes.
  - **book updates:** `book.v1`: exchange, symbol, sequence, 10 bid and 10 ask levels as `[price, size]` pairs, timestamp. About 445 bytes.
  - **four-loops:** the demo's four topics, mixed: a number, a short string, `{ count, ms }`, `{ count, notes }`. About 20 bytes.
- **Codecs:** `@isoloop/codec`; `JSON.stringify` plus `TextEncoder` (and back); `@msgpack/msgpack` 3.1.3, the reference MessagePack implementation; msgpackr 2.1.4 and cbor-x 1.6.9, the fastest MessagePack and CBOR libraries for JavaScript. In Node, V8's structured-clone serializer (`node:v8`) as well.
- **Fairness:**
  - Every record is encoded on its own, as the log writes them, so msgpackr's and cbor-x's shared record structures are off (`useRecords: false`). With them, a record can't be decoded without the structures written before it.
  - Their native Node add-ons are off too: in the browser, where the bus runs, only their JavaScript paths exist.
  - Each codec's first 1,000 records are decoded and compared with the originals before timing.
- **Timing:** encode all records, then decode all; best of 5 rounds. Rates are records per second.
- **Where:**
  - Node 24 (`pnpm bench`, `bench/codec/codec.bench.ts`), which also measures bundle size: a minified browser build of each codec's encode and decode, gzipped.
  - Chromium 156, Firefox 157 and WebKit 27.2 under Playwright (`pnpm bench:codec`, `bench/codec/codec.browser-bench.ts`). Firefox and WebKit round `performance.now()` to 1 ms, hence their round numbers.
  - All on this machine (WSL2, 32 threads), headless, with other work running. Runs vary by about ±15 %.

## Results

### The 2× rule: library speed relative to `@isoloop/codec`

Above 1 means the library is faster. Encode / decode:

| Records | Library | Node | Chromium | Firefox | WebKit |
| --- | --- | --- | --- | --- | --- |
| trades | msgpackr | 0.98 / 0.58 | 0.82 / 0.62 | **1.42** / 1.08 | 0.79 / 0.37 |
| trades | cbor-x | 0.96 / 0.48 | 0.75 / 0.55 | 1.36 / 1.02 | 1.27 / 0.25 |
| book updates | msgpackr | 0.88 / 1.23 | 0.79 / 1.27 | 1.12 / 1.38 | 0.80 / 0.94 |
| book updates | cbor-x | 0.86 / 1.16 | 0.61 / 1.13 | 1.00 / 1.34 | 1.30 / 0.93 |
| four-loops | msgpackr | 0.77 / 0.71 | 0.85 / 0.71 | 1.33 / 1.14 | 0.64 / 0.88 |
| four-loops | cbor-x | 0.68 / 0.57 | 0.71 / 0.62 | 1.20 / 0.80 | 1.00 / 0.64 |

`@msgpack/msgpack` is slower than our codec everywhere (0.03–0.92×, one 1.39× decode in Firefox).

### Node, records per second

| Records | Codec | Encode | Decode | Bytes |
| --- | --- | --- | --- | --- |
| trades | `@isoloop/codec` | 5.2 M | 6.7 M | 90.8 |
| | JSON + UTF-8 | 1.4 M | 2.7 M | 122.6 |
| | structured clone (v8) | 1.0 M | 0.9 M | 106.8 |
| | @msgpack/msgpack | 0.6 M | 2.1 M | 91.8 |
| | msgpackr | 5.1 M | 3.9 M | 93.8 |
| | cbor-x | 5.0 M | 3.2 M | 93.8 |
| book updates | `@isoloop/codec` | 1.6 M | 1.3 M | 443.5 |
| | JSON + UTF-8 | 0.4 M | 0.7 M | 448.8 |
| | structured clone (v8) | 0.3 M | 0.4 M | 545.5 |
| | @msgpack/msgpack | 0.3 M | 1.0 M | 445.4 |
| | msgpackr | 1.5 M | 1.7 M | 447.4 |
| | cbor-x | 1.4 M | 1.6 M | 447.4 |
| four-loops | `@isoloop/codec` | 17.7 M | 21.4 M | 19.1 |
| | JSON + UTF-8 | 3.1 M | 4.7 M | 22.2 |
| | structured clone (v8) | 1.3 M | 1.4 M | 23.7 |
| | @msgpack/msgpack | 0.5 M | 3.3 M | 19.3 |
| | msgpackr | 13.7 M | 15.1 M | 20.3 |
| | cbor-x | 12.0 M | 12.3 M | 20.5 |

### Browsers, `@isoloop/codec`, records per second

| Records | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| trades | 4.4 M / 6.3 M | 2.9 M / 2.3 M | 5.3 M / 6.7 M |
| book updates | 1.4 M / 1.3 M | 1.1 M / 0.8 M | 1.4 M / 1.0 M |
| four-loops | 17.2 M / 23.8 M | 8.3 M / 12.5 M | 14.3 M / 14.3 M |

For scale: the bus delivers about 45k records per second end to end ([M2 post](../posts/m2-bus-in-a-worker.md#the-unflattering-numbers)), so encoding a record once on its way to disk adds a few percent to its path at most (0.3–0.9 µs of about 22 µs).

### Bundle size, minified browser build of encode and decode

| Codec | Minified | Gzipped |
| --- | --- | --- |
| `@isoloop/codec` | 7.9 KB | 3.1 KB |
| @msgpack/msgpack | 27.0 KB | 6.7 KB |
| msgpackr | 44.4 KB | 13.3 KB |
| cbor-x | 41.0 KB | 12.3 KB |

## What made our codec fast

The first, plain version lost by 2–7×: msgpackr decoded trades 3.9× faster in Firefox and encoded them 2.3× faster in Chromium. Five changes closed the gap, each measured on its own:

1. **No fresh `ArrayBuffer` per record.** `encode` returns a view carved from a shared 16 KiB chunk instead of copying out with `slice`. Allocating the copy cost more than encoding a trade: trades went from 2.1 M to 5.4 M per second in Node. msgpackr does the same. The catch: a result shares its `buffer` with others, so it must be copied before being transferred. The bus copies frames into its segment buffers anyway.
2. **State at module level**, not on a writer or reader object, and the format's tags copied into module constants. Under Vitest's module transform every `F.TAG` was a property read in the hot loop; that alone was worth 2× in the bench, though not in a bundled build.
3. **A cache of short decoded strings**: keys, symbols and enum-like values repeat, so a 4,096-slot table keyed by a hash of the bytes returns the same string without building it again. It decoded trades 3.5× faster in Firefox.
4. **Short ASCII strings built by hand**, four bytes per `String.fromCharCode` call, instead of through `TextDecoder`, whose call overhead dominates for a few bytes.
5. **Bitwise varints**, splitting values past 32 bits once instead of dividing per byte, and the cheapest integer checks first (`v >>> 0 === v`).

## Consequences

- `@isoloop/codec` stays our own, with no dependency. ADR 0014 records the decision.
- The bench stays in `bench/codec`, so a later change to the codec, or a new library, can be measured the same way.
- The format, `isoloop-codec@1`, is fixed by a byte-layout test (`packages/codec/src/codec.test.ts`). The M5 shared-memory engine reuses it.
