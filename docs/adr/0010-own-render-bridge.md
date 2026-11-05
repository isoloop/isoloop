# ADR 0010: Our own render bridge (`isoloop-dom@1`)

- **Status:** Proposed
- **Date:** 2026-11-05
- **Supersedes:** [ADR 0006](0006-render-bridge-over-remote-dom.md) (Remote DOM behind a `RenderBridge`)
- **Evidence:** the M1 task 4 spike, draft PR #23 (branch `spike/m1-remote-dom`, `spikes/remote-dom/README.md`)

## Context

ADR 0006 adopted Shopify Remote DOM behind our own `RenderBridge`, gated by a spike. The spike ran Remote DOM 1.12.1 (polyfill 1.7.0) in a worker against a host applier of our own, and rendered Preact 11 and React 19 into the polyfill.

All three gate questions came back "yes": mutation records are plain, structured-cloneable data, nodes can carry our ids, and listener registration can be intercepted. Remote DOM would work. But the spike also showed what we'd be adopting:

1. **No `element.style`.** Both Preact and React crash without it; React already does at import time.
2. **Element properties aren't synced.** React writes `value`, `checked` and similar as properties, and those never leave the worker.
3. **No `HTML*Element` classes.** React's commit phase checks `instanceof HTMLIFrameElement`, and the polyfill has no such class.
4. **A move is a remove plus a re-insert of the whole serialized subtree.** Node identity and focus survive only if the host defers forgetting removed nodes.
5. **Listeners and properties go through hooks we'd have to fill in ourselves**, for every element.

On the host, `DOMRemoteReceiver` is deprecated, so we'd write the applier ourselves anyway.

So we'd keep about 7,000 lines of dependency (about 4,270 in `@remote-dom/polyfill` and 2,690 in `@remote-dom/core`), patch five gaps around it, and still own the host side. The spike's logs also show how little of it the frameworks use: about 30 public DOM members. An in-house bridge for exactly that subset is estimated at about 1,450 lines.

The maintainer's preference is to own the stack and keep dependencies to a minimum. ADR 0006 already planned this as the replacement path; the spike shows it's cheaper to take now than to build on Remote DOM and replace it later.

## Decision

1. **We write our own render bridge, `isoloop-dom@1`, with no dependency.** It is small and covers exactly what the Preact and React adapters need. Remote DOM isn't used.
2. **The worker side is a DOM subset**, installed as `document` and the DOM globals only in isolates that have a surface. It provides:
   - **Documents and nodes:** `document.createElement`, `createElementNS` (SVG namespace only), `createTextNode`; `Node`, `Element`, `HTMLElement`, `SVGElement`, `Text`.
   - **Tree reads:** `parentNode`, `firstChild`, `lastChild`, `nextSibling`, `childNodes`, `children`, `nodeType`, `nodeName`, `localName`, `tagName`, `namespaceURI`, `ownerDocument`, `nodeValue`, `textContent`, `data`.
   - **Tree writes:** `appendChild`, `insertBefore`, `removeChild`, `replaceChildren`, `append`, `remove`.
   - **Attributes:** `setAttribute`, `removeAttribute`, `getAttribute`, `attributes`.
   - **`style`:** property writes, `setProperty`, `removeProperty`, `cssText`, recorded as the `style` attribute.
   - **Synced properties:** `value`, `checked`, `selected`, plus `defaultValue`, `defaultChecked`, `name` and `type`, which map to attributes.
   - **Events:** `EventTarget` with `addEventListener`, `removeEventListener` and `dispatchEvent` (capture and bubble, inside the worker); `Event` with `isTrusted`.
   - **`instanceof` classes:** `HTMLInputElement`, `HTMLTextAreaElement`, `HTMLSelectElement`, `HTMLIFrameElement`.
3. **Records keep ADR 0006's contracts.** A `patch` envelope carries `{ fmt: 'isoloop-dom@1', batch }`. A batch is an array of plain tuples, one per change, collected per microtask:
   - `insert(parentId, node, beforeId | null)`, where `node` is a new subtree;
   - `move(parentId, nodeId, beforeId | null)`, so an existing node moves in **one record**, without re-serializing it, and keeps its identity on the host;
   - `remove(nodeId)`, `text(nodeId, data)`, `attr(nodeId, name, value | null)`, `prop(nodeId, name, value)`;
   - `listen(nodeId, type, on)`, so listener registration travels as data. Functions never cross the boundary.

   Node ids are ours, assigned when a node is created. Records reference nodes and siblings by id, not by index.
4. **The host side** applies batches through the compositor only. It keeps `id → Node` and `Node → id` (`nodeFor`, `idFor`). Every tag, attribute and URL passes the component registry first (sanitising, I9). Host-owned inputs (design §4.6) decide whether a `prop` record for `value` or `checked` is applied.
5. **Package layout:** `@isoloop/dom`, see [ADR 0011](0011-dom-package.md).
6. **Done means the conformance suite passes** (M1 task 4b, `@isoloop/dom/testing` per [ADR 0011](0011-dom-package.md)) **with no known gaps**, and Preact and React render into the subset in a framework smoke test per adapter (M3).
7. **It grows only on evidence.** A member is added when a conformance case, an adapter test or a real isolate needs it, and each addition comes with a test. `legacy-vdom` stays for benchmarks and as a conformance reference.

### Out of scope

These aren't built. Each one would come in only by a later decision:

- **HTML parsing:** `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `DOMParser`, templates.
- **Queries:** `querySelector`, `querySelectorAll`, `getElementById`, `matches`, `closest`. The frameworks don't use them; isolates keep their own references.
- **Layout and focus in the worker:** `getBoundingClientRect`, `getComputedStyle`, sizes and offsets, `focus()`, `blur()`, scrolling. These are host calls (`measure`, `focus`, `scrollIntoView`).
- **Comments, `DocumentFragment`, `classList`, `dataset`,** and namespaces other than HTML and SVG.
- **`MutationObserver`,** custom elements in the worker, Shadow DOM in the worker, `contenteditable`, selection and ranges.
- **Hydration and server rendering.**
- **Canvas.** It arrives through `requestCanvas` as an `OffscreenCanvas`.
- **Remote DOM's `RemoteElement` custom elements** and function proxying.

## Consequences

- **No rendering dependency.** The kernel depends on nothing but its own packages, and the wire format, ids, events and sanitising are ours end to end.
- **About 1,450 lines to write and maintain** instead of about 7,000 adopted lines plus patches. It's bounded by the list above and kept honest by the conformance suite.
- **Framework changes are our problem.** A Preact or React release that starts calling a member we lack fails the adapter smoke tests. We add that member; we don't wait for an upstream release.
- **Moves are cheap and keep identity,** which the keyed-reorder and focus case in the conformance suite checks.
- **Pools (M2c):** one worker installs one `document`. That doesn't change, so visual isolates still can't share a pooled worker until surfaces can be scoped per isolate.
- **M1 task 5 grows** from wrapping Remote DOM to building the subset. It stays one task, and splits if it takes more than two evenings.

## Alternatives considered

- **Remote DOM as decided in ADR 0006:** it works (all three gate questions came back "yes"), but means about 7,000 adopted lines, five gaps to patch, a deprecated receiver, and the replacement project still ahead of us.
- **Remote DOM's polyfill only, with our own records:** removes the receiver question but keeps the largest part of the dependency (about 4,270 lines) and the `style`, property and class gaps.
- **Extend `legacy-vdom` with keyed diffing:** no DOM in the worker, but frameworks render into a DOM, so every adapter would need its own virtual-DOM reconciler. That's more code than the subset.
