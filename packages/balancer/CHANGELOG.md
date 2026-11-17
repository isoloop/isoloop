# @isoloop/balancer

## 0.1.0-next.0

### Minor Changes

- 0e0ca1c: Experimental ([ADR 0017](https://github.com/isoloop/isoloop/blob/main/docs/adr/0017-opt-in-balancer.md)). `createBalancer(kernel)` places isolates in pools by measured load instead of a fixed `pool` name, moves one out when its pool lags or fills, and quarantines an isolate that keeps blocking. A kernel has one balancer at a time; `dispose()` gives the kernel back.
  
  This entry replaces the interim notes written during development with the package as it stands before its first versioned prerelease.
  
  The working notes written before this release are kept as history in [`docs/history/interim-changesets.md`](https://github.com/isoloop/isoloop/blob/main/docs/history/interim-changesets.md).

### Patch Changes

- Updated dependencies [0e0ca1c]
- Updated dependencies [f37983d]
  - @isoloop/host@0.1.0-next.0
