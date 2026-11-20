---
'@isoloop/host': minor
'@isoloop/protocol': minor
'@isoloop/bus': minor
---

Crash reasons, durability reasons and the durability event are snake_case, like the error codes. The strings changed, so code that compares them needs the new spelling:

- `CrashReason`: `worker-error` is now `worker_error`, `ready-timeout` is `ready_timeout`, `spawn-failed` is `spawn_failed`, `render-fmt-mismatch` is `render_format_mismatch`, `bus-failed` is `bus_failed`, `runtime-too-old` is `runtime_too_old` and `isolate-too-old` is `isolate_too_old`.
- `DurabilityDegraded`: `another-tab` is now `another_tab`, `no-sync-access` is `no_sync_access` and `open-failed` is `open_failed`.
- The kernel event `bus:durability-degraded` is now `bus:durability_degraded`.

Option values you write in config, such as `'bottom-right'` or `'last-n'`, keep their kebab-case.
