# Testing isolates and contracts

Test an isolate's logic and your contracts module in plain unit tests, with `@isoloop/runtime/testing` and `@isoloop/bus/testing`, and leave rendering and real workers to browser tests.

## When to use it

Tests of an isolate or of your topics belong in three layers:

| What you test | How | Where it runs |
| --- | --- | --- |
| What an isolate publishes, subscribes to, asks and does on shutdown | `createTestContext`, below | A headless isolate runs in Node. One with a `root` needs a DOM, so a browser test. |
| That every topic's schema accepts your sample data and outputs plain data | `testContracts`, below | Node |
| Rendering, real workers, crashes and restarts, headers | A browser test, [last section](#what-is-left-to-browser-tests) | A browser |

Reach for the first two in every project: they're quick, and they need no worker, bus or kernel. They don't replace the third. What the faked parts leave out is listed in [Limits](#limits).

## Test an isolate's logic

`createTestContext` from `@isoloop/runtime/testing` returns an `IsolateContext` (`ctx`) with nothing behind it: no worker, no bus worker and no host. You start your isolate with it, then drive the bus by hand and read what the isolate did.

```ts
import { defineIsolate } from '@isoloop/runtime';
import { createTestContext } from '@isoloop/runtime/testing';
import { expect, it } from 'vitest';
import { cartItems } from './contracts';

// Normally imported from the isolate's own module.
const cartTotal = defineIsolate({
  start(ctx) {
    let total = 0;
    ctx.bus.subscribe(
      cartItems,
      async (record) => {
        total += record.value.qty;
        await ctx.bus.publish(cartItems, { sku: 'total', qty: total }, { key: 'total' });
      },
      { from: 'earliest', onReset: () => (total = 0) },
    );
  },
});

it('publishes the running total', async () => {
  const t = createTestContext();
  await cartTotal.start(t.ctx);

  t.emit('cart.items.v1', { sku: 'a', qty: 2 }, 'a');
  t.emit('cart.items.v1', { sku: 'b', qty: 3 }, 'b');
  await Promise.resolve(); // emit doesn't wait for the handler

  expect(t.subscriptions()).toEqual([{ topic: 'cart.items.v1', from: 'earliest' }]);
  expect(t.published.at(-1)).toEqual({
    topic: 'cart.items.v1',
    key: 'total',
    value: { sku: 'total', qty: 5 },
  });
});
```

The options of `createTestContext` are a `TestContextOptions`, and all are optional:

| Option | What it does | Default |
| --- | --- | --- |
| `id` | `ctx.id` | `'test'` |
| `config` | `ctx.config`, what the host passes as the manifest's `config` | `null` |
| `root` | `ctx.root`, the render root: an element on the test page | none: a headless context |
| `respond` | Answers `ctx.bus.request`, as `(topic, value) => reply` | the request rejects with `timeout` |
| `host` | Replaces any of the host calls on `ctx.host` | see [Host calls](#host-calls) |

It returns a `TestContext`: the `ctx`, and the handles below.

### What it fakes

- **`ctx.bus`:** an in-memory client. `publish` records the call and resolves. `subscribe` keeps the handler until its unsubscribe function is called. `request` is [answered by `respond`](#requests). `reply` resolves and `commit` does nothing.
- **`ctx.host`:** the async host calls, [answered by you](#host-calls).
- **`ctx.reportError`:** collects the errors in `errors`, each as `{ error, fatal }`, with `fatal` true unless the call passed `fatal: false`. Nothing crashes.
- **`ctx.onShutdown`:** collects the handlers, which [`shutdown`](#shutdown) runs.
- **`ctx.portalRoot`:** made on first read from `root`'s document, and added to `root` after the current render has committed, as in a worker. It's `undefined` without a `root`.
- **`ctx.styles`, `ctx.setValue` and `ctx.keepAwake`:** do nothing, and `ctx.inspector` is `undefined`.

### Publish and subscribe

The context is driven by the test, so nothing arrives on its own.

- **`emit(topic, value, key?)`:** delivers a record to every subscription on `topic`, in the order they subscribed. The records get offsets 0, 1, 2 and so on, the current time and the producer `'test'`.
- **`published`:** every `publish` the isolate made, in order, as `{ topic, key?, value }`. The `key` is there only when the isolate passed one.
- **`subscriptions()`:** the subscriptions still open, as `{ topic, from }`. `from` is the start position the isolate asked for, `'latest'` when it gave none.
- **`reset(topic)`:** runs the `onReset` of every subscription on `topic`, as after a bus restart lost a memory topic.

Topics are matched by name, so `emit` takes the name (`'cart.items.v1'`), not the topic.

`emit` doesn't wait for a handler: it starts each one and returns. A handler that does async work isn't finished when `emit` returns, so wait for what you assert on (a microtask, or a promise your test holds). It doesn't catch a handler's errors either: a handler that throws synchronously throws out of `emit`, and one that rejects is an unhandled rejection.

### Requests

`ctx.bus.request` calls `respond(topic, value)` and resolves with what it returns (or with the promise's result). A `respond` that throws rejects the request.

```ts
import { createTestContext } from '@isoloop/runtime/testing';
import { expect, it } from 'vitest';
import { quoteTool } from './contracts';

it('asks for a quote', async () => {
  const t = createTestContext({
    respond: (topic) => (topic === 'markets.quote.v1' ? { symbol: 'ACME', vwap: 12.5 } : undefined),
  });
  const reply = await t.ctx.bus.request(quoteTool, { symbol: 'ACME' });
  expect(reply.vwap).toBe(12.5);
});
```

Without `respond`, a request waits for its `timeoutMs` (30 000 ms by default, on a real timer) and rejects with a `BusError` whose `code` is `timeout`. Pass a small `timeoutMs` in the call, or give `respond`, to keep a test quick. `respond` returns whatever you give it: the reply schema isn't applied.

### Host calls

`ctx.host` has the isolate's async calls to the page: `measure`, `focus`, `scrollIntoView`, `navigate` and `requestCanvas` ([What Isoloop can't hide](limits.md) says what they're for). By default, `measure` resolves a rect of zeros, `navigate` resolves `true`, `focus` and `scrollIntoView` resolve, and `requestCanvas` resolves a 1 by 1 `OffscreenCanvas`, which Node doesn't have: give your own `requestCanvas` in Node. Replace any of them with `host`, which also tells you what the isolate asked:

```ts
import { createTestContext } from '@isoloop/runtime/testing';
import { expect, it } from 'vitest';

it('measures the node it was given', async () => {
  const asked: unknown[] = [];
  const t = createTestContext({
    host: {
      measure: (node) => {
        asked.push(node);
        return Promise.resolve({ x: 0, y: 0, width: 320, height: 40 });
      },
    },
  });
  const rect = await t.ctx.host.measure({ node: 'panel' });
  expect(rect.width).toBe(320);
  expect(asked).toEqual([{ node: 'panel' }]);
});
```

### Shutdown

`shutdown(reason?)` runs every handler registered with `ctx.onShutdown`, with the reason (`'stop'` by default, or `'restart'` or `'suspend'`), and resolves once all have settled. It's what the runtime does when the host stops an isolate, so use it to test cleanup. A handler that throws doesn't fail `shutdown`, and it doesn't close the subscriptions: they stay in `subscriptions()`.

```ts
import { createTestContext } from '@isoloop/runtime/testing';
import { expect, it } from 'vitest';

it('flushes on shutdown', async () => {
  const t = createTestContext();
  const reasons: string[] = [];
  t.ctx.onShutdown((reason) => {
    reasons.push(reason);
  });
  await t.shutdown('restart');
  expect(reasons).toEqual(['restart']);
});
```

### An isolate with a root

Give `root` an element on the test page, and the isolate renders into it, so the test needs a DOM: a browser test (Vitest's browser mode), or a DOM library in Node. The adapters' own tests work this way: they create an element, start `defineIsolate(Component)` with `createTestContext({ root })`, and read the element ([`hooks.browser.test.tsx`](../../packages/react/src/hooks/hooks.browser.test.tsx) in the React adapter). The DOM there is the browser's, not the worker DOM an isolate gets in production ([What Isoloop can't hide](limits.md)).

## Test your contracts

Your contracts module is the one place every topic's schema lives, so a test of it protects every isolate. `testContracts` from `@isoloop/bus/testing` takes the contracts list and sample values per topic name, runs the samples through each schema, and returns the problems it found. An empty array means every check passed.

```ts
import { testContracts } from '@isoloop/bus/testing';
import { expect, it } from 'vitest';
import list from './contracts';

it('every topic accepts its samples and outputs plain data', async () => {
  const problems = await testContracts(list, {
    'cart.items.v1': [{ sku: 'sku-1', qty: 1 }],
    'markets.quote.v1': { values: [{ symbol: 'ACME' }], replies: [{ symbol: 'ACME', vwap: 12.5 }] },
    'markets.alerts.create.v1': {
      values: [{ symbol: 'ACME', above: 20 }],
      replies: [{ id: 'a1', created: true }],
    },
  });
  expect(problems).toEqual([]);
});
```

`TopicSamples`, the value for one topic, is either an array of sample values, or `{ values, replies? }` when the topic has a `reply` schema. Keys are topic names. A topic you give no samples for isn't skipped: it's a problem.

### What it checks

For every topic in the list, `testContracts` runs each sample through the schema (through the `reply` schema for each sample in `replies`) and checks the schema's output, not the sample. Each problem is a `ContractProblem`, with the topic's name, which schema (`schema`: `'value'` or `'reply'`), the index of the sample (`sample`), a `message`, and one of three kinds:

- **`invalid`:** the schema rejected the sample. `issues` lists what it found, each with a `message` and a `path`.
- **`not_plain`:** the schema accepted the sample, but its output isn't plain data that structured cloning keeps whole: a function, a symbol, or an instance of a class (a transform that returns `new Money(…)`, say). `message` names the first such part, for example `output is an instance of Money`. Plain objects, arrays, `Map`, `Set`, `Date`, `RegExp`, `ArrayBuffer` and its views pass.
- **`no_samples`:** the topic has no `values`. Its `sample` is `-1`, and its `schema` is `'value'`.

The `not_plain` check matters because the bus stores a schema's output, not what was published. A persistent topic rejects an output that can't be encoded, with `not_encodable`. For a memory topic, the broker checks cloneability only when `KernelConfig.dev` is set, so a bad output could first show up in production. Running `testContracts` in your contracts package's tests finds it first.

Give each topic samples that cover its schema's branches: a value with every optional field, one with none, the values your transforms and defaults change. Samples for names that aren't in the list are ignored, and a `reply` schema without `replies` isn't checked, so list the replies of every topic that has one.

## What is left to browser tests

The two helpers fake the isolate's side of a conversation, so they say nothing about what happens when real workers run it. These need a browser:

- **Rendering:** what an isolate draws into its surface, and how the host applies it, in the worker DOM and the real page.
- **Real workers:** the ready handshake, grants refusing a topic, pools, and what a topic keeps and replays across restarts.
- **Crashes:** that a throwing or hanging isolate is restarted, and what the user sees meanwhile ([Getting started](getting-started.md#what-a-crash-does)).
- **Headers:** that your page and its servers send what [Hosting](hosting.md) lists.

Isoloop ships no helper for these. A test starts the kernel in a browser, as your app does, and drives the page. This repo does so with Vitest's browser mode for the packages' own tests (`*.browser.test.ts`, run by `pnpm test:browser`) and with Playwright for the end-to-end suites against a harness page ([`e2e/`](../../e2e/), run by `pnpm e2e`), in Chromium, Firefox and WebKit. Either runner works in your project.

**On Firefox, wait with one query.** Many Playwright locators waiting at once can hold back the messages a page's workers send it, such as heartbeats and `ready`, on a page with many surfaces. Healthy isolates are then killed as `unresponsive` or crash with `ready_timeout`, only under test. Wait for many surfaces with a single `page.waitForFunction` that polls at an interval (`polling: 500`) and reads each `iso-surface`'s `shadowRoot`. If runs still fail that way, run those tests one at a time (`--workers=1`).

`@isoloop/dom/testing` is a conformance kit for people who write a render adapter, not for testing an app. It's documented in the API reference only.

## Limits

- **The test context isn't the runtime.** It doesn't check a published value against its schema, doesn't look at grants, and keeps no log: nothing is retained, replayed or redelivered. `from`, `group`, `autoCommit` and `onGap` are accepted and ignored, apart from the `from` that `subscriptions()` reports. Test redelivery by calling `emit` twice with the same record, and the schemas with `testContracts`.
- **No crash and no restart.** `reportError` records the error and nothing else, and no supervisor runs. The browser tests above cover restarts.
- **No render.** `styles` and `setValue` do nothing, and a `root` is an ordinary element, not the worker DOM, so layout, focus and the worker's missing globals aren't reproduced ([What Isoloop can't hide](limits.md)).
- **One isolate.** A test context has one isolate and no other: records an isolate publishes don't reach its own subscriptions, so feed them in with `emit`.
- **Samples are yours.** `testContracts` finds only what your samples reach, and it doesn't check retention, names or tool metadata.

## See also

- [Getting started](getting-started.md): the contracts module, the kernel and a first isolate.
- [What Isoloop can't hide](limits.md): what works differently inside an isolate.
- [Hosting](hosting.md): the headers to check in a browser test.
