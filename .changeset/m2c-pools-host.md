---
'@isoloop/host': minor
'@isoloop/runtime': patch
---

Worker pools for headless isolates (M2c): a manifest with `pool` joins a shared worker with every other isolate naming the same pool. The pool's worker starts with its first member and is terminated after its last; a pool counts as one worker against `workers.budget`. A visual isolate with `pool` is rejected with the new `pools_headless_only` code, which replaces `pools_unsupported`. Supervision of a pool as a group arrives next; until then each member is supervised on the pool's heartbeat.
