---
'@isoloop/balancer': minor
---

A rising backlog outranks a second quarantine worker. When a member that shares a pool has a rising backlog and the cap leaves it nowhere to go, a quarantine pool beyond `balancer-quarantine-1` that holds only offenders folds into it (the new move reason `room`), which frees that worker for the backlog move. For the next 10 s no new quarantine pool takes a freed worker, and a bisect whose halves fold together ends. Before, a quarantine that had split could hold the last worker under `maxWorkers` for a whole quiet window while the members sharing a pool fell behind: in the File processor with faults, on `0.1.0-next.3` with `maxWorkers: 2`, six processors shared one worker for the rest of the run.
