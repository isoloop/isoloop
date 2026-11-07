---
---

`@isoloop/react`: `defineIsolate(Component)` renders with `createRoot` under the isolate context and unmounts on shutdown; `useTopic` reads a topic through `useSyncExternalStore` (StrictMode leaves one subscription) and `usePublish` publishes. The bootstrap now installs the DOM subset before it imports the isolate module, since React checks for a DOM when it loads.
