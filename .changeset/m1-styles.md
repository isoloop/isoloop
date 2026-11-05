---
'@isoloop/protocol': minor
'@isoloop/host': minor
'@isoloop/runtime': minor
---

Styles (design §4.8). `ctx.styles(css)` adds stylesheets to an isolate's surface. They travel with the next patch in `patch.styles` and are adopted into the shadow root as constructable stylesheets just before that patch applies. Isolate CSS stays inside its surface, and host design tokens reach in as CSS custom properties. A restart drops the isolate's sheets.
