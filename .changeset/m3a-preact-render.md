---
---

`@isoloop/preact`: `defineIsolate(Component)` renders into the isolate's surface under the isolate context and unmounts on shutdown; `useTopic(topic, { from })` keeps a topic's latest value (cleared on reset) and `usePublish(topic)` publishes. `@isoloop/runtime/testing` adds `createTestContext()`, an isolate context without a worker for testing components.
