---
'@isoloop/protocol': minor
'@isoloop/bus': minor
'@isoloop/host': minor
'@isoloop/runtime': minor
---

Routing (ADR 0002). The kernel publishes the location to the built-in compacted `isoloop.route.v1` topic (`routeTopic` in `@isoloop/protocol`, value `{ href, pathname, path, search, hash, state }`): on start, on `popstate` / `hashchange`, on `kernel.syncRoute()`, after an accepted navigation and after a bus restart, skipping unchanged `href` and `state`. `KernelConfig.routing` (default true), `basePath` (default `/`) and `onNavigate` (default `history.pushState` / `replaceState`). `ctx.host.navigate(href, { replace, state })` needs `grants.navigate` (checked in the runtime and the kernel), resolves `/x` against `basePath`, rejects with `cross_origin`, `forbidden`, `routing_disabled` or `navigate_failed`, and resolves only after the route record is in the log. Same-origin link `href`s render as their resolved URL, and plain primary-button clicks on them go to `onNavigate` without a grant. Too-large `history.state` is published as `null` with `route:state_dropped`; a throwing `onNavigate` emits `route:navigate_error`.
