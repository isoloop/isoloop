---
'@isoloop/protocol': minor
'@isoloop/host': minor
'@isoloop/runtime': minor
---

Host calls (design §4.7). `ctx.host.measure`, `focus` and `scrollIntoView` post a `call` and settle on the `result`, with a 5 s timeout. The isolate flushes its pending patches first, and the host runs the call through the compositor after them, so `measure` sees the new layout. It returns a `Rect` relative to the surface. `navigate` fails with `routing_disabled` until M2, and `requestCanvas` with the new code `unsupported` until M3. A node the host never rendered fails with the new code `not_found`.
