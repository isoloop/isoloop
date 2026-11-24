---
'@isoloop/bus': patch
'@isoloop/react': patch
'@isoloop/preact': patch
---

With the kernel's `dev: true`, the bus now warns in the console, once per topic per isolate, when an isolate subscribes to a topic it already subscribes to. The newer subscription replaces the older one, as before; the warning names the isolate and the topic, since a second `useTopic` or `bus.subscribe` on the same topic is the usual cause.
