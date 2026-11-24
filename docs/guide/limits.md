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
- **Tags the page won't create.** The page builds only allow-listed HTML and SVG tags: an unknown tag becomes a `div` (`g` inside SVG), and `script`, `iframe`, `style` and `on*` attributes are never created. URLs are limited to `http(s):`, `mailto:` and relative ones. A widget that injects a `<script>` or an embed doesn't work in an isolate.

## Input arrives a moment later

The page listens for input and forwards it to the isolate as a message. Only these events are forwarded, and only to a node that listens for them: `click`, `dblclick`, `input`, `change`, `keydown`, `keyup`, `submit`, `focusin`, `focusout`, `pointerdown`, `pointerup`, `pointermove` (once per animation frame) and `scroll` (once per frame per node). A canvas handed over by `requestCanvas` also gets `resize`. What follows from that:

- **Other events never arrive.** The worker's DOM accepts a listener for any event, and `onwheel` and the like exist, but a listener for an event outside the list above never runs. That includes:
  - **drag and drop:** `dragstart`, `dragover` and `drop`, and a `DataTransfer` can't cross to the worker. Build drag with pointer events, or keep it on the page;
  - **`wheel`:** a widget that zooms or scrolls on the wheel gets nothing; the page scrolls as usual, and `scroll` is forwarded once per frame to a node that listens for it;
  - **`contextmenu`:** the browser's own menu opens;
  - **`copy`, `cut` and `paste`:** the clipboard events, and so the clipboard data they carry;
  - **IME composition:** `compositionstart`, `compositionupdate` and `compositionend`. The `input` event is forwarded, but not the stages of a composition.

  Keep such a control on the page, or take what you need through the events that are forwarded.
- **`preventDefault()` comes too late.** By the time the isolate runs its handler, the page has already done the default action. The page prevents two defaults itself: every `submit`, and, with routing on, plain clicks on same-origin links, which go to the router.
- **Pointer timing is coarser.** Moves are coalesced to one per frame, and each reply takes a round trip. Drawing that follows the pointer (a freehand canvas, a slider dragged across a chart) lags by about a frame more than the same code on the page.
- **Every interaction has a fixed cost.** In Chromium, a worker's reply to an input waits until after the next frame. In the markets dashboard at Heavy, that came to about 30 ms of typing latency in every Isoloop variant, against 5–10 ms for native, on Chromium and WebKit (Playwright 1.64.1 on a 32-core WSL2 machine, 2026-11-08).
- **Events from the page are never trusted.** `isTrusted` is always `false` in the worker, including for forwarded input, so code that checks it treats every event as synthetic.

## What it costs

An isolate's computation moves off the main thread, but showing what it computed still costs the main thread time: one thread per document applies every DOM change. On top of that, Isoloop costs CPU across threads, memory and start-up time.

On the plant dashboard (72 widgets), native + workers against Isoloop's `matched` placement, in Chromium at 5 kHz, measured on a dedicated machine with 4 physical cores fixed at 2.0 GHz, 2026-11-13 ([results](https://github.com/isoloop/web/blob/9b50967b0971871ec9671d7dce8d115eb16f6d19/apps/dashboards/plant/comparison/final/README.md)):

Each row is Δ, Isoloop minus native + workers: the median of the paired differences over 5 interleaved rounds, so a negative figure is lower with Isoloop. The first two rows are gains; the other three are costs.

| | Δ | |
| --- | --- | --- |
| Main-thread CPU | −53 percentage points | gain |
| Typing latency | −28 ms | gain |
| CPU across all threads | +19 percentage points | cost |
| Memory 16 s in, after GC | +51 MB | cost |
| Time to first data | +294 ms | cost |

Other devices and engines tell a different story:

- **On an older iOS phone** (Safari 16.6, 2026-11-13), the plant dashboard's native build held 60 frames a second at 1 and 5 kHz, and the Isoloop placements did worse the more workers they used: at 5 kHz, 59.5 frames a second with 1 worker and 5.6 with 105.
- **In Playwright's WebKit on Linux,** every frame a worker draws on a transferred canvas costs the main thread time, so pages with many canvas widgets slow down there. Safari 26.5 on a recent iPadOS tablet doesn't show it.
- **Each worker has its own heap.** The kernel warns past 32 live workers (`workers.budget`, [hosting](hosting.md#placement-rules)). [Pools](pools.md) share a worker to save memory, at the cost of a shared event loop and fate.
- **A pool freezes the built-ins.** Before its first member loads, a pool worker freezes the prototypes and constructors of the standard built-ins (`Object`, `Array`, `Promise`, `Map`, the typed arrays and the rest, plus `Math`, `JSON` and `Reflect`), so one member can't change them for the others. A library that patches one, such as a polyfill that adds a method to `Array.prototype`, throws a `TypeError` in strict code. Isolates on their own worker are not frozen.

Every recorded run, in both directions, is in [`isoloop/web`'s plant comparison](https://github.com/isoloop/web/blob/9b50967b0971871ec9671d7dce8d115eb16f6d19/apps/dashboards/plant/comparison/README.md).

## Browsers and the first paint

- **Supported browsers:** Chrome 108, Firefox 114 and Safari 16.4 or later. `createKernel` checks module workers, `MessageChannel`, adopted stylesheets and the origin private file system first, and throws a `KernelError` with code `unsupported_browser` naming what's missing. Catch it and show a plain-HTML version of the page.
- **Checks before your app loads** go in a script file from your own origin. The policy in the [hosting guide](hosting.md#content-security-policy) allows no inline scripts.
- **No server-side rendering.** An isolate's content appears once its worker has started and rendered. Put anything that must be there at first paint in the page's own HTML.

## Not a security boundary

Isolates run on the page's origin. An isolate can `fetch` with the page's cookies and read that origin's `IndexedDB`. Isoloop contains failures (a crash, a hang, a runaway loop) from code you trust but that may break: other teams' widgets, generated code you've reviewed. It doesn't contain hostile code. For code you don't trust at all, use a cross-origin iframe.

Pooled isolates also share a worker's globals, and visual members share one document, so they can read each other's DOM and input ([pools](pools.md)).

## Only the latest release is supported

Only the version on npm `latest` gets fixes. When a new minor becomes `latest`, earlier versions get no patch, so upgrade instead. Preview builds (`next`) are never supported. Before 1.0, a minor may break anything outside the isolate seam, so read each minor's changelog before you upgrade. To report a vulnerability, see [`SECURITY.md`](https://github.com/isoloop/isoloop/blob/main/SECURITY.md).

## Limits

This page is the list of limits for Isoloop as a whole. Each guide's own `## Limits` covers its feature, and a limit found there that applies to every isolate is added here too.

## See also

- [Hosting](hosting.md): the headers, CSP and CORS a page that runs Isoloop needs.
- [Worker pools](pools.md): what pooled isolates share.
