# @isoloop/preact

## 0.1.0-next.10

### Patch Changes

- 799ca7e: The React and Preact adapters' doc comments are complete: each export says what it does, its parameters, what it returns and the error codes it rejects with, and `defineIsolate` has an example. `RouteValue` documents each field.
- Updated dependencies [b303cb3]
- Updated dependencies [799ca7e]
  - @isoloop/runtime@0.1.0-next.10
  - @isoloop/protocol@0.1.0-next.10

## 0.1.0-next.9

### Minor Changes

- 5793b1a: Names settled for the API freeze:
  
  - `@isoloop/vite`: `IsolateManifest`, the type of `isoloop-manifest.json`, is now `BuildManifest`, so it no longer shares a name with host's spawn manifest.
  - `@isoloop/host`: `kernel.request`'s options type is now `KernelRequestOptions` (`key`, `timeoutMs`, `signal`, `via`).
  - `@isoloop/runtime`: exports `RequestOptions` (`key`, `timeoutMs`), the type of `bus.request`'s options. `@isoloop/react` and `@isoloop/preact` re-export it for `useRequest`, in place of their own copies.
  - `@isoloop/balancer`: `createBalancer` takes host's `Kernel`. `KernelLike`, `ManifestLike`, `BeatLike`, `CrashLike`, `FailedLike` and `PoolLike` are no longer exported, and every export is `@experimental`.
  - Marked `@experimental`: consumer groups (`SubscribeOptions.group`, `autoCommit`, `bus.commit`) and request/reply (`bus.request`, `bus.reply`, a topic's `reply` schema, `useRequest`, `RequestOptions`).

### Patch Changes

- Updated dependencies [e5f3377]
- Updated dependencies [5793b1a]
- Updated dependencies [18972a8]
  - @isoloop/runtime@0.1.0-next.9
  - @isoloop/protocol@0.1.0-next.9

## 0.1.0-next.8

### Patch Changes

- @isoloop/runtime@0.1.0-next.8
  - @isoloop/protocol@0.1.0-next.8

## 0.1.0-next.7

### Patch Changes

- Updated dependencies [3c354e8]
  - @isoloop/protocol@0.1.0-next.7
  - @isoloop/runtime@0.1.0-next.7

## 0.1.0-next.6

### Patch Changes

- Updated dependencies [8e04ddf]
- Updated dependencies [0a22865]
  - @isoloop/protocol@0.1.0-next.6
  - @isoloop/runtime@0.1.0-next.6

## 0.1.0-next.5

### Patch Changes

- Updated dependencies [080059d]
  - @isoloop/runtime@0.1.0-next.5
  - @isoloop/protocol@0.1.0-next.5

## 0.1.0-next.4

### Patch Changes

- @isoloop/protocol@0.1.0-next.4
  - @isoloop/runtime@0.1.0-next.4

## 0.1.0-next.3

### Patch Changes

- Updated dependencies [ce4dc9a]
- Updated dependencies [16b3e38]
- Updated dependencies [ffb3ef3]
- Updated dependencies [fcb9fb5]
- Updated dependencies [9137d5e]
- Updated dependencies [29f2296]
- Updated dependencies [c099c70]
- Updated dependencies [12e43d0]
- Updated dependencies [c519268]
  - @isoloop/protocol@0.1.0-next.3
  - @isoloop/runtime@0.1.0-next.3

## 0.1.0-next.2

### Patch Changes

- @isoloop/protocol@0.1.0-next.2
  - @isoloop/runtime@0.1.0-next.2

## 0.1.0-next.1

### Patch Changes

- @isoloop/protocol@0.1.0-next.1
  - @isoloop/runtime@0.1.0-next.1

## 0.1.0-next.0

### Minor Changes

- 0e0ca1c: Preact isolates: `defineIsolate(Component)` and the hooks `useTopic`, `usePublish`, `useRequest`, `useHost`, `useRoute`, `useIsolate` and `usePortalRoot`. Preact 10 and 11 are supported. A render error is caught at the isolate's root and reported as its own, so in a pool only that member restarts.
  
  This entry replaces the interim notes written during development with the package as it stands before its first versioned prerelease.
  
  The working notes written before this release are kept as history in [`docs/history/interim-changesets.md`](https://github.com/isoloop/isoloop/blob/main/docs/history/interim-changesets.md).

### Patch Changes

- Updated dependencies [0e0ca1c]
- Updated dependencies [0e0ca1c]
- Updated dependencies [f37983d]
  - @isoloop/protocol@0.1.0-next.0
  - @isoloop/runtime@0.1.0-next.0
