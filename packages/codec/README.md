# @isoloop/codec

**Internal.** The binary codec for [Isoloop](https://github.com/isoloop/isoloop) topic records: `encode` and `decode` for the structured-clone types a topic allows. `@isoloop/bus` writes persistent topics with it. App code never imports it, and its API carries no semver promise of its own.

| Entry | What it is |
| --- | --- |
| `@isoloop/codec` | `encode`, `decode`, and `CodecError` with its codes. |

The package has no runtime dependencies.
