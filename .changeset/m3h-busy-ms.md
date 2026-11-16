---
'@isoloop/protocol': minor
'@isoloop/runtime': minor
'@isoloop/host': minor
'@isoloop/react': minor
'@isoloop/preact': minor
---

Each isolate's busy time (ADR 0017). Every beat reports `busyMs` for each member: the milliseconds its worker spent running that isolate's code since the last beat. A pool reports it in `members[id]` and an own worker in `idle`, and `kernel.isolates()` shows it as `IsolateSnapshot.busyMs`. Per worker, `lagMs` is unchanged. It is always on, costs two `performance.now()` calls per callback, and sends no new messages.

The runtime counts what it dispatches to an isolate (host messages, `start`, DOM flushes) and every callback the isolate registers. Before any member loads, it wraps the worker's `setTimeout`, `setInterval`, `requestAnimationFrame`, `queueMicrotask` and `requestIdleCallback`, plus `MessagePort` `onmessage` and `message` listeners. Each callback is billed to the isolate that registered it, so chains stay with it. The wrapped functions behave as the natives do: ids, `clear*`, `this`, arguments, errors, `name` and `length` are all unchanged.

A pool's shared framework renders several members in one task, and that task is split equally among the members whose roots it touched:
- **React:** the runtime installs a minimal `__REACT_DEVTOOLS_GLOBAL_HOOK__`, which production react-dom calls on every commit. The adapter names its container to the runtime.
- **Preact:** the adapter runs each render batch through `options.debounceRendering`. A root's first DOM change since its last flush names it.

Not counted, and visible only in `lagMs`: promise continuations, module evaluation, other schedulers, and the worker's shared work, such as garbage collection.
