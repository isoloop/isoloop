---
'@isoloop/react': minor
'@isoloop/preact': minor
'@isoloop/bus': patch
---

Several components can now `useTopic` the same topic, and they all update. Every `useTopic` on a topic in one isolate shares one bus subscription: the first to mount subscribes, the last to unmount unsubscribes, and a component that mounts later gets the current value at once. Before, a second `useTopic` on a topic replaced the first, which stopped updating. The first `useTopic`'s `from` sets where the shared subscription starts; a later one with a different `from` gets the shared value, and the console warns once. `useRoute` shares the route topic's subscription the same way. The bus's dev warning for a repeated subscribe names `bus.subscribe`, since `useTopic` no longer causes it.
