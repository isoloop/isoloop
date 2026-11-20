---
'@isoloop/dom': minor
---

The worker DOM's layout members now throw a `NotSupportedError` that says what to use instead, as ADR 0010 (amended 2026-11-16, point 5) decided. Before, they were absent, so a call threw a `TypeError` and a property read gave `undefined`. The methods are `getBoundingClientRect()`, `getClientRects()`, `animate()` and `getAnimations()` on every element, plus `getComputedStyle()` on the worker's `window`. The properties are `offsetWidth`, `offsetHeight`, `offsetTop`, `offsetLeft`, `offsetParent`, `clientWidth`, `clientHeight`, `clientTop`, `clientLeft`, `scrollWidth` and `scrollHeight`. For sizes and positions the message points at `ctx.host.measure(node)` (`useHost().measure` in React and Preact); for animations it points at CSS transitions and animations. Feature checks such as `'animate' in el` now find these members. `scrollTop` and `scrollLeft` still read the last `scroll` event's offsets.
