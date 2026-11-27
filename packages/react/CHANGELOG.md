# @isoloop/react

## 0.2.0-next.0

### Minor Changes

- bb8f473: `useWatch` reads a topic's current value per key instead of its stream. It is experimental.
  
  - `useWatch(topic)` returns a map from key to value; records with no key share the key `null`.
  - `useWatch(topic, { key })` returns one key's value, or `undefined` while it has none.
  - When several values arrive for a key between two renders, only the newest is shown, and the next view waits until the render showing this one has committed.
  - Any number of components can watch one topic; one that mounts later shows the current value at once.
- 78ebf7f: Several components can now `useTopic` the same topic, and they all update. Every `useTopic` on a topic in one isolate shares one bus subscription: the first to mount subscribes, the last to unmount unsubscribes, and a component that mounts later gets the current value at once. Before, a second `useTopic` on a topic replaced the first, which stopped updating. The first `useTopic`'s `from` sets where the shared subscription starts; a later one with a different `from` gets the shared value, and the console warns once. `useRoute` shares the route topic's subscription the same way. The bus's dev warning for a repeated subscribe names `bus.subscribe`, since `useTopic` no longer causes it.

### Patch Changes

- 0b3b48f: Docs: `useHost` now lists `requestCanvas` among the host calls, and the `maxWorkers` option says its default is `max(2, navigator.hardwareConcurrency - 2)` and that a value you set is raised to 1 if lower.
- 8fedffd: With the kernel's `dev: true`, the bus now warns in the console, once per topic per isolate, when an isolate subscribes to a topic it already subscribes to. The newer subscription replaces the older one, as before; the warning names the isolate and the topic, since a second `bus.subscribe` on the same topic is the usual cause.
- d452be7: breaking: `ctx.bus.publish` and `kernel.publish` take the value first and the key in an options object, like `request`, `reply` and `usePublish`: `publish(topic, value, { key? })` instead of `publish(topic, { value, key? })`. `npx isoloop@latest migrate` rewrites the calls it can prove are Isoloop's and marks the ones it can't with a `// isoloop-migrate:` comment; see [From 0.1 to 0.2](https://isoloop.dev/docs/getting-started/#from-01-to-02). An isolate built apart and stamped below 0.2 by `defineIsolate` still gets the old `ctx.bus.publish(topic, { value, key? })` in 0.2, deprecated, with a warning on its first call when the kernel has `dev: true`. `kernel.publish` changes at once. The record on the bus is unchanged.
- 165b28b: - The docs of `useWatch` and `ctx.bus.watch` now say to use `subscribe` to get every record. `useTopic` shows only the newest value, so it doesn't get every record either.
  - The docs of `useTopic` say that every record reaches the isolate, and point to `useWatch` for showing the current value per key.
- Updated dependencies [d452be7]
- Updated dependencies [659eefa]
- Updated dependencies [de19016]
- Updated dependencies [f96ad9b]
- Updated dependencies [05e956c]
- Updated dependencies [165b28b]
  - @isoloop/runtime@0.2.0-next.0
  - @isoloop/protocol@0.2.0-next.0

## 0.1.0

The first release of the React adapter, for React 18 and 19.

- **Your components in a worker:** `defineIsolate(Component)` turns a React component into an isolate.
- **Topics as state:** `useTopic` follows a topic's latest value, and `usePublish` writes to a topic.
- **The page through hooks:** `useHost` to measure, focus, scroll, navigate and get a canvas, and `useRoute` for the current location.
- **Portals:** `usePortalRoot` gives modals, tooltips and menus a place inside the isolate.
- **Errors reach the supervisor:** a render error restarts that isolate, and in a pool only that member.
- **Experimental:** `useRequest`.

The changes made during the previews are in the `0.1.0-next.N` sections below.

## 0.1.0-next.12

### Patch Changes

- 3afc5f8: Each package's homepage on npm is its page on isoloop.dev, and each has search keywords. The public packages' npm descriptions say that they're Isoloop's and what each one does.
- 03d13ef: Each package has a README on npm: what it gives you, how to install it, a small example, and links to its guides and API reference.
- 57025cb: The docs for `useTopic` say that an isolate has one subscription per topic: a second `useTopic` on the same topic replaces the first with no error, so only the last one gets records. They suggest one `useTopic` per topic, with the value passed down or shared through context.
- Updated dependencies [2788228]
- Updated dependencies [3afc5f8]
- Updated dependencies [03d13ef]
  - @isoloop/protocol@0.1.0-next.12
  - @isoloop/runtime@0.1.0-next.12

## 0.1.0-next.11

### Patch Changes

- @isoloop/protocol@0.1.0-next.11
  - @isoloop/runtime@0.1.0-next.11

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

- 0e0ca1c: React isolates: `defineIsolate(Component)` and the hooks `useTopic`, `usePublish`, `useRequest`, `useHost`, `useRoute`, `useIsolate` and `usePortalRoot`. React 18 and 19 are supported. A render error is caught at the isolate's root and reported as its own, so in a pool only that member restarts.
  
  This entry replaces the interim notes written during development with the package as it stands before its first versioned prerelease.
  
  The working notes written before this release are kept as history in [`docs/history/interim-changesets.md`](https://github.com/isoloop/isoloop/blob/main/docs/history/interim-changesets.md).

### Patch Changes

- Updated dependencies [0e0ca1c]
- Updated dependencies [0e0ca1c]
- Updated dependencies [f37983d]
  - @isoloop/protocol@0.1.0-next.0
  - @isoloop/runtime@0.1.0-next.0
