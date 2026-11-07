---
'@isoloop/bus': minor
---

Recovery: `OpfsStorage.open()` truncates a torn tail off each topic's newest segment and skips a corrupt frame inside a segment, keeping every intact record after it; `TsEngine.restore` rebuilds persistent topics and their committed offsets from disk, and the bus worker reports them in `ready.restored`.
