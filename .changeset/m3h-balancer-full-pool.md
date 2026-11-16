---
'@isoloop/balancer': minor
---

The balancer gets a full-pool trigger: when a pool's members' busy time adds up to 80 % of a core or more over the 3 s window, its heaviest member moves, even if the pool's lag stays low. Isolates whose work yields often keep the lag low while starving each other, so neither the spike nor the sustained trigger fired. Placement stops adding at 60 %, so the gap between 60 % and 80 % is the hysteresis.

Leaving quarantine changes too:
- An offender leaves after its quiet window (no spike, no crash), whatever its load. `quarantine.steadyLoadPct` is removed.
- A never-measured isolate leaves as soon as it is measured, with no 30 s window. Members a bisect moved stay until that bisect ends.
- With no room anywhere, a member stays in quarantine flagged `atCap`.
