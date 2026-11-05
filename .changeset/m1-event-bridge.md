---
'@isoloop/host': minor
---

EventBridge (design §4.6). Isoloop-dom surfaces forward the fixed set of event types, but only those an isolate registered a listener for. Pointer moves are coalesced to one per frame. `submit` is always prevented on the host, so a form in an isolate never navigates the page. A value or checked state the isolate sends never overwrites a focused input.
