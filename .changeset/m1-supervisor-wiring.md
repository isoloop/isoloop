---
'@isoloop/host': minor
---

Supervisor wiring. A blocked isolate's surface shows a busy overlay, and a failed one shows a fallback with a Retry button; `manifest.fallback` replaces the fallback with the host's own render function. Worker `messageerror` counts as a crash. Heartbeats are judged every 50 ms. Nothing is judged blocked or killed while the page is hidden, and every heartbeat clock restarts when it is shown again or resumes from frozen.
