# M5: Shared-memory log engine (outline)

**Goal:** an opt-in Rust/WASM `LogEngine` that keeps the log in a `SharedArrayBuffer` ring buffer, so isolates read records from shared memory with no copy per subscriber, benchmarked against the TS engine.

**Done when** (RFC 0001): benchmark results are published, whichever engine wins.

Can start after M2, since it depends only on the `LogEngine` interface and the throughput bench.

## Main work items

1. **Design note / ADR:** ring-buffer layout (header, per-topic segments, record framing), the encoding of values (structured clone can't write to SAB, so values need a binary codec, e.g. MessagePack or CBOR), and the reader protocol: isolates read directly through `Atomics.wait`/`notify`, or via a lightweight read API in the isolate runtime.
2. **`packages/bus-wasm`:** a Rust crate with `wasm-bindgen`, implementing the engine; a TS wrapper that implements `LogEngine`.
3. **Conformance:** passes the M2 engine conformance suite unchanged.
4. **Zero-copy reads in isolates:** the isolate runtime gets SAB handles at `init` when the host is cross-origin isolated (COOP/COEP), and falls back to `deliver` otherwise.
5. **Benchmarks:** the M2 throughput bench plus memory per subscriber and fan-out at 10/50/100 subscribers, run against both engines on Chromium, Firefox and WebKit.
6. **Publish results** in the docs and a post, including the case where the TS engine wins.

## Open risks

- The binary value codec may cost more than the copies it saves; measure early with a TS-only SAB prototype before writing Rust.
- COOP/COEP breaks many third-party embeds, which limits who can use this; keep it opt-in.
