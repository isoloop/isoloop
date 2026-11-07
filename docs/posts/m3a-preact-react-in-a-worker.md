# Preact and React in a Web Worker

*M3a write-up, 2026-11-07*

M3a's promise: **the Preact adapter (Preact 10 and 11) and the React adapter (React 18 and 19) pass the adapter conformance suite on every supported major, in CI.** That suite is [`e2e/adapters.spec.ts`](../../e2e/adapters.spec.ts). It builds one fixture app per framework major, runs it as an isolate in its own worker, and checks the same things in Chromium, Firefox and WebKit:

- it renders;
- clicks go to the worker and back through the bus;
- typing fast into a host-owned input loses nothing;
- after a crash, the isolate restarts and rebuilds its state from the log;
- a route change reaches the component.

That's 16 runs per engine, all green. In four-loops, P (Preact) and R (React) now sit side by side and tally the same `vote.v1` topic. Crash either one and it comes back with the same tally.

## How a framework renders in a worker

Neither framework knows it isn't on the page. The bootstrap installs our DOM subset ([ADR 0010](../adr/0010-own-render-bridge.md)) as the worker's `document` and DOM classes. The framework calls `createElement`, `insertBefore` and `setAttribute` on it, the subset records each change as plain data, and once per microtask the batch goes to the host, which applies it under the isolate's shadow root. Events come back the other way, as data, and are dispatched in the worker with capture and bubble.

The adapters are thin on purpose. `defineIsolate(Component)` renders the component into `ctx.root` and unmounts it on shutdown. The rest is hooks over the isolate context:

- `useTopic` and `usePublish` for the bus;
- `useRequest` for request and reply;
- `useHost` for `measure`, `focus`, `scrollIntoView`, `navigate` and now `requestCanvas`;
- `useRoute`, which subscribes to the route topic only where it's called.

React's `useTopic` sits on `useSyncExternalStore`, so concurrent rendering can't tear and StrictMode's extra subscribe leaves exactly one bus subscription.

## What each major needed

We didn't guess what the frameworks call; we logged it. A usage logger ([`@isoloop/dom/testing/worker`](../../packages/dom/src/testing/worker.ts)) wraps every member of the subset and puts a `Proxy` under the prototypes, so a lookup that finds nothing is caught too. A fixture app runs on each major, and the logs are committed to [`packages/dom/usage`](../../packages/dom/usage). CI fails if a major reaches for something the subset lacks, or if the log changes. A Dependabot bump that starts calling something new fails its own PR.

Smoke tests then render the same app twice: in a worker through the subset, and straight into the page. They compare the DOM after every user action. Between them, these two checks found:

- **Preact 10** only lowercases an event name if `'onclick' in el`, so it was listening for `Click`. The subset now has the DOM's `on*` handler properties.
- **Preact 10 and 11** pass numbers to `createTextNode`. The subset stored them as numbers, and the host rightly refused the batch. The data is converted with `String()` now, as the DOM does.
- **Preact 11** runs passive effect cleanups after paint, even on unmount. So `useTopic` subscribes in a layout effect, and shutdown has unsubscribed by the time it's done.
- **React 18 and 19** check for a DOM **when they load** (`'oninput' in document`), and without one typing never fires `onChange`. The bootstrap now installs the subset before it imports the isolate module.
- **React's controlled `<select>`** walks `select.options` and each option's `value`, `selected` and `disabled`.
- **React 19** hoists `<title>` into `document.head` and finds the old one with `document.querySelector('head > title')`. The subset has a detached `head`, which the bridge doesn't render (the kernel warns once in `dev`), and a `querySelector` for type selectors only. Real queries wait for a library that needs them (DOM group 2).

A few reads are tolerated, each with its reason in [`TOLERATED_MISSING`](../../packages/dom/src/testing/check-usage.ts): `moveBefore` and `getRootNode`, which are used when present; `documentMode`, for old IE.

We also built DOM group 1 for the libraries M3b will bring: `classList`, `dataset`, `getElementById`, `contains`, `DocumentFragment` and comment nodes. An isolate can now set a focused input's value with `ctx.setValue(node, value, { force: true })`. D uses it to clear its note box without stealing focus.

## Memory

[`bench/memory-per-isolate`](../../bench/memory-per-isolate/memory.spec.ts) starts 10 idle isolates of each kind, each rendering a small tree, and reads every worker's memory with `performance.measureUserAgentSpecificMemory()`. That needs a cross-origin isolated page and Chromium. Median per isolate, against the design's targets:

| Kind | Per isolate | Target |
| --- | --- | --- |
| Vanilla | 0.41 MB | ≤ 3 MB |
| Preact 11 | 0.45 MB | ≤ 5 MB |
| React 19 | 0.97 MB | ≤ 12 MB |

These figures are the JavaScript and DOM memory the browser attributes to each worker's realm. They don't include the thread and the engine's fixed cost per worker, which the API doesn't report. So they're a floor, not a full bill. They do answer M3's open question: React's bundle (about 220 kB unminified) doesn't make an idle React isolate expensive. Preact costs barely more than no framework at all.

## Built apart from the host

Isolates can now come from another repository ([ADR 0012](../adr/0012-isolates-built-apart.md)). `defineIsolate` stamps a definition with the Isoloop version it was built against. The bootstrap reports it in `ready`, and the host fails anything outside `[FLOOR, VERSION]` with `runtime-too-old` or `isolate-too-old`, with no restart. `@isoloop/vite` builds isolates as standalone ES modules with a manifest, in an app or in library mode. It also gives an app its worker URLs (`virtual:isoloop/workers`) and the hosting guide's headers in dev.

## Next

M3b builds the markets dashboard in `isoloop/examples` on these adapters. Its libraries will tell us what DOM group 2 needs.
