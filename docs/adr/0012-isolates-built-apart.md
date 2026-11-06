# ADR 0012: Isolates built apart from the host

- **Status:** Accepted
- **Date:** 2026-11-06
- **Builds on:** [ADR 0010](0010-own-render-bridge.md) and [ADR 0011](0011-dom-package.md) (the render bridge and its package)

## Context

An isolate's worker starts from the host app's `workers.isolateBootstrap`, which holds `@isoloop/runtime` and the worker half of `@isoloop/dom`. Only then does it `import()` the isolate module. That module can come from anywhere: another team's build, a separate repository, a CDN. RFC 0001 goal 3 ("isolates never import each other; they depend on versioned topic schemas") implies this is normal, not an edge case.

The render format can't differ between the two, because both halves of `isoloop-dom@1` ship in the host's build (ADR 0010). But a separately built isolate still depends on what the host's bootstrap gives it:

- the `IsolateContext` (`ctx.bus`, `ctx.host`, `ctx.root`, …) and the `{ start(ctx) }` / `defineIsolate` shape;
- the DOM subset members (ADR 0010), which its framework calls;
- the adapter hooks (`useTopic`, `usePublish`, …), because the adapter is bundled into the isolate.

An isolate built against 0.4 under a 0.3 host would fail with `ctx.foo is not a function`, and one built against 0.3 under a host that removed something would fail the same way.

## Decision

1. **Separately built isolates are supported.** A host runs isolates built against an older Isoloop version, back to a floor (point 4).
2. **The seam only grows.** Between floor changes, nothing is removed or changed in:
   - `IsolateContext` and the `{ start(ctx) }` / `defineIsolate` shape;
   - the DOM subset (ADR 0010);
   - the adapter hooks.

   Free to change in any release, because they don't cross the seam: the host ↔ worker protocol (bootstrap and host come from one build), the `isoloop-dom` records (they bump the fmt), and `KernelConfig` and the host API (only the app sees them; normal semver).
3. **Isolates say what they were built against.** `defineIsolate`, in `@isoloop/runtime` and in every adapter, stamps the definition with the version it was built with (`{ start, requires: '0.4' }`, taken from the package version at build time). The bootstrap reports it in `ready`, and the host checks it, like `renderFmt` (ADR 0011, decision 8). A plain `{ start }` object without a stamp isn't checked.
4. **The host runs `[FLOOR, VERSION]`.** `VERSION` is the host's own version and `FLOOR` the oldest `requires` it still runs:
   - `requires > VERSION`: the isolate goes to `failed` with reason `runtime-too-old`;
   - `requires < FLOOR`: `failed` with reason `isolate-too-old`;
   - otherwise it runs.

   Both are final, with no restart, since a restart can't change the outcome. The message names both versions, for example "built for 0.2, this host runs 0.3 to 0.6".
5. **How the floor moves.**
   - **Before 1.0:** only when something is removed from or changed in the seam, and that needs an ADR. The member is deprecated for at least one minor first: it keeps working, and with `KernelConfig.dev` set the kernel warns when it's used. Releases that remove nothing leave the floor where it is.
   - **From 1.0:** semver applies, so a removal is a major release and `FLOOR` is the current major's `x.0`. The check then amounts to comparing majors.
6. **Built in M3,** with the adapters, because the markets dashboard in `isoloop/examples` is the first set of isolates built apart from the host.

## Consequences

- An isolate from another build either runs or fails at start with both versions in the message, never with a `TypeError` halfway through.
- The versions that work together are always one range, so one number (`FLOOR`) replaces a compatibility table.
- Removing something from the seam is deliberate and slow: an ADR, a minor of deprecation, then a floor change that every older isolate notices.
- `defineIsolate` is no longer a pure identity function: it adds `requires`.
- Hand-written `{ start }` isolates skip the check. That's the cost of keeping plain JS isolates free of any import.

## Alternatives considered

- **Require isolates to be built with the host's exact version:** simple, but every host release forces every isolate to rebuild, against RFC goal 3.
- **Check majors only:** right after 1.0, and the floor becomes exactly that. Before 1.0 everything is major `0`, so it would check nothing.
- **Treat every 0.x minor as a major:** a 0.4 host would refuse 0.3 isolates even when nothing broke.
- **A compatibility list:** holds no more than `[FLOOR, VERSION]`, because the seam only grows between floor changes, and it's one more file to keep right.
