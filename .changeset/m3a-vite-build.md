---
---

`@isoloop/vite` builds isolates: `?isolate` imports give an isolate module's URL (emitted as its own chunk, exports kept), `isoloop({ isolates })` builds the listed ones, maps them in `virtual:isoloop/isolates` and writes `isoloop-manifest.json`, and `library: true` builds only the isolates, for a repository that ships them to another host.
