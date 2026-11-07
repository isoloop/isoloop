---
'@isoloop/bus': minor
---

The bus worker keeps persistent topics in OPFS where sync access handles exist (`ready.storage: 'opfs'`), restores them on boot and after a crash, and falls back to memory if the files can't be opened. After a bus restart, a subscription to a persistent topic resumes from its committed offset with no `reset`. The one-time "behaves as memory" console warning is gone.
