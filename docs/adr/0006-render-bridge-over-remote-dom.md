# ADR 0006: Remote DOM sits behind an internal RenderBridge

- **Status:** Superseded by [ADR 0010](0010-own-render-bridge.md) after the M1 spike (draft PR #23)
- **Date:** 2026-11-03
- **Refines:** RFC 0001 "Rendering bridge"

## Context

RFC 0001 builds rendering on Shopify Remote DOM and lists "Remote DOM API changes" as a medium risk. Remote DOM has its own wire format (a connection with mutation records) and, by default, proxies functions across the thread boundary for event handlers. RFC 0001 also specifies its own event model: one listener per surface, serialized events, host-owned inputs, and default actions prevented on the host.

The proof of concept used neither. It re-sent a whole tree per render and named handlers by string.

## Decision

1. **`RenderBridge` interface** in `@isoloop/host` (and its isolate-side twin in `@isoloop/runtime`) is the only code that imports Remote DOM. Its contract:
   - isolate side: `createRoot(): RemoteRoot`, emits `PatchBatch` values (opaque to the rest of the runtime);
   - host side: `mount(shadowRoot, registry)`, `apply(batch)`, `nodeFor(nodeId)`, `idFor(node)`, `unmount()`.
2. **`patch`** envelopes carry Remote DOM mutation records unchanged, tagged with the bridge format and version (`fmt: 'remote-dom@1'`), so a mismatch fails at `init` and not mid-render.
3. **Events don't use Remote DOM's function proxying.** The isolate-side bridge records listeners as `(nodeId, eventType)` registrations. The host's `EventBridge` listens once per surface, maps the target to a node id, serializes the event, and sends an `event` envelope. The isolate runtime dispatches it to the registered listener on the remote node. That keeps the protocol copyable, versioned and inspectable in devtools.
4. M0 ships a **`legacy-vdom` bridge**, a port of the proof of concept's renderer behind the same interface. It is the fallback if Remote DOM blocks progress, and a benchmark baseline.
5. **Bridge conformance suite.** One test suite (`packages/host/test/render-bridge-conformance.ts`) that every bridge must pass: create, update, move and remove nodes and text; keyed list reorders; attribute and URL sanitising; node-id mapping; listener registration; event round-trip; host-owned inputs; styles. `legacy-vdom` and the Remote DOM bridge both run it, and so would any future bridge.
6. **The spike decides, with exit criteria.** M1 opens with a one-evening Remote DOM spike that must confirm: (a) its mutation records are plain, structured-cloneable data; (b) we can map remote nodes to our own ids; (c) we can intercept listener registration. If any fails, we write a follow-up ADR choosing between patching Remote DOM and building our own bridge. The spike also **estimates the size of an in-house bridge** (worker-side DOM subset plus mutation recording), so that option is costed, not hypothetical.

## Ownership

The maintainer's preference is to own the stack end to end and keep external dependencies to a minimum. Remote DOM is adopted because it saves the hardest maintenance work now, not as a permanent commitment:

- Remote DOM is confined to one module per side, and nothing outside the bridge sees its types.
- The wire format, the event model, node ids and sanitising are ours from day one; only the worker-side DOM shim and mutation recording come from Remote DOM.
- Replacing it is a contained project: write a new bridge, pass the conformance suite, flip the `fmt`. Good moments to revisit: after M3, when real React and Preact usage shows which DOM APIs we actually need, or whenever a Remote DOM upgrade costs more than an own implementation would.

## Consequences

- Remote DOM can be upgraded, or replaced, by changing one module per side.
- We maintain a small event layer ourselves instead of using Remote DOM's.
- Two bridges exist until M1 ends; `legacy-vdom` is then kept for benchmarks and as a conformance reference.
- The conformance suite is extra up-front work, but it is what makes swapping Remote DOM out realistic.

## Alternatives considered

- **Use Remote DOM end to end, including function proxying:** less code, but events become opaque RPC and the RFC's input model (host-owned inputs, prevented default actions) has to be added on top anyway.
- **Our own DOM polyfill and diff now:** most control and no dependency, but it's the hardest maintenance work, and it would delay M1. Kept open as the planned replacement path (see Ownership).
