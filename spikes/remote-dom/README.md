# Remote DOM spike (M1 task 4)

Scratch code on the `spike/m1-remote-dom` branch. Never merged. It answers the three
questions in [ADR 0006](../../docs/adr/0006-render-bridge-over-remote-dom.md) point 6 and
estimates an in-house bridge.

Pinned: `@remote-dom/core` 1.12.1 (with `@remote-dom/polyfill` 1.7.0), published 2026-10-30.

## Run

```sh
pnpm exec vitest run --config spikes/remote-dom/vitest.config.js --silent=false   # worker → host mirror in Chromium
node spikes/remote-dom/api-usage.mjs preact                                         # DOM APIs Preact calls
node spikes/remote-dom/api-usage.mjs react                                          # DOM APIs React calls
node spikes/remote-dom/count-lines.mjs                                              # Remote DOM code size
```

The sandbox this spike was written in couldn't run `pnpm install` (pnpm's store lock lives
in `/tmp`), so `node_modules/` here was unpacked from the npm tarballs by hand and the
lockfile isn't updated.

## Answers

- **(a) Are mutation records plain, structured-cloneable data? Yes**, for standard elements.
  Records are tuples of numbers, strings and plain objects. Over 5 batches and 11 records
  (build, text and attribute update, keyed reorder, remove, event-driven update),
  `structuredClone` never failed and a JSON round trip changed nothing. The one exception
  is Remote DOM's own custom-element event listeners (`RemoteElement` with `events`),
  which put functions into records. We don't use those (ADR 0006 point 3).
- **(b) Can remote nodes map to our own ids? Yes.** The polyfill's
  `hooks.createElement` and `hooks.createText` run on creation, and `setRemoteId(node, id)`
  sets the id Remote DOM sends. The root must keep `ROOT_ID` (`'~'`); the hook skips it.
  On the host, our own applier keeps `Map<id, Node>` and `WeakMap<Node, id>`.
- **(c) Can we intercept listener registration? Yes.** `hooks.addEventListener` and
  `hooks.removeEventListener` fire for every element. Listeners never enter the records.
  The spike keeps a `(nodeId, type) → listeners` table, and a host click sent as
  `{ id, type }` round-trips and updates the tree.

## Gaps the bridge has to close (task 5)

- **No `element.style`.** The polyfill has no `CSSStyleDeclaration`, and both Preact and
  React crash without it (React at import time). The bridge needs a style shim that
  writes the `style` attribute.
- **Element properties aren't synced.** `input.value = 'x'` stays in the worker; the host
  input stays empty. Preact falls back to attributes, because the polyfill has no `value`
  property, but React writes `value`, `checked`, `defaultValue`, `defaultChecked`, `name`
  and `type` as properties. The bridge has to forward these, or the host-owned input rules
  (design §4.6) have to cover them.
- **Missing element classes.** React's commit phase uses `instanceof HTMLIFrameElement`;
  the polyfill defines no `HTMLIFrameElement`, `HTMLInputElement`, `HTMLTextAreaElement`
  or `HTMLSelectElement`. The shim adds stub classes.
- **A move is a remove plus a re-insert of the whole serialized subtree.** Identity survives
  only because our host applier defers forgetting removed nodes to the end of the batch.
- **`DOMRemoteReceiver` is deprecated.** The host side has to be our own applier on
  `createRemoteConnection`, which matches ADR 0006 (only the worker-side shim and
  mutation recording come from Remote DOM).

## DOM APIs the frameworks call (public members, polyfill internals left out)

- **Preact 11.1.1:** `createElement`, `createElementNS`, `createTextNode`,
  `setAttribute`, `removeAttribute`, `attributes`, `localName`, `namespaceURI`,
  `nodeName`, `tagName`, `data`, `addEventListener`, `dispatchEvent`, `firstChild`,
  `nextSibling`, `parentNode`, `ownerDocument`, `append`, `insertBefore`, `removeChild`,
  `remove`, `querySelector` (spike only), and `style`.
- **React 19.3.1:** the same core, plus `appendChild`, `replaceChildren`, `lastChild`,
  `nodeValue`, `textContent`, `removeEventListener`, `Event.isTrusted`; property writes
  `value`, `checked`, `defaultValue`, `defaultChecked`, `name`, `type`, `onclick`; and
  `style`.

Raw logs: `preact-api-usage.json`, `react-api-usage.json`.

## In-house bridge estimate

Remote DOM today is about 4,270 code lines in `@remote-dom/polyfill` and 2,690 in
`@remote-dom/core` (about 950 of those are receivers we wouldn't use). Our own version of the
part we use:

| Piece | Lines (rough) |
| --- | --- |
| Node tree: `Node`, `Element`, `Text`, `Comment`, `DocumentFragment`, `Document`, child ops, siblings | 450 |
| Attributes, `classList`, `style` shim, the synced properties above | 250 |
| `EventTarget` and `Event` with capture and bubble (worker-side dispatch) | 250 |
| A small `querySelector` (tag, id, class, attribute) | 150 |
| Mutation recording and per-microtask batching, with our ids | 150 |
| Host applier with deferred detach (already needed with Remote DOM) | 200 |
| **Total** | **≈1,450** |

So it's about a fifth of Remote DOM's size, because we'd only need the subset the two
frameworks call. `legacy-vdom` (about 250 lines) covers none of the polyfill side. Tests:
the bridge conformance suite (task 4b) plus a framework smoke test per adapter.
