# ADR 0014: Our own codec for persistent topics

- **Status:** Accepted (2026-11-07)
- **Date:** 2026-11-07
- **Fills in:** [ADR 0007](0007-bus-worker-supervision.md), decision 3 ("records are encoded to bytes with one binary codec")

## Context

Persistent topics go to disk (M2b), so records need a binary encoding, and the M5 shared-memory engine will reuse it. Topics carry structured-clone data without functions, DOM nodes or class instances (ADR 0007, consequences).

The options were a MessagePack or CBOR library, or our own codec. The rule agreed on 2026-11-06 ([M2b plan](../plans/m2b-durable-log.md), task 2): our own codec, covering exactly the types topics allow, unless a library is more than 2× faster on realistic records. A library that wins comes in behind our interface, with conformance tests.

The [investigation](../investigations/codec.md) benched our codec, `@msgpack/msgpack`, msgpackr, cbor-x, JSON and structured clone on the markets dashboard's trades and book updates and on the four-loops topics, in Node, Chromium, Firefox and WebKit.

## Decision

**`@isoloop/codec`, our own, with no dependency.**

1. **Speed:** after tuning, msgpackr and cbor-x, the fastest libraries, are at most **1.42×** faster on any record set in any engine (trades, encode, Firefox), and slower in most cases: our codec decodes trades 1.6–4× faster than both in Node, Chromium and WebKit. `@msgpack/msgpack` is slower in all but one case (trades, decode, Firefox: 1.39×).
2. **Size:** our records are the smallest (trades 90.8 bytes, against 93.8 for msgpackr and cbor-x and 122.6 for JSON), and so is the bundle: 3.1 KB gzipped, against 12.3–13.3 KB.
3. **The format is `isoloop-codec@1`** (`packages/codec/src/format.ts`): one tag byte per value, with small integers, strings, arrays and objects packed into the tag; minimal LEB128 varints; float64 little-endian. Every value has exactly one encoding, and a byte-layout test fixes it, so the format can't drift. Changing it means a new version that reads the old one.
4. **Types:** objects, arrays, strings, numbers (including `-0`, `NaN` and `±Infinity`), booleans, `null`, `undefined`; `bigint`, `Date`, `Map`, `Set`, typed arrays and `ArrayBuffer` (M2b task 4). Functions, symbols, class instances and cycles throw `not_encodable`. Lone surrogates in strings become U+FFFD, as with any UTF-8 encoding; structured clone would keep them.
5. **`encode` returns a view** into a chunk shared with other results, not a fresh `ArrayBuffer`. A copy per record cost more than encoding it. Callers copy before transferring the `buffer`; the bus copies frames into its segment buffers anyway.

## Consequences

- No dependency to track, audit or wrap; the codec is about 550 lines, comments included, that we own end to end.
- We maintain the speed ourselves. The bench stays (`bench/codec`, `pnpm bench:codec` in CI, report only), so a regression or a faster library shows up the same way it was measured here.
- The format is ours to document for M5 and for anyone reading the files on disk.
- No cycles, unlike structured clone. Topic records are data, so a cycle is more likely a bug than a design; it fails at `publish` with `not_encodable` on persistent topics only.

## Alternatives considered

- **msgpackr or cbor-x:** at most 1.42× faster in one engine on one record set, under the 2× bar, at four times the bundle size. Their fastest mode, shared record structures, doesn't suit a log where each record must decode on its own.
- **`@msgpack/msgpack`:** the reference MessagePack library; slower than ours in all but one case.
- **JSON:** 1.7–6× slower to encode than ours, 35 % larger for trades, and it loses `undefined`, `-0`, `NaN`, `bigint`, `Date`, `Map`, `Set` and binary data.
- **Structured clone bytes:** V8's serializer is 5–16× slower in Node and isn't available in the browser as bytes (only `structuredClone`, which returns an object).
