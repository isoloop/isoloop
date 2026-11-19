---
'@isoloop/runtime': patch
---

A pool's worker no longer closes itself when its last member says `bye`. It stays open until the host's loader terminates it after its last member. Before, the first `bye` after every member had left the routing table closed the worker. Members still shutting down lost their `bye`, so their stop waited out the full grace. A member the host had just sent `init` to never started, and from then on every start in that pool ended in a `ready-timeout`. In the File processor's fault runs on `0.1.0-next.5` (web `c4503e5`, a 4-core bench server at 2.0 GHz), it hit 3 of 15 balancer runs, as an image processor given up on in the first quarantine pool.
