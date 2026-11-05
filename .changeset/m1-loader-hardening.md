---
'@isoloop/host': minor
'@isoloop/runtime': minor
'@isoloop/protocol': minor
---

Loader hardening. `kernel.stop` sends `shutdown` and terminates on the isolate's new `bye` message or after a 1 s grace period, and its promise settles once the worker is gone. `spawn` throws a `KernelError`: `pools_unsupported` for `manifest.pool`, `suspend_unsupported` for any `manifest.suspend` other than `'never'`, and `invalid_manifest`. Passing `workers.budget` (default 32) live workers warns once and emits `workers:budget`, but never blocks a spawn. A `new Worker` that throws crashes the isolate with reason `spawn-failed`. A failed cross-origin import names the URL and points to the CORS guide (`docs/guide/hosting.md`).
