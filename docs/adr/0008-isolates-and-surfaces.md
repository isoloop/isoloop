# ADR 0008: Isolates are the unit; surfaces are optional

- **Status:** Accepted
- **Date:** 2026-11-03
- **Refines:** RFC 0001 "Pane model and lifecycle"

## Context

RFC 0001 called the unit of isolation a *pane*: a UI region with its own worker. But many things worth isolating draw nothing: a state manager, a data-sync engine, a pricing or permissions calculator, analytics, or a set of subscribers that turn one topic into another. Today they would have to fake an empty pane, or run on the main thread and lose every guarantee.

## Decision

- The unit is an **isolate**: a manifest plus a code bundle, running in its own worker, supervised, with granted topics. It's the same thing for visual and headless code.
- An isolate **may have a surface**: a host DOM element it renders into. `surface` is an optional manifest field.
- API names follow from this:
  - host: `kernel.spawn(manifest)`, `kernel.stop(id)`, `kernel.restart(id)`, `kernel.isolates()`;
  - isolate module: `export default defineIsolate({ start(ctx) { … } })`, or an adapter's `defineIsolate(Component)` for visual isolates;
  - protocol and types: `IsolateManifest`, `IsolateContext`, `isolateId`;
  - the worker-side package is `@isoloop/runtime`.
- **Headless isolates:**
  - `init.renderFmt` is `'none'`; no RenderBridge polyfill is installed (smaller and faster start), and `ctx.root` is `undefined`;
  - they never reach the compositor and never post `patch` (the host drops and counts it if they do);
  - the DOM host calls (`measure`, `focus`, `scrollIntoView`) reject with `no_surface`; `navigate` still works. `requestCanvas` rejects with `unsupported` for every isolate until it ships in M3;
  - supervision, heartbeats, bus access and replay are identical to visual isolates. A crashed headless isolate has no fallback UI; the host sees `isolate:crash` / `isolate:failed` events.
- A visual isolate's surface can be **detached and re-attached** later (for example a widget moved between dashboard slots) without restarting the worker. The compositor replays the current tree to the new surface. This is an M3 feature, not a v1 promise.

## Consequences

- Headless state stores are a first-class use case: a store isolate owns state, publishes it to a compacted topic, and UI isolates subscribe. That's a natural fit for the log bus.
- Docs and examples must show a headless isolate early (the README does), so people don't read Isoloop as UI-only.
- The kernel's events are `isolate:*` (`isolate:state`, `isolate:crash`, `isolate:failed`, `isolate:error`).

## Alternatives considered

- **Keep "pane" and add `headless: true`:** the word would mislead for half the use cases.
- **"Actor":** fits the supervision model, but implies actor semantics (a mailbox per actor, addressing by actor id) that the topic-based bus deliberately avoids.
- **"Unit" / "cell":** neutral, but "isolate" also says what it guarantees.
