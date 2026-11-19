---
'@isoloop/runtime': patch
---

A pool's worker no longer closes itself when its last member says `bye`. It stays open until the host's loader terminates it after its last member. Before, the first `bye` after every member had left the routing table closed the worker. Members still shutting down lost their `bye`, so their stop waited out the full grace. A member the host had just sent `init` to never started, and from then on every start in that pool ended in a `ready-timeout`. The File processor's fault runs showed it as image processors given up on in the first quarantine pool.
