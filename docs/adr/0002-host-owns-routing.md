# ADR 0002: The host owns the URL

- **Status:** Accepted
- **Date:** 2026-11-03 (accepted 2026-11-04, after grilling)
- **Answers:** RFC 0001 open question "How does routing work?"

## Context

Workers have no `history` or `location.assign`, and only one party can own the address bar without conflicts. Isolates still need to read the current route (to show the right entity) and to ask for navigation (a link in a table row). Host routers (React Router, TanStack, plain `history`) change the URL with `history.pushState`, which fires no event, so the kernel can't see those changes on its own. Many isolates don't care about the route at all, and some hosts have no SPA router.

## Decision

### Ownership and configuration

- The host app owns the URL and its router. Isoloop doesn't ship a router.
- `KernelConfig.routing?: boolean`, default `true`. With `false` the kernel adds no listeners and never publishes the route topic (it stays reserved and empty), `syncRoute()` does nothing, `navigate()` rejects with `routing_disabled`, and link clicks aren't intercepted, so the browser loads the page as usual. This is for static pages, widgets embedded in someone else's app, and headless setups.
- `KernelConfig.basePath?: string`, default `/`, normalised to start and end with `/`. It applies only when routing is on. It must match the host router's `basename`. In dev, the kernel warns once if `syncRoute()` sees a URL outside `basePath` while isolates are subscribed, which is the usual symptom of a mismatch.

### Route topic

- The kernel publishes the current location to a built-in compacted system topic, `isoloop.route.v1`, exported as `routeTopic` from `@isoloop/protocol`. Key `"current"`, value `{ href, pathname, path, search, hash, state }`:
  - `path` is `pathname` relative to `basePath`, starting with `/`, or `null` when the URL is outside `basePath`. With the default base, `path === pathname`.
  - `state` is `history.state` as is (it's already structured-cloneable). If the record would exceed the bus size limit, the kernel publishes it with `state: null` and emits `route:state_dropped { bytes }`.
- The kernel publishes on start, on `popstate` and `hashchange`, on `kernel.syncRoute()`, after an accepted `navigate`, and again right after a bus restart ([ADR 0007](0007-bus-worker-supervision.md)). The topic is memory-only, since the URL is the source of truth. Publishes are skipped when `href` and `state` are unchanged.
- **Subscribing is opt-in.** Nothing subscribes on an isolate's behalf, and the bus delivers route records only to isolates that subscribed, so an isolate that doesn't care about the route pays nothing and isn't woken from suspension by navigation. Isolates read it with `from: 'earliest'` to get the current route at once. The M3 adapters' `useRoute()` subscribes only when a component uses it.
- **Host router wiring.** Navigations the host's router makes itself are reported with `kernel.syncRoute()`, which reads `location` and `history.state` and publishes if something changed. The host wires it once, e.g. `router.subscribe(() => kernel.syncRoute())`.

### Reserved namespace

Topics under `isoloop.*` are system topics. Every isolate may subscribe to them without a grant. Only the kernel publishes them: an isolate's publish is `forbidden` even with a matching grant glob, and `kernel.publish` from host code rejects too.

### Navigation from isolates

- `ctx.host.navigate(href, { replace?, state? })` needs the grant `grants.navigate: true` (default `false`), or it rejects with `forbidden`. The grant travels in `init.grants`, so the runtime rejects locally, and the kernel enforces it again. Headless isolates can navigate too ([ADR 0008](0008-isolates-and-surfaces.md)).
- **One resolver** serves `navigate` and links: an href starting with `/` resolves against `basePath` (`/orders` → `/app/orders`), like a router's `basename`. `#x` and relative hrefs resolve against the document URL. A full same-origin URL escapes the base (`new URL('/logout', route.href)`). A cross-origin result rejects with `cross_origin` without reaching the host.
- The kernel then calls the host's `onNavigate(req)` with `NavigateRequest = { href, replace, state?, from }`, where `href` is absolute and `from` is the calling isolate's id. The default `onNavigate` calls `history.pushState`/`replaceState` with `state`. Router-based hosts should map `state` into their router's own state option and never let it overwrite the router's internals.
- **Result.** `onNavigate` returns `true` (accepted) or `false` (refused), and that is the call's result. `true` means the host *accepted* the navigation, not that it finished: `onNavigate` should return as soon as it decides, and the normal 5 s host-call timeout applies. Completion shows up on the route topic. If `onNavigate` throws or rejects, the call rejects with `navigate_failed` and the error message, the kernel emits `route:navigate_error { from, href, error }`, and doesn't sync the route.
- **Ordering.** After `true` the kernel runs `syncRoute()`. If that publishes (the URL already changed, as with the default hook or a sync router), the call resolves only after the bus commits the route record. So code that awaits `navigate` can rely on the route being in the log. With async routers there is no such guarantee: wait for the route topic. If the bus is down, the call resolves at once and the route arrives with the republish after the restart.
- No `back`/`go(n)` in v1. `go` can't be vetoed cleanly beforehand, gives no result, and may leave the app. Isolates navigate to an explicit href, or the host exposes a command topic.

### Links

- `<a href>` in an isolate's tree is rendered by the host. The compositor rewrites every same-origin `href` to the resolved absolute URL on render and on every patch that changes it, so hover, copy-link, Ctrl-click and middle-click use the same URL as a plain click.
- A plain primary-button click on a same-origin link, hash-only links included, is prevented on the host and sent to `onNavigate` with `from` set to the isolate. It needs no `navigate` grant: it's a real user click on the host DOM, which an isolate can't fake. The host keeps its veto.
- The browser handles the click as usual when any modifier key (Ctrl, Meta, Shift, Alt) is held, for a non-primary button, when the link has `target` other than `_self`, or when it has `download`. Cross-origin links always open normally.

## Consequences

- Routing works with any host router, at the cost of one line of wiring (`syncRoute`) for routers that call `pushState` themselves, and of keeping `basePath` equal to the router's `basename`. Without the wiring, isolates see only `navigate`, back/forward and hash changes.
- Hosts without a router, or embedded in someone else's page, turn routing off and Isoloop never touches the URL or link clicks.
- An isolate that starts, restarts or resumes reads the current route from the compacted topic at once; isolates that don't subscribe are unaffected by navigation.
- Isolates written against app-relative paths keep working when the app's mount point moves. Reaching a path outside the app takes a full same-origin URL.
- Every subscribed isolate can read `history.state`, including router internals (React Router's `{ usr, key, idx }`). Hosts shouldn't put secrets there. Its shape belongs to the host's router and may change when the router does, so isolates that read it couple themselves to that router. A host whose state is too large for the bus loses `state` on the topic (signalled by `route:state_dropped`), not the route.
- Programmatic navigation is a capability like publishing: off unless the manifest grants it, with `onNavigate` and `req.from` as the fine-grained check on top. Isolates can't send the tab to another origin; only a user's click on a rendered link can.
- `navigate`'s result tells refusal (`false`) apart from host bugs (`navigate_failed`).
- Isolate-internal routes (tabs inside an isolate) are isolate state, not URL state, unless the host maps them into the URL itself.

## Alternatives considered

- **Each isolate owns a URL segment:** the micro-frontend router model. Adds a routing contract the host must honour; deferred until a user asks.
- **Isolates write the URL directly through a call:** loses the host's veto and its router's guards.
- **Detect host navigations without wiring:** the Navigation API's `currententrychange` isn't available in every browser we target, so it would need a second code path. Patching `history.pushState` is invasive and clashes with other libraries that patch it. Either can come later as an option on top of `syncRoute`.
- **Leave `history.state` out of the topic:** less exposure, but isolates that need router state would have no way to get it. Rejected in review in favour of documenting the exposure.
- **Pass cross-origin hrefs to `onNavigate`:** more flexible, but every host would have to filter them, and a third-party isolate could send the tab anywhere.
- **Routing always on:** cheap for isolates that don't subscribe, but an embedded kernel would still take over link clicks that belong to the page's own router.
- **No base path, raw `pathname` only:** simpler, but every isolate would have to know the mount point. Adding `basePath` now with a default of `/` changes nothing for hosts that don't set it.
- **`navigate` resolves when the navigation finishes:** would need a long or no timeout, and a slow loader would look like a broken host.
- **Path-glob navigate grants (`string[]`):** deferred. `onNavigate` already covers path rules; a later list form can keep `true` meaning `['*']`.
- **`back`/`go(n)` host call:** deferred until users ask (see above).
