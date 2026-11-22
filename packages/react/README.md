# @isoloop/react

React for [Isoloop](https://isoloop.dev): write an isolate as a React component, rendered in its worker and drawn on the page.

## What you get

- **Your components in a worker:** `defineIsolate(Component)` turns a React 18 or 19 component into an isolate.
- **Topics as state:** `useTopic` follows a topic's latest value, read again after a restart with `from: 'earliest'`, and `usePublish` writes to a topic.
- **The page through hooks:** `useHost` to measure, focus, scroll, navigate and get a canvas, and `useRoute` for the current location.
- **Portals:** `usePortalRoot` gives modals, tooltips and menus a place inside the isolate.
- **Errors reach the supervisor:** a render error restarts that isolate, and in a pool only that member.
- **Request and reply** (experimental): `useRequest`.

## Install

```sh
npm install @isoloop/react@next @isoloop/runtime@next react react-dom
```

## Example

```tsx
import { defineIsolate, usePublish, useTopic } from '@isoloop/react';
import { count } from './topics'; // a topic from your contracts

function Counter() {
  const n = useTopic(count, { from: 'earliest' }) ?? 0;
  const publish = usePublish(count);
  return <button onClick={() => void publish(n + 1)}>Count: {n}</button>;
}

export default defineIsolate(Counter);
```

## Learn more

- [React isolates](https://isoloop.dev/docs/isolates/#react) and [the hooks](https://isoloop.dev/docs/isolates/#the-hooks)
- [What Isoloop can't hide](https://isoloop.dev/docs/limits/)
- [API reference](https://isoloop.dev/docs/api/react/)
