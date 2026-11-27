# @isoloop/dom

## 0.2.0-next.0

### Patch Changes

- abf56ab: The host writes the `style` an isolate renders through the element's CSSOM (`el.style.cssText`) instead of `setAttribute('style', …)`, and the devtools panel styles its own page elements the same way. A page with surfaces now works under `style-src 'self'`, with no `'unsafe-inline'`: before, the browser dropped those styles and logged a violation for each. `devCsp()` still allows `'unsafe-inline'` in `style-src`, for the `<style>` elements Vite's dev server injects; its TSDoc and the hosting guide say so.

## 0.1.0

The first release. An internal package: app and adapter code never imports it.

- The render bridge, format `isoloop-dom@1`: the worker DOM, the records it sends and the applier on the page.

The changes made during the previews are in the `0.1.0-next.N` sections below.

## 0.1.0-next.12

### Patch Changes

- 3afc5f8: Each package's homepage on npm is its page on isoloop.dev, and each has search keywords. The public packages' npm descriptions say that they're Isoloop's and what each one does.

## 0.1.0-next.11

No changes in this release.

## 0.1.0-next.10

### Patch Changes

- 8e03048: The TSDoc of `@isoloop/dom/testing`, `@isoloop/dom/testing/worker` and the types they return (`WorkerDom`, `RenderRoot`, the record and event types) is complete: a lead, `@param`, `@returns` and `@throws` on every function, and a comment on each field. It names no design records.

## 0.1.0-next.9

### Minor Changes

- e5f3377: The API freeze marks Isoloop's own internals `@internal`, so they leave the public API and its reference: the bus's engine, storage and broker types and its helpers (`Broker`, `TsEngine`, `MemoryStorage`, `LogEngine`, `estimateSize`, `isContracts`, `topicConfig` and the rest), host's `HostRenderBridge`, runtime's `REQUIRES`, vite's `ISOLATES_ID`, `MANIFEST` and `WORKERS_ID`, and the worker DOM and applier in `@isoloop/dom/worker` and `@isoloop/dom/host`. They're still exported for the other `@isoloop/*` packages; app code shouldn't import them. `@isoloop/protocol` and `@isoloop/codec` say they're internal packages in their READMEs.

## 0.1.0-next.8

### Minor Changes

- c0884d2: The worker DOM's layout members now throw a `NotSupportedError` that says what to use instead, as ADR 0010 (amended 2026-11-16, point 5) decided. Before, they were absent, so a call threw a `TypeError` and a property read gave `undefined`. The methods are `getBoundingClientRect()`, `getClientRects()`, `animate()` and `getAnimations()` on every element, plus `getComputedStyle()` on the worker's `window`. The properties are `offsetWidth`, `offsetHeight`, `offsetTop`, `offsetLeft`, `offsetParent`, `clientWidth`, `clientHeight`, `clientTop`, `clientLeft`, `scrollWidth` and `scrollHeight`. For sizes and positions the message points at `ctx.host.measure(node)` (`useHost().measure` in React and Preact); for animations it points at CSS transitions and animations. Feature checks such as `'animate' in el` now find these members. `scrollTop` and `scrollLeft` still read the last `scroll` event's offsets.

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

- 0e0ca1c: Internal: Isoloop's render bridge, `isoloop-dom@1`. A worker-side DOM subset sized to what Preact and React use, a host-side applier with a sanitising policy, and a conformance suite in `/testing`. `@isoloop/runtime` and `@isoloop/host` use it; app code doesn't ([ADR 0010](https://github.com/isoloop/isoloop/blob/main/docs/adr/0010-own-render-bridge.md), [ADR 0011](https://github.com/isoloop/isoloop/blob/main/docs/adr/0011-dom-package.md)).
  
  This entry replaces the interim notes written during development with the package as it stands before its first versioned prerelease.
  
  The working notes written before this release are kept as history in [`docs/history/interim-changesets.md`](https://github.com/isoloop/isoloop/blob/main/docs/history/interim-changesets.md).
