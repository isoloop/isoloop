# ADR 0015: Visual isolates in pools, one document per worker

- **Status:** Accepted (2026-11-09)
- **Date:** 2026-11-09
- **Amends:** [ADR 0001](0001-one-worker-per-isolate.md) (visual isolates may join a pool) and [ADR 0010](0010-own-render-bridge.md) (one `isoloop-dom` document per worker, now with one render root per member)
- **Plan:** [M2d](../plans/m2d-visual-pools.md), task 0

## Context

M2c built pools for headless isolates. A visual isolate that names a pool is rejected with `pools_headless_only`, because the render bridge installs one global `document` per worker (ADR 0010, point 2) and every surface maps to that document's single render root. Dashboards with dozens of widgets reach ADR 0001's soft budget of 32 workers well before they run out of work; the plant dashboard ([M3d](../plans/m3d-plant-dashboard.md)) has 72 widgets. The M2c gate measured 71–86% less memory and 2–3× faster start-up for 20 pooled headless isolates.

To pool visual isolates, each member needs its own render root, its own records to its own surface, and its own events, inside one worker. The question is how much of the DOM each member gets to itself, and what the frameworks see.

What the frameworks reference was checked in the versions we support (React DOM 19.3.1, Preact 10.29.8 and 11.1.1):

- **React DOM** creates nodes through the root container's `ownerDocument` and finds the window through `ownerDocument.defaultView`. It also reads the global `document` and `window` in a few places: the "can use DOM" check at module load, a `globalDocument` captured at module load for resource hints (`preload`, `preconnect`), the fallback in `getActiveElement`, and `window.event` for event priority.
- **Preact 11** creates nodes only through `ownerDocument`.
- **Preact 10** creates nodes through the **global** `document` (`document.createElementNS`, `document.createTextNode` in `diff/index.js`).
- An app build emits shared chunks (`react-dom`, `preact`) once, and isolates import them by URL. A worker evaluates a module URL once, so pooled members built together share **one** framework instance; members built apart (ADR 0012) bring their own copies under other URLs.

## Options

**A. Bundle-time binding.** `@isoloop/vite` rewrites each isolate's free references to `document`, `window` and the DOM globals into a per-isolate scoped instance.
- A shared chunk is evaluated once per worker, so a binding baked into it serves only one member. Per-member binding needs a separate module instance per member, which means a separate framework copy per member and gives up much of the memory saving.
- A rewrite doesn't reach `globalThis.document`, `self.document`, `window.document` or code evaluated at runtime, and React DOM captures `globalDocument` at load anyway.
- Isolates built apart from the host (ADR 0012) aren't built by our plugin, so they couldn't join.

**B. Switching the global per task.** Set `globalThis.document` to the running member's document before calling into it. A spike shows the hazard: member A sets its document, awaits, member B runs in between, and A's continuation and A's timer both see B's document (`[A before await: A] [B handler: B] [A after await: B] [A timer: B]`). Any `await`, timer, promise or framework scheduler (React's runs on its own) crosses members. Not safe.

**C. One document per member, frameworks use `ownerDocument`.** A spike in a real worker ran one React DOM instance with two `isoloop-dom` documents, the worker's global set to the first: both roots rendered and updated, and each document's records went only to its own batches. But code that uses the global `document` (Preact 10, and many libraries) creates nodes in the wrong document. In the spike, a `<span>` made with `document.createElement` in member B and appended to B's tree took ids 7 and 8 from A's id space, which B's own next nodes would reuse. That is fixable with adoption on insert, but listeners on `document` and `window` (keyboard shortcuts, outside-click handlers) and queries (`document.activeElement`, `getElementById`) would still land in the wrong member's document, silently.

**D. One document per worker, one render root per member.** The pooled worker keeps a single document, as today, and gives each visual member its own root element with its own id. The worker sends each member's records separately, tagged with the member, and each surface's applier maps that member's root to its surface. Frameworks and libraries see a single global document, as on any page that has several widgets.

**E. `ShadowRealm`.** Separate globals per member would solve this cleanly, but the proposal is at Stage 2.7 ([tc39/proposal-shadowrealm](https://github.com/tc39/proposal-shadowrealm)), with prototyping in Chromium ([Intent to Prototype](https://groups.google.com/a/chromium.org/g/blink-dev/c/xcfT92S2Xno)) and an open WebKit bug ([283289](https://bugs.webkit.org/show_bug.cgi?id=283289)). It hasn't shipped in any browser, workers included. Noted as the long-term option.

## Decision

1. **Visual isolates may join a pool (option D).** `pools_headless_only` goes away. A pool can hold visual members, headless members, or both (mixed pools, as the plant dashboard's `machine` placement needs). Placement stays the host manifest's choice alone (ADR 0001).
2. **One `isoloop-dom` document per worker, one render root per visual member.** Each member's root is an element with its own id in the worker's id space, and that root is the member's `ctx.root`. Ids are unique per worker, so a node id names one node whichever member holds it.
3. **Records go out per member.** The worker attributes each record to the member whose root holds the node, and posts that member's batch on its own envelope with `isolate` (the field M2c added). **Moving a node from one member's root into another's is forbidden:** the worker throws an error attributed to the member doing the move, so one member can't take or inject another's nodes.
4. **The host keeps one applier per surface, unchanged.** In each member's outgoing records the worker writes that member's root as the standard root id, and translates the standard root id back to the member's root for that member's incoming events and host calls. So every applier still sees a surface with the fixed root id, and neither the applier nor the protocol changes (ADR 0010's format is unchanged: records, ids and moves stay the same). Frame budgets, update counts and timings stay per isolate. *(Amended 2026-11-09 to describe M2d as built; the draft had the applier take each member's root id, with the same effect.)*
5. **Events and host calls carry the member.** The host sends a surface's events on that member's envelope; the worker delivers them to the node they name, so capture and bubble run from the node through the member's root to the shared document, as on a page. `measure`, `focus`, `scrollIntoView` and other host calls name the member and the node id, and the host resolves them through that member's applier.
6. **Members of a pool can read each other's DOM and input.** On top of what M2c's pools already share (event loop, timers, `globalThis`, frozen built-ins, fate), they share:
   - **the document:** a member can see and query other members' nodes, including what users typed into another member's fields;
   - **document and window listeners:** a key listener on `document` in one member hears keystrokes in every member's fields;
   - **the focus:** one `document.activeElement`, as on a page;
   - **the head:** hoisted tags and styles are page-wide on the host anyway;
   - **framework instances,** when members were built together;
   - **frames:** one `requestAnimationFrame` loop in the worker.

   Pooling is the host's explicit opt-in, per isolate, in the manifest; nothing is pooled by default. The guide and devtools state it plainly: "members of this pool can read each other's DOM and input". Widgets that handle secrets (passwords, tokens, payment details) stay on their own worker. Pools stay for trusted members, as ADR 0001 says.
7. **React and Preact members may share a pool.** They share the document like any members. The guide recommends one framework per pool, since the memory saving comes from members sharing one framework instance; M2d tests a pool that mixes them.
8. **Errors.** An error the runtime can attribute stays the member's own: `start()` throwing, and a render error the adapter catches at the member's root (`@isoloop/react` and `@isoloop/preact` wrap each member root in a boundary that reports to that member). An error it can't attribute, such as one thrown from a shared scheduler or a timer, is a worker error, and the pool restarts as a group, as in M2c. Attributing those per member with `AsyncContext`, once browsers ship it, is in [would-like](../would-like.md).
9. **Stopping one member** unmounts its root, removes it from the document and forgets its nodes, while the pool keeps running. As in M2c, timers the member left running keep going; the guide says to clear them in `onShutdown`.
10. **Isolates built apart (ADR 0012) can join.** Option D needs nothing from the isolate's build: it renders into `ctx.root` and uses the global document as in its own worker. Members built apart carry their own framework copy, so they share less memory.
11. **A portal root per member.** Libraries that render modals, tooltips, toasts and menus into `document.body` would reach no surface, in a pool or in its own worker. The adapters give each member a portal container inside its own root (for example `ctx.portalRoot`), and the guide shows how to point such libraries at it. Overlays that must cover the whole page, outside the member's surface, stay a host concern.
12. **Gate first (M2d task 1).** Before any pool code, a prototype puts 8 React widgets in one worker with this design against 8 own workers, on Chromium, Firefox and WebKit. It measures memory, start-up, and the p95 time from a record being published to its patch being applied, with the 8 widgets updating at the plant dashboard's data rate. M2d stops, and this ADR records the result, if either:
    - pooling saves less than about 30% memory and doesn't start the widgets faster; or
    - the pooled p95 is more than twice the own-worker p95 **and** more than 50 ms.

ADR 0001's staging note and ADR 0010's point 2 point here.

## Gate result (2026-11-09)

Passed on all three engines ([bench/visual-pools](../../bench/visual-pools/README.md), M2d task 1). 8 React widgets in one worker, one document with a root per widget, against 8 own workers, fed at the plant dashboard's data rate (vibration in 50 ms chunks at 1 kHz, slow signals every 200 ms). Medians of 7 runs, each in a fresh browser:

| Engine | Memory, own → pool | Saving | Start-up, own → pool | p95 publish→patch, own → pool |
|---|---|---|---|---|
| Chromium | 96.7 → 63.0 MB | 35% | 75 → 36 ms | 9.8 → 9.6 ms |
| Firefox | 83.3 → 30.4 MB | 64% | 62 → 39 ms | 17.4 → 17.3 ms |
| WebKit | 132.6 → 66.3 MB | 50% | 35 → 33 ms | 16.8 → 16.6 ms |

Neither stop condition was met: the memory saving is at least 30% everywhere (Chromium's 35% is the closest), and the pooled p95 is within a few tenths of a millisecond of the own-worker p95. Limits:

- **Light widgets:** one event loop keeps up with all 8; heavier widgets in one pool delay each other.
- **A prototype:** no runtime, supervision or per-member record routing, which the real pool adds.
- **Frame-quantised latency:** differences smaller than a frame don't show.
- **Widgets built together** share one React instance; widgets built apart save less.
- **One machine:** desktop Linux with many cores; the plant dashboard measures a mid-range phone.

## Consequences

- **Good:**
  - frameworks and libraries see one document, as on a page, so no rebinding and no build step;
  - members built together share one framework instance, which should make the saving larger than if each member carried its own (the gate measures it);
  - the record format and the host applier barely change;
  - isolates built apart can still join.
- **Bad:**
  - no DOM isolation between members of a pool: a member can read another's DOM and what users type into it, and document listeners and focus are shared. That fits ADR 0001's "trusted members only", but it's a step further than M2c's shared globals, so secrets stay on their own worker;
  - a library that portals into `document.body` needs pointing at the member's portal root;
  - one busy member delays every member's renders in that worker. That's the pool's shared event loop, and the plant dashboard keeps heavy computation in data pools for that reason;
  - an error thrown from a shared framework scheduler can't be traced to a member, so it restarts the whole pool;
  - attributing records per member costs a lookup per record (the node's member, cached on insert).
- **To verify in M2d:** React's resource hints (`preload`, `preconnect`) and `<title>` hoisting with several roots; focus moving between two members' surfaces; and a member stopping while others keep rendering.

## Alternatives considered

Options A, B, C and E above. A loses most of the memory saving and excludes isolates built apart. B is unsafe across `await` and timers. C misroutes libraries that use the global document. E isn't available.
