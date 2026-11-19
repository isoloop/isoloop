---
'@isoloop/balancer': patch
---

Two fixes to the `room` fold, from the File processor's fault runs on `0.1.0-next.4` with `maxWorkers: 2`:

- **The cap counts a pool a move has claimed,** from the moment it's claimed, before its worker runs. Before, a `full` move and a `backlog` move in the same decision could each open a new pool, one past `maxWorkers`.
- **A second quarantine pool folds into the first like with like.** Offenders join a first quarantine that holds only offenders. Members that never offended, such as the other half of a bisect, join one that holds no offender, and the bisect ends. Before, only a pool of offenders folded, so a bisect's second half kept its worker while a member sharing a pool fell behind. Anyone who hasn't offended still never joins an offender.
