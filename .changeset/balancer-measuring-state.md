---
'@isoloop/balancer': minor
---

`placements()` now reports an isolate that sits in quarantine only to be measured as `state: 'measuring'`, not `'quarantined'`. That covers an isolate spawned without a stored load and one a bisect moved there; the bisect's move in keeps `reason: 'bisect'`. When it leaves after its measurement, the move's `reason` is the new `'measured'`. `'quarantined'` and `'steady'` are now for offenders only: a measuring isolate that spikes a second time or crashes becomes `quarantined` in place, with no move event, the `spike` event reports it as before, and it later leaves with `'steady'`. `PlacementState` gains `'measuring'` and `MoveReason` gains `'measured'`, so code that switches over either type needs a case for the new member.
