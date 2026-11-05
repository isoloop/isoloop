# ADR 0011: `@isoloop/dom`, the render bridge package

- **Status:** Proposed
- **Date:** 2026-11-05
- **Builds on:** [ADR 0010](0010-own-render-bridge.md) (our own render bridge, `isoloop-dom@1`)

## Context

ADR 0010 decides to write our own render bridge: a worker-side DOM subset, plain id-based records, and a host applier. It leaves open where that code lives.

The bridge has two halves that must agree on one format. The worker half runs in an isolate and must never see DOM types. The host half runs on the main thread and touches the real DOM. The plan had them split across `runtime/src/render` and `host/src/render`, which puts one format in two packages, versioned and tested separately.

Other forces:

- `protocol` already treats render output as opaque: `patch` is `{ fmt: string; batch: unknown }`.
- The allow-list (component registry, URL rules, host components, the routing rewrite of `<a href>`) lives in `host/src/render/registry.ts` (M1 task 6) and depends on `KernelConfig`.
- The bridge conformance suite (M1 task 4b) is in `packages/host/test` and must run against both `legacy-vdom` and the new bridge.
- In a TypeScript program, `lib` applies to the whole program, so one tsconfig can't keep DOM types out of half a package.

## Decision

1. **One package, `@isoloop/dom` (`packages/dom`), with three entry points:**
   - `@isoloop/dom/worker`: the DOM subset (ADR 0010 point 2), the change recorder, and event delivery.
   - `@isoloop/dom/host`: the applier and the node-id map.
   - `@isoloop/dom/testing`: the bridge conformance suite, `runBridgeConformance(makeBridgePair)`.

   There is no root entry point (`.`). The name says what it is, a DOM bridge. Canvas (`requestCanvas`) and any other output that isn't DOM don't belong here.
2. **Import rules, enforced by oxlint `no-restricted-imports`:**
   - `runtime` may import `@isoloop/dom/worker` only.
   - `host` may import `@isoloop/dom/host` only (and `@isoloop/dom/testing` from its tests).
   - `protocol`, `bus` and `codec` never import `dom`.
   - `dom` imports no other `@isoloop/*` package.
3. **No runtime dependencies; `/testing` has an optional peer on Vitest.** Not even `protocol`. Node ids are plain numbers that `dom` defines. `runtime` and `host` relate them to protocol types if they need to.
4. **`dom` owns the format.** The record types and the fmt constant `ISOLOOP_DOM_FMT = 'isoloop-dom@1'` live in `src/shared` and are exported from both `/worker` and `/host`. `protocol` keeps `patch.batch: unknown` and never learns the record shape.
5. **Four source folders, each type-checked on its own:**

   | Folder | `lib` | Contents |
   | --- | --- | --- |
   | `src/shared` | `ES2022` | record types, fmt constant, id type |
   | `src/worker` | `ES2022`, `WebWorker` | DOM subset, recorder, event delivery |
   | `src/host` | `ES2022`, `DOM`, `DOM.Iterable` | applier, id map, event conversion |
   | `src/testing` | `ES2022`, `DOM`, `DOM.Iterable` | conformance suite |

   Each folder has its own tsconfig (`tsconfig.shared.json`, `tsconfig.worker.json`, `tsconfig.host.json`, `tsconfig.testing.json`), and `typecheck` runs all of them. `src/shared` imports nothing outside itself. `src/worker` and `src/host` import `src/shared` but not each other. Only `src/testing` sees both halves, because a bridge pair is both. A stray `document` in the worker half fails the build, not a review. tsdown builds one entry per subpath.
6. **What `dom` owns, and what it doesn't:** the format end to end, with no timing and no policy.
   - **`dom/worker`:** installs the subset, records changes into batches, and calls an `onBatch(batch)` hook that `runtime` provides. Its `deliver(nodeId, event)` dispatches an incoming event record to a node by id, with capture and bubble inside the worker.
   - **`dom/host`:** applies a batch, keeps `idFor` / `nodeFor` both ways, and turns a DOM event into a plain event record, but only for listeners the isolate registered (`listen` records).
   - **`runtime` keeps:** the per-microtask schedule, posting `patch` messages, `ctx.root`.
   - **`host` keeps:** the compositor and its frame budget, the EventBridge wiring (which events to listen for, default actions), host-owned input rules, host calls, Shadow DOM styles.
7. **Sanitising is passed in, and required.** `dom/host` takes a policy when a bridge is created, with no default. Every tag, attribute, URL and `prop` record goes through it, so the applier can't create an element or set an attribute without it (invariant I9). The policy itself, the component registry, stays in `host/src/render/registry.ts`. Host-owned input rules reach the applier through the same policy.
8. **Format mismatch is a hard error.** `runtime` and `host` are released together. If an isolate's `ready.renderFmt` isn't exactly the fmt `dom/host` speaks (and isn't `'none'` for a headless isolate), the isolate crashes with reason `render-fmt-mismatch` and goes straight to `failed`: no restart, since a restart can't change the outcome. A version range waits for a real need to run isolates built against older releases.
9. **Published, documented as internal.** `@isoloop/dom` is on npm because `runtime` and `host` depend on it. App and adapter authors never import it. Its README says so, and its API carries no semver promise beyond the fmt version: a breaking record change bumps the fmt (`isoloop-dom@2`).
10. **`legacy-vdom` stays where it is** (`runtime/src/legacy/vdom.ts`, `host/src/render/legacy-vdom.ts`). It runs the suite from `@isoloop/dom/testing`, with its known gaps marked, until M1 task 11 moves four-loops to the new bridge and deletes it.

## Consequences

- **One format, one place.** A record change, its two halves and its tests change in one package and one PR.
- **The compiler keeps the halves apart**, the way the `lib` setting does for `bus`. That costs four tsconfigs in one package.
- **`dom` can be tested alone,** against its conformance suite, without starting a kernel.
- **`host` and `runtime` stay in charge of when and whether:** timing, budgets, input rules and policy. `dom` can't paint anything the registry hasn't allowed.
- **A new package to maintain and publish,** with its own changesets. It's internal, so its API can change freely as long as the fmt version is bumped when records change.
- **Strict versioning:** a host and an isolate built from different releases can't render together until a range is supported.
- **The conformance suite moves** from `packages/host/test` to `packages/dom/src/testing` with M1 task 5. Because Decision point 10 still runs it against `legacy-vdom`, the move lands in the same PR as the new bridge.

## Alternatives considered

- **Keep the halves in `runtime/src/render` and `host/src/render`** (the plan before this ADR): no new package, but one format split across two packages that are versioned and tested apart.
- **Two packages, `@isoloop/dom-worker` and `@isoloop/dom-host`:** physical separation of the halves, but two version numbers for one format and a third place for the shared types.
- **Record types in `protocol`:** every wire type in one package, but `protocol` would depend on one render format and change whenever it does.
- **The allow-list inside `dom/host`:** simpler wiring, but `dom` would have to know about `KernelConfig.components` and routing.
- **One tsconfig with both `DOM` and `WebWorker` libs:** simpler, but the worker half could use `document` and still compile.
- **Bundle `dom` into `runtime` and `host` without publishing it:** hidden from users, but the code ends up in both bundles and the build gets more complicated.
- **Accept a range of fmt versions:** only useful once isolates and hosts come from different releases, which isn't the case before 0.1.
