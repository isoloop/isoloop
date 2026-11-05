---
'@isoloop/host': minor
---

The compositor applies batches within a frame budget (`KernelConfig.compositor.frameBudgetMs`, default 8 ms). Isolates take turns one batch at a time, starting from a rotating isolate each frame, and the first batch of a frame always applies (I8). Batches are never split; leftovers roll to the next frame. `snapshot().surface` gains `dropped` (batches discarded by a restart) and `lastFrameMs`.
