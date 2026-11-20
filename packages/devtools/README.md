# @isoloop/devtools

**Experimental.** A devtools panel for [Isoloop](https://github.com/isoloop/isoloop), drawn by a visual isolate in its own worker, so a crash or hang in the panel never touches the app. It reads the [inspection feed](https://github.com/isoloop/isoloop/blob/main/docs/guide/inspection.md).

```sh
npm install @isoloop/devtools@next @isoloop/host@next
```

```ts
import { connectDevtools } from '@isoloop/devtools';

const disconnect = connectDevtools(kernel, { position: 'bottom-right' });
```

The options, the panel's tabs, the bundler setup and the limits are in the [devtools guide](https://github.com/isoloop/isoloop/blob/main/docs/guide/devtools.md).
