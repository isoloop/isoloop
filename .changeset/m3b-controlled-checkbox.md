---
'@isoloop/dom': patch
---

A controlled checkbox whose state arrives after the click (from a topic) is drawn with that state. One click fires `click`, `input` and `change` with the same `checked`; only the first now reports it to the worker, so the later ones can't overwrite what React restored in between.
