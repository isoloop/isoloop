# ADR 0006: Remote DOM sits behind an internal RenderBridge

- **Status:** Proposed
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

## Consequences

- Remote DOM can be upgraded, or replaced, by changing one module per side.
- We maintain a small event layer ourselves instead of using Remote DOM's.
- Two bridges exist until M1 ends; `legacy-vdom` is then kept only for benchmarks (or deleted).

## Alternatives considered

- **Use Remote DOM end to end, including function proxying:** less code, but events become opaque RPC and the RFC's input model (host-owned inputs, prevented default actions) has to be added on top anyway.
- **Our own DOM polyfill and diff:** most control, but it's the maintenance burden the RFC chose Remote DOM to avoid.
