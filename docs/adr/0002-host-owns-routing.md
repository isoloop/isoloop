# ADR 0002: The host owns the URL

- **Status:** Proposed
- **Date:** 2026-11-03
- **Answers:** RFC 0001 open question "How does routing work?"

## Context

Workers have no `history` or `location.assign`, and only one party can own the address bar without conflicts. Isolates still need to read the current route (to show the right entity) and to ask for navigation (a link in a table row).

## Decision

- The host app owns the URL and its router. Isoloop doesn't ship a router.
- The kernel publishes the current location to a built-in compacted system topic, `isoloop.route.v1`, with value `{ href, pathname, search, hash, state }` and key `"current"`. Every isolate may subscribe; nobody but the kernel may publish.
- Isolates navigate with the async host call `navigate({ href, replace? })`. The kernel passes it to a host-supplied `onNavigate` hook (default: `history.pushState`, then publish the new route). The host may refuse.
- `<a href>` in an isolate's tree is rendered by the host; clicks on same-origin links are prevented and turned into `navigate` calls. Cross-origin links open normally.

## Consequences

- Routing works with any host router (React Router, TanStack, plain `history`).
- An isolate that restarts reads the current route from the compacted topic at once.
- Isolate-internal routes (tabs inside an isolate) are isolate state, not URL state, unless the host maps them into the URL itself.

## Alternatives considered

- **Each isolate owns a URL segment:** the micro-frontend router model. Adds a routing contract the host must honour; deferred until a user asks.
- **Isolates write the URL directly through a call:** loses the host's veto and its router's guards.
