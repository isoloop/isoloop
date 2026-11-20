# Build a dev tool as an isolate

A dev tool is an isolate with a surface that watches your page: this page shows how to build one that reads your topics or the kernel's inspection feed, using `@isoloop/devtools` as the example.

## When to use it

Build a dev tool when the [devtools panel](devtools.md) doesn't show what you need: a view of one feature's topics, a board of the isolates you care about, or buttons that run your own actions. Each tool runs in a worker of its own, next to the app.

- **To watch a page without writing code,** add the [devtools panel](devtools.md).
- **To read the feed from the main thread,** use `kernel.inspect()` ([inspection guide](inspection.md)).
- **To let a coding agent drive the page,** use [tools for agents](agents.md).

## Why a dev tool is an isolate

`@isoloop/devtools` is one visual isolate, spawned by `connectDevtools` with a surface that covers the viewport. Being an isolate gives it what any isolate has:

- **Containment.** A crash or hang in the tool stays in its worker. The supervisor restarts it, and past the restart limit it shows the fallback, which for the panel is a small box with a Retry button. The app keeps running ([getting started](getting-started.md#what-a-crash-does)).
- **A feed that outlives the bus.** The tool reads the inspection feed over a port of its own from the host, not through bus topics. It keeps working while the bus restarts, which is when you most need it, and its traffic isn't in the bus figures it shows.
- **No effect on the app's page.** The tool draws into its own surface and can't touch the app's DOM. It also can't read the app's state, only what the bus and the feed give it.

It costs a worker: CPU, memory and start-up time, like any isolate ([What Isoloop can't hide](limits.md)). That's why the app opts in to it, and why you keep it out of production ([below](#keeping-it-out-of-production)).

## Two kinds of tool

| | Reads | Grants | Gets |
| --- | --- | --- | --- |
| **A topic tool** | The app's own topics | `subscribe` (and `publish`, if it writes) | `ctx.bus`, as any isolate |
| **A feed tool** | The kernel's inspection feed | `inspect: true` | `ctx.inspector`, and the controls |

A tool can be both: ask for the topics it needs and `inspect`.

## A tool that reads your topics

A topic tool needs no special access. It's an isolate that subscribes to topics it was granted. This one shows the latest cart item from the [getting started](getting-started.md#the-contracts) contracts:

```tsx
// cart-watch.tsx
import { defineIsolate, useTopic } from '@isoloop/react';
import { cartItems } from './contracts';

function CartWatch() {
  const last = useTopic(cartItems, { from: 'earliest' });
  return <pre>{last ? `${last.qty} × ${last.sku}` : 'no items yet'}</pre>;
}

export default defineIsolate(CartWatch);
```

```ts
import cartWatch from './cart-watch?isolate';

kernel.spawn({
  id: 'cart-watch',
  src: cartWatch,
  surface: document.getElementById('cart-watch')!,
  grants: { publish: [], subscribe: ['cart.items.v1'] },
});
```

It can read only what its `subscribe` patterns allow, and it's a consumer like any other, so it shows up in the bus figures. A pattern's `*` matches one or more characters, dots included: `cart.*` covers `cart.items.v1`.

## A tool that reads the feed

A feed tool holds the `inspect` grant, and the runtime gives it `ctx.inspector`: the snapshot, the live messages, records, taps and the controls. They are the calls of the host's `Inspector`, asynchronous where they cross the port ([inspection guide](inspection.md#the-inspect-grant-and-ctxinspector)).

```tsx
// isolate-board.tsx
import type { InspectSnapshot } from '@isoloop/host';
import { defineIsolate, useIsolate } from '@isoloop/react';
import { useEffect, useState } from 'react';

function Board() {
  const { inspector } = useIsolate();
  const [snap, setSnap] = useState<InspectSnapshot | undefined>();

  useEffect(() => {
    if (!inspector) return undefined;
    const refresh = (): void => {
      void inspector.snapshot().then(setSnap);
    };
    refresh();
    // Events arrive at once. Ask for a fresh snapshot to see the states they changed.
    return inspector.on((m) => {
      if (m.t === 'event') refresh();
    });
  }, [inspector]);

  if (!inspector) return <p>This tool needs the inspect grant.</p>;
  return (
    <ul>
      {snap?.isolates.map((i) => (
        <li key={i.id}>
          {i.id}: {i.state}, {i.restarts} restarts{' '}
          <button onClick={() => void inspector.restart(i.id)}>Restart</button>
        </li>
      ))}
    </ul>
  );
}

export default defineIsolate(Board);
```

```ts
import board from './isolate-board?isolate';

kernel.spawn({
  id: 'isolate-board',
  src: board,
  surface: document.getElementById('isolate-board')!,
  grants: { publish: [], subscribe: [], inspect: true },
});
```

The panel does the same in `packages/devtools/src/feed.ts`: it keeps one snapshot, applies each message to it, and fetches a fresh snapshot 100 ms after an event.

- **`ctx.inspector` is `undefined` without the grant,** so check once, as above.
- **Never pooled.** Spawning an isolate with `inspect: true` into a pool fails with `invalid_config`, because a pool merges its members' grants.
- **Its own port.** The host opens it when the isolate starts. What the tool asks before it arrives waits for it.
- **Messages are plain data.** A reader ignores message types and fields it doesn't know, so an older tool keeps working against a newer kernel.

### Records and taps

`records` reads what a topic still retains, and `tap` copies records as they are appended, without becoming a consumer:

```ts
import { defineIsolate } from '@isoloop/runtime';

export default defineIsolate({
  async start(ctx) {
    const inspector = ctx.inspector;
    if (!inspector) return;
    const recent = await inspector.records('cart.items.v1', { last: 20 });
    console.log(recent.length, 'retained');
    inspector.tap(
      { topics: ['cart.*'], maxPerSec: 20, onSkipped: (n) => console.log(n, 'left out') },
      (r) => console.log(r.topic, r.offset, r.bytes, r.preview),
    );
  },
});
```

- **Previews.** A record's value comes as text of at most 2,048 characters, with its full size in `bytes` and `truncated` when it was cut.
- **A sample.** At most `maxPerSec` records a second (default 50) arrive. `onSkipped` gets each count of records the bus left out over that, at most once a second, so your tool can tell a quiet topic from one over the cap. The devtools Messages tab shows it as `50/s cap · N skipped`.
- **After a bus restart** the host opens the tap again. Records appended while no bus runs aren't seen.
- **End it when you're done.** `tap` and `on` return the function that stops them. The panel's Messages tab taps only while it is open.

### The controls

`restart(id)`, `kill(id)` and `block(id, ms)` act on any isolate by id, including the tool itself. They reject for an unknown id and once the port has ended. `kill` ends the worker as a crash, so the supervisor restarts it, and `block` busy-loops the worker for `ms` (at most 10 s) so you can watch containment work. For a pooled isolate they act on the pool's worker. The panel's Block button uses 2 seconds.

## Spawning it from the app

`connectDevtools` is the pattern to copy: make a surface, spawn the tool with its grants, and return a function that undoes both.

- **A surface that takes no clicks.** The panel's surface covers the viewport with `pointer-events: none`, and the panel's own boxes turn them back on, so the page underneath stays usable.
- **A fallback of your own.** An isolate that has `failed` shows the default fallback at the surface's top left. The panel passes a `fallback` that puts a Retry box in its corner, since its surface takes no clicks.
- **`config`.** `kernel.spawn` takes a `config` value, which the isolate gets as `props.config` (`IsolateProps`). The panel uses it for its corner and for how its button shows health.
- **A way out.** `kernel.stop(id)` ends the isolate, and removing the surface cleans up. `connectDevtools` returns a function that does both.

```ts
import type { Kernel } from '@isoloop/host';
import board from './isolate-board?isolate';

export function connectBoard(kernel: Kernel): () => Promise<void> {
  const surface = document.createElement('div');
  document.body.append(surface);
  kernel.spawn({
    id: 'isolate-board',
    src: board,
    surface,
    grants: { publish: [], subscribe: [], inspect: true },
  });
  return async () => {
    await kernel.stop('isolate-board');
    surface.remove();
  };
}
```

## Keeping it out of production

A dev tool belongs to development. The app decides:

- **The import is the opt-in.** Nothing loads a dev tool unless the app imports and connects it. `@isoloop/devtools` is a package you install and import.
- **There's no guard for the panel.** `@isoloop/vite` fails a production build that contains `connectDevMCP`, but nothing checks for `@isoloop/devtools` or for your own tool. Keep them out yourself.
- **Import it behind `import.meta.env.DEV`,** as the [agents guide](agents.md#in-development-the-dev-mcp) does for the dev MCP:

```ts
if (import.meta.env.DEV) {
  void import('@isoloop/devtools').then(({ connectDevtools }) => {
    connectDevtools(kernel);
  });
}
```

- **The grant is the gate.** Whatever holds `inspect` can restart, kill and block every isolate, and nothing in a production build stops it. Grant it only to the isolate that needs it.

## Exposing a tool's actions to agents

A dev tool's action can be a tool for agents, the same way any topic is: a requestable topic with a `tool` field, listed in `agents.expose`, answered by an isolate ([agents guide](agents.md#a-topic-as-a-tool)). The dev MCP already has `isoloop_restart`, `isoloop_kill` and `isoloop_block`, behind `--allow-write`, so add a tool only for an action of your own.

```ts
import { topic } from '@isoloop/bus';
import { defineIsolate } from '@isoloop/runtime';
import { z } from 'zod';

export const restartTool = topic('devtools.restart.v1', {
  schema: z.object({ id: z.string() }),
  reply: z.object({ restarted: z.boolean() }),
  retention: { kind: 'last-n', n: 100 },
  tool: { description: 'Restarts one isolate.', readOnly: false, consequential: true },
});

export default defineIsolate({
  start(ctx) {
    ctx.bus.subscribe(
      restartTool,
      async (r) => {
        if (r.req === undefined) return;
        await ctx.inspector?.restart(r.value.id);
        await ctx.bus.reply(r, { restarted: true });
      },
      { from: 'committed' },
    );
  },
});
```

Add the topic to the contracts, list it in `agents.expose`, and give the isolate `subscribe` and `inspect` grants. The handler can run twice after a crash, so keep it idempotent ([agents guide](agents.md#handlers-must-be-idempotent)).

## Limits

- **It's `@experimental` in 0.1:** `kernel.inspect()`, the `inspect` grant and `ctx.inspector`, and `@isoloop/devtools`.
- **A tool costs a worker.** It adds CPU, memory and start-up time, so spawn it in development only.
- **No production gate.** Nothing stops a production build from including a dev tool, and the controls work wherever the grant is held ([inspection guide](inspection.md#controls)).
- **A tap is a sample,** capped per second, and a record is a preview of at most 2,048 characters.
- **Memory per isolate** is measured only in Chromium, on a cross-origin isolated page, and the figures are seconds old ([inspection guide](inspection.md#memory-per-isolate)).
- **A feed tool can't be pooled.**

## See also

- [The devtools panel](devtools.md), the worked example, and its source in `packages/devtools/src/`.
- [The inspection feed](inspection.md): every call, message and control.
- [Tools for agents](agents.md): exposing topics as tools, and the dev MCP.
- [ADR 0020: the inspection feed](../adr/0020-inspection-feed.md), the decisions behind `ctx.inspector`.
- [ADR 0018: tools for agents](../adr/0018-tools-for-agents.md).
