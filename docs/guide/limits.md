# What Isoloop can't hide

What changes for code that runs in an isolate, what Isoloop costs, and what it doesn't protect against, so you can judge whether it fits before you adopt it.

## When to use it

Read this page before you move existing code into isolates, or before you pick a third-party library for one. Most of what follows comes from one fact: an isolate runs in a worker, and a worker has no DOM, no layout and no synchronous line to the page. Isoloop's render bridge sends each isolate's changes to the page, which applies them. Code that only builds and updates DOM works as it does on the page. Code that asks the page a question and needs the answer at once doesn't.

If none of the limits below stop you, carry on with the [hosting guide](hosting.md).

## Layout, focus and scrolling are asynchronous

The worker has no layout, so it can't answer layout questions synchronously. The DOM an isolate sees leaves these out on purpose, with no fake values:

- **Sizes, positions and animations:** these throw a `NotSupportedError` whose message says what to use instead, so a library that reaches for one fails at that line rather than on a `NaN` size later:
  - the methods `getBoundingClientRect()`, `getClientRects()`, `animate()` and `getAnimations()` on every element, and `getComputedStyle()` on the worker's `window`;
  - reading `offsetWidth`, `offsetHeight`, `offsetTop`, `offsetLeft`, `offsetParent`, `clientWidth`, `clientHeight`, `clientTop`, `clientLeft`, `scrollWidth` or `scrollHeight`.

  The members exist, so a feature check such as `'animate' in el` finds them and the call then throws. Other members the worker's DOM doesn't have are absent: calling one throws a `TypeError`, and reading one gives `undefined`.
- **Focus:** elements have no `focus()` method, and `document.activeElement` is always `null`.
- **Scrolling:** `scrollTop` and `scrollLeft` are read only, as of the last `scroll` event the element got, and stay `0` until the element listens for `scroll`. The page owns scrolling.
- **Selection and editing:** there's no `Range`, no selection API and no `contenteditable`.

Ask the page instead, through `ctx.host` (`useHost()` in React and Preact). Each call first sends the isolate's pending DOM changes, so the page answers about what you rendered last:

| Call | Resolves with |
| --- | --- |
| `measure(node)` | the node's box relative to the isolate's surface, `{ x, y, width, height }` |
| `focus(node)` | nothing, once the page has called `focus()` on the node |
| `scrollIntoView(node, { behavior?, block?, inline? })` | nothing, once the page has called `scrollIntoView()` (a smooth scroll may still be moving) |
| `requestCanvas(node, { width?, height? })` | an `OffscreenCanvas` for a rendered `<canvas>`, to draw on from the worker |

A failed call rejects with a `HostCallError`, whose `code` says why: `timeout` when there's no answer within 5 s, `not_found` for a node the page hasn't rendered, and `no_surface` in a headless isolate, which has nothing to measure.

```tsx
import { defineIsolate, useHost } from '@isoloop/react';
import { useRef, useState } from 'react';

function Measured() {
  const host = useHost();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const measure = async () => {
    if (!box.current) return;
    const rect = await host.measure(box.current);
    setWidth(rect.width);
  };
  return (
    <div ref={box} onClick={() => void measure()}>
      {width > 0 ? `${width}px wide` : 'Click to measure'}
    </div>
  );
}

export default defineIsolate(Measured);
```

A library that measures on every render (tooltips that position themselves, virtualised lists, auto-sizing text) needs rewriting around these calls, or it belongs on the page rather than in an isolate.

## Globals that libraries reach for

In an isolate with a surface, `document` is the render bridge's DOM subset and `window` is the worker's own global. A headless isolate has neither. That breaks some libraries in ways that are easy to miss:

- **`document.body`** is a detached element. A widget that appends a portal, a tooltip or a modal to it renders nothing on screen. Render it inside your own root instead.
- **`localStorage` and `sessionStorage`** don't exist in workers. `IndexedDB` does. To keep state across a restart, publish it to a topic ([persistent topics](hosting.md#persistent-topics-and-a-discarded-tab) survive a reload).
- **The page's `window`** isn't there: no `innerWidth`, `matchMedia` or `history`, and `location` is the worker script's URL. Navigation goes through `host.navigate`, with the `navigate` grant ([contracts and grants](contracts.md)).
- **Tags the page won't create.** The page builds only allow-listed HTML and SVG tags: an unknown tag becomes a `div` (`g` inside SVG), and `script`, `iframe`, `style` and `on*` attributes are never created. URLs are limited to `http(s):`, `mailto:` and relative ones ([design §4.5](../design/system-design.md)). A widget that injects a `<script>` or an embed doesn't work in an isolate.

## Input arrives a moment later

The page listens for input and forwards it to the isolate as a message ([design §4.6](../design/system-design.md)). Only these events are forwarded, and only to a node that listens for them: `click`, `dblclick`, `input`, `change`, `keydown`, `keyup`, `submit`, `focusin`, `focusout`, `pointerdown`, `pointerup`, `pointermove` (once per animation frame) and `scroll` (once per frame per node). A canvas handed over by `requestCanvas` also gets `resize`. What follows from that:

- **Drag and drop doesn't work.** `dragstart`, `dragover` and `drop` are never forwarded, and a `DataTransfer` can't cross to the worker. Build drag with pointer events, or keep it on the page.
- **`preventDefault()` comes too late.** By the time the isolate runs its handler, the page has already done the default action. The page prevents two defaults itself: every `submit`, and, with routing on, plain clicks on same-origin links, which go to the router.
- **Pointer timing is coarser.** Moves are coalesced to one per frame, and each reply takes a round trip. Drawing that follows the pointer (a freehand canvas, a slider dragged across a chart) lags by about a frame more than the same code on the page.
- **Every interaction has a fixed cost.** In Chromium, a worker's reply to an input waits until after the next frame ([engine constraints §3](../investigations/engine-constraints.md#3-chromium-holds-a-workers-reply-until-after-the-next-frame-following-input)). In the markets dashboard at Heavy, that came to about 30 ms of typing latency in every Isoloop variant, against 5–10 ms for native, on Chromium and WebKit (Playwright 1.64.1 on a 32-core WSL2 machine, 2026-11-08, [§2](../investigations/engine-constraints.md#2-webkit-presents-worker-drawn-canvas-frames-through-the-main-thread)).
- **Events from the page are never trusted.** `isTrusted` is always `false` in the worker, including for forwarded input, so code that checks it treats every event as synthetic.

## What it costs

An isolate's computation moves off the main thread, but showing what it computed still costs the main thread time: one thread per document applies every DOM change ([engine constraints §1](../investigations/engine-constraints.md#1-one-dom-thread-per-document)). On top of that, Isoloop costs CPU across threads, memory and start-up time.

On the plant dashboard (72 widgets), native + workers against Isoloop's `matched` placement, in Chromium at 5 kHz: the median gap over 5 interleaved rounds, measured on a dedicated machine with 4 physical cores fixed at 2.0 GHz, `@isoloop/*@0.0.0-next.b8ffdcf`, shipped as `plant-v0.1.0`, 2026-11-13 ([results](https://github.com/isoloop/web/blob/9b50967b0971871ec9671d7dce8d115eb16f6d19/apps/dashboards/plant/comparison/final/README.md)):

| | Isoloop minus native + workers |
| --- | --- |
| Main-thread CPU | −53 percentage points |
| Typing latency | −28 ms |
| CPU across all threads | +19 percentage points |
| Memory 16 s in, after GC | +51 MB |
| Time to first data | +294 ms |

Other devices and engines tell a different story:

- **On an older iOS phone** (Safari 16.6, 2026-11-13), the plant dashboard's native build held 60 frames a second at 1 and 5 kHz, and the Isoloop placements did worse the more workers they used: at 5 kHz, 59.5 frames a second with 1 worker and 5.6 with 105 ([engine constraints §2](../investigations/engine-constraints.md#2-webkit-presents-worker-drawn-canvas-frames-through-the-main-thread)).
- **In Playwright's WebKit on Linux,** every frame a worker draws on a transferred canvas costs the main thread time, so pages with many canvas widgets slow down there ([§2](../investigations/engine-constraints.md#2-webkit-presents-worker-drawn-canvas-frames-through-the-main-thread)). Safari 26.5 on a recent iPadOS tablet doesn't show it.
- **Each worker has its own heap.** The kernel warns past 32 live workers (`workers.budget`, [hosting](hosting.md#placement-rules)). [Pools](pools.md) share a worker to save memory, at the cost of a shared event loop and fate.

Every recorded run, in both directions, is in [`isoloop/web`'s plant comparison](https://github.com/isoloop/web/blob/9b50967b0971871ec9671d7dce8d115eb16f6d19/apps/dashboards/plant/comparison/README.md).

## Browsers and the first paint

- **Supported browsers:** Chrome 108, Firefox 114 and Safari 16.4 or later. `createKernel` checks module workers, `MessageChannel`, adopted stylesheets and the origin private file system first, and throws a `KernelError` with code `unsupported_browser` naming what's missing. Catch it and show a plain-HTML version of the page.
- **Checks before your app loads** go in a script file from your own origin. The policy in the [hosting guide](hosting.md#content-security-policy) allows no inline scripts.
- **No server-side rendering.** An isolate's content appears once its worker has started and rendered. Put anything that must be there at first paint in the page's own HTML.

## Not a security boundary

Isolates run on the page's origin. An isolate can `fetch` with the page's cookies and read that origin's `IndexedDB`. Isoloop contains failures (a crash, a hang, a runaway loop) from code you trust but that may break: other teams' widgets, generated code you've reviewed. It doesn't contain hostile code. For code you don't trust at all, use a cross-origin iframe.

Pooled isolates also share a worker's globals, and visual members share one document, so they can read each other's DOM and input ([pools](pools.md)).

## Limits

This page is the list of limits for Isoloop as a whole. Each guide's own `## Limits` covers its feature, and a limit found there that applies to every isolate is added here too.

## See also

- [Hosting](hosting.md): the headers, CSP and CORS a page that runs Isoloop needs.
- [Worker pools](pools.md): what pooled isolates share.
