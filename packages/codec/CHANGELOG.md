# @isoloop/codec

## 0.1.0

The first release. An internal package: app code never imports it, and its API carries no semver promise of its own.

- `encode` and `decode` for topic records in the binary format `isoloop-codec@1`, which persistent topics are stored in.

The changes made during the previews are in the `0.1.0-next.N` sections below.

## 0.1.0-next.12

### Patch Changes

- 3afc5f8: Each package's homepage on npm is its page on isoloop.dev, and each has search keywords. The public packages' npm descriptions say that they're Isoloop's and what each one does.

## 0.1.0-next.11

No changes in this release.

## 0.1.0-next.10

No changes in this release.

## 0.1.0-next.9

### Patch Changes

- e5f3377: The API freeze marks Isoloop's own internals `@internal`, so they leave the public API and its reference: the bus's engine, storage and broker types and its helpers (`Broker`, `TsEngine`, `MemoryStorage`, `LogEngine`, `estimateSize`, `isContracts`, `topicConfig` and the rest), host's `HostRenderBridge`, runtime's `REQUIRES`, vite's `ISOLATES_ID`, `MANIFEST` and `WORKERS_ID`, and the worker DOM and applier in `@isoloop/dom/worker` and `@isoloop/dom/host`. They're still exported for the other `@isoloop/*` packages; app code shouldn't import them. `@isoloop/protocol` and `@isoloop/codec` say they're internal packages in their READMEs.

## 0.1.0-next.8

No changes in this release.

## 0.1.0-next.7

No changes in this release.

## 0.1.0-next.6

No changes in this release.

## 0.1.0-next.5

No changes in this release.

## 0.1.0-next.4

No changes in this release.

## 0.1.0-next.3

No changes in this release.

## 0.1.0-next.2

No changes in this release.

## 0.1.0-next.1

No changes in this release.

## 0.1.0-next.0

### Minor Changes

- 0e0ca1c: `encode` and `decode` for topic records in Isoloop's own binary format, `isoloop-codec@1`: the structured-clone types topics allow, with no dependencies. Persistent topics store their records in it ([ADR 0014](https://github.com/isoloop/isoloop/blob/main/docs/adr/0014-own-codec.md)).
  
  This entry replaces the interim notes written during development with the package as it stands before its first versioned prerelease.
  
  The working notes written before this release are kept as history in [`docs/history/interim-changesets.md`](https://github.com/isoloop/isoloop/blob/main/docs/history/interim-changesets.md).
