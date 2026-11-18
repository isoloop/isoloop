---
'@isoloop/balancer': minor
---

These changes follow a local run of the File processor that showed three ways the balancer moved too much or packed too little (M3j, [ADR 0017](https://github.com/isoloop/isoloop/blob/main/docs/adr/0017-opt-in-balancer.md)):

- **The move budget.** A never-measured isolate's way out of the quarantine, where it starts, no longer counts toward the 3 moves in 5 minutes. Before, a new isolate that then had one move for load and one quarantine move had to wait out the budget, past its quiet window.
- **Packing.** It now empties a quiet pool of several members into another, one member per pack, when the whole pool fits under 40 % there. Before, only an isolate alone in its pool packed.
- **Backlog moves.** These need the backlog to rise over two 10 s windows in a row. A queue that jumps once and then holds no longer moves anything.
