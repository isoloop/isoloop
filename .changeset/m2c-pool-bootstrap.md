---
'@isoloop/protocol': minor
'@isoloop/runtime': minor
---

Pool bootstrap (M2c): the isolate bootstrap can host several headless isolates in one worker. An `init` that names its isolate in the new optional envelope field `isolate` makes the worker a pool; every message to or from a member names it, each member gets its own context and bus port, the beat is the worker's, and the worker closes after its last member says `bye`. An `init` without `isolate` behaves exactly as before. The host doesn't place isolates in pools yet.
