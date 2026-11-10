---
'@isoloop/bus': patch
---

Time and last-n retention let go of expired records right away. The memory engine used to free records only a whole 4,096-record chunk at a time, so a slow topic kept expired records referenced until the chunk holding its tail filled. In the plant dashboard that meant 30 s of spectra held for up to about 17 minutes, and the bus worker grew by about 52 MB in 10 minutes (`docs/investigations/plant-memory.md`).
