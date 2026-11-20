# @isoloop/dom

The render bridge's conformance kit, for authors of a framework adapter.

## `@isoloop/dom/testing`

### `checkDomUsage`

Runs a usage fixture worker and checks its log. Fails the test if the
framework reached for members the subset doesn't have (other than
`TOLERATED_MISSING`), or if the log differs from the committed one. Runs in
Vitest's browser mode.

```ts nocheck
function checkDomUsage(worker: Worker, logPath: string, write: boolean): Promise<UsageLog>;
```

| Parameter | Description |
| --- | --- |
| `worker` | A worker running a usage fixture (`trackUsage()`, then `reportUsage()`). It's terminated when the log arrives. |
| `logPath` | The committed log, relative to the repo root, e.g. `packages/dom/usage/preact-10.json`. |
| `write` | Rewrite the committed log with this run's before comparing. |

**Returns:** The log.

**Throws:**
- {Error} when the fixture worker throws or fails to load.

### `createIsoloopDomDriver`

The isolate side of isoloop-dom for the conformance suite: the real
worker-side subset, run in the test page without installing globals.
Batches are collected and handed over on `flush()`.

```ts nocheck
function createIsoloopDomDriver(): IsolateDriver & {
  dom: WorkerDom;
};
```

**Returns:** The driver, with the `WorkerDom` it drives.

### `mountFixture`

Applies a fixture worker's batches (from `serveFixture()`) under a new
`<div>` in the document, through the real applier, and sends the
container's `click`, `input`, `change` and `keydown` events back.

```ts nocheck
function mountFixture(worker: Worker): FixtureHost;
```

| Parameter | Description |
| --- | --- |
| `worker` | A worker that calls `serveFixture()`. |

**Returns:** The container, a way to wait until it settles, and `dispose()`.

### `mountMembers`

The page side of `servePoolFixture(n)`: one container per member, each
with its own applier, getting only that member's batches and sending its
events back for that member.

```ts nocheck
function mountMembers(worker: Worker, n: number): HTMLElement[];
```

| Parameter | Description |
| --- | --- |
| `worker` | A worker that calls `servePoolFixture(n)`. |
| `n` | How many members it serves. |

**Returns:** One container per member, in member order.

### `runBridgeConformance`

Registers the suite every render bridge must pass, as Vitest tests. Known
gaps can be marked per bridge, and run as expected failures. Batches go
through `structuredClone`, as they would through `postMessage`.

```ts nocheck
function runBridgeConformance(name: string, makePair: MakeBridgePair, opts?: {
  knownGaps?: readonly CaseName[];
}): void;
```

| Parameter | Description |
| --- | --- |
| `name` | The bridge's name, used for the `describe` block. |
| `makePair` | Makes a fresh bridge for each case. |
| `opts` | `knownGaps`: the cases expected to fail for this bridge. Default none. |

### `snapshot`

What the smoke tests compare: the markup, and the controls' live values.

```ts nocheck
function snapshot(root: Element): {
  html: string;
  input: string;
  select: string;
};
```

| Parameter | Description |
| --- | --- |
| `root` | The container the fixture app rendered into. |

**Returns:** Its `innerHTML`, the input's value and the select's value.

**Throws:**
- {Error} when the app rendered no `<input>` or `<select>`.

### `CASES`

Cases a bridge may declare as known gaps; they run as expected failures.

```ts nocheck
const CASES: {
  readonly create: "creates elements, attributes and text";
  readonly update: "updates attributes and text, and removes attributes";
  readonly move: "moves a node";
  readonly remove: "removes nodes";
  readonly keyed: "keyed list reorders keep node identity and focus";
  readonly sanitise: "sanitises tags, attributes and URLs (I9)";
  readonly ids: "maps node ids both ways";
  readonly events: "registers listeners and round-trips events";
  readonly noListener: "sends nothing for a node without a listener";
  readonly inputs: "host-owned inputs keep the live value while focused";
  readonly styles: "applies inline styles";
  readonly malformed: "rejects a malformed batch and keeps the tree";
  readonly classList: "classList reads and writes the class attribute";
  readonly dataset: "dataset reads and writes data-* attributes";
  readonly getElementById: "getElementById finds rendered elements by id";
  readonly contains: "contains walks the isolate tree";
  readonly fragment: "inserting a fragment inserts its children in order and empties it";
  readonly comment: "comment nodes round-trip, and their data updates";
  readonly forced: "a forced value replaces a focused input’s value, caret at the end";
};
```

### `SMOKE_STEPS`

The user actions the smoke tests take on the fixture app (the same ones
`driveUsageFixture` sends as events), for a container either way: the
fixture host's or a real-DOM render's.

```ts nocheck
const SMOKE_STEPS: readonly {
  name: string;
  act(root: Element): void;
}[];
```

### `TOLERATED_MISSING`

Reads the subset doesn't serve, each with why that's fine. A read of an
absent member returns `undefined`, which these call sites handle.

```ts nocheck
const TOLERATED_MISSING: Readonly<Record<string, string>>;
```

### `BridgePair`

One bridge under test: its host side and its isolate side, freshly made.

```ts nocheck
interface BridgePair {
  host: ConformanceHost & Partial<NodeIds>;
  isolate: IsolateDriver;
  internalAttr?: (name: string) => boolean;
}
```

| Field | Description |
| --- | --- |
| `host` | The host side, with the node-id lookups if the bridge has them. |
| `isolate` | The isolate side. |
| `internalAttr?` | Attributes the bridge writes for its own bookkeeping, left out when trees are compared. |

### `CaseName`

The name of one case in the suite, a key of `CASES`.

```ts nocheck
type CaseName = keyof typeof CASES;
```

### `ConformanceEvent`

An event as a host bridge sends it to the isolate, reduced to what the suite reads.

```ts nocheck
type ConformanceEvent = {
  type: string;
  target: string;
  currentTargets: string[];
  value?: string;
  mods: {
    alt: boolean;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
  };
};
```

### `ConformanceHost`

The host side of a bridge, as the compositor drives it.

```ts nocheck
interface ConformanceHost {
  mount(root: ShadowRoot, send: (event: ConformanceEvent) => void): void;
  apply(batch: unknown): boolean;
  unmount(): void;
}
```

| Member | Description |
| --- | --- |
| `mount()` | Starts rendering into `root`. |
| `apply()` | Applies one batch. |
| `unmount()` | Stops rendering and removes what was rendered. |

### `FixtureHost`

The page side of a mounted fixture worker.

```ts nocheck
type FixtureHost = {
  readonly container: HTMLElement;
  settled(quietMs?: number): Promise<void>;
  dispose(): void;
};
```

| Member | Description |
| --- | --- |
| `container` | What the worker rendered, under a `<div>` in the document. |
| `settled()` | Resolves once the worker has rendered and no batch has arrived for `quietMs` (default 30). Rejects if the worker failed, or rendered nothing within 5 s. |
| `dispose()` | Terminates the worker and removes the container. |

### `FixtureMessage`

What a fixture worker posts to the page.

```ts nocheck
type FixtureMessage = {
  t: "batch";
  batch: DomBatch;
  member?: number;
} | {
  t: "usage";
  log: UsageLog;
} | {
  t: "error";
  error: string;
};
```

### `Handle`

A node on the isolate side, as the suite sees it. Opaque to the suite.

```ts nocheck
type Handle = {
  readonly __handle: true;
};
```

### `IsolateDriver`

The isolate side of a bridge, reduced to the DOM operations the suite needs.
Each bridge provides its own; the isoloop-dom driver calls the worker-side
DOM subset.

```ts nocheck
interface IsolateDriver {
  readonly root: Handle;
  el(tag: string): Handle;
  text(data: string): Handle;
  comment(data: string): Handle;
  fragment(): Handle;
  childCount(parent: Handle): number;
  insert(parent: Handle, child: Handle, before?: Handle | null): void;
  remove(child: Handle): void;
  setAttr(el: Handle, name: string, value: string | null): void;
  setText(text: Handle, data: string): void;
  setValue(el: Handle, value: string, force?: boolean): void;
  listen(el: Handle, type: string): void;
  classList(el: Handle, op: "add" | "remove" | "toggle" | "contains", token: string, force?: boolean): boolean;
  dataset(el: Handle, key: string, value?: string | null): string | undefined;
  byId(id: string): Handle | null;
  contains(a: Handle, b: Handle | null): boolean;
  flush(): unknown[];
  idOf(h: Handle): string;
  handleFor(nodeId: string): Handle | undefined;
}
```

| Member | Description |
| --- | --- |
| `root` | An element with `class="cf-root"` that the suite builds under. Already inserted. |
| `el()` | `document.createElement(tag)`. |
| `text()` | `document.createTextNode(data)`. |
| `comment()` | `document.createComment(data)`. |
| `fragment()` | `document.createDocumentFragment()`; `insert` takes it as a parent or a child. |
| `childCount()` | How many children `parent` has, on the isolate side. |
| `insert()` | Inserts `child` into `parent` before `before`, or at the end. Moves it if it's already in the tree. |
| `remove()` | `child.remove()`. |
| `setAttr()` | `el.setAttribute(name, value)`; `null` removes the attribute. |
| `setText()` | Sets a text or comment node's `data`. |
| `setValue()` | Sets the `value` property, as a framework does on a controlled input; `force` overrides a focused host input. |
| `listen()` | Adds a listener for `type` on `el`. |
| `classList()` | `el.classList`: `add`, `remove`, `toggle` (with `force`) or `contains`; returns whether `el` has the token after. |
| `dataset()` | `el.dataset[key] = value`, or `delete el.dataset[key]` for `null`; returns `el.dataset[key]` after. |
| `byId()` | `document.getElementById(id)`. |
| `contains()` | `a.contains(b)`. |
| `flush()` | The batches produced since the last flush, in order. |
| `idOf()` | The node id the isolate side uses for `h`, for bridges that expose ids. |
| `handleFor()` | The handle an event's `target` or `currentTargets` entry names. |

### `MakeBridgePair`

Makes a fresh `BridgePair`; the suite calls it once per case.

```ts nocheck
type MakeBridgePair = () => BridgePair;
```

### `NodeIds`

Host-side node-id lookups. Optional until every bridge has them.

```ts nocheck
interface NodeIds {
  idFor(node: Node): string | undefined;
  nodeFor(id: string): Element | undefined;
}
```

| Member | Description |
| --- | --- |
| `idFor()` | The id the bridge gave a host node, or `undefined` if it has none. |
| `nodeFor()` | The host element with this id, or `undefined`. |

### `UsageLog`

One framework major's log, as `packages/dom/usage/<project>.json` stores it.

```ts nocheck
type UsageLog = {
  framework: string;
  used: string[];
  missing: string[];
  probed: string[];
};
```

| Field | Description |
| --- | --- |
| `framework` | E.g. `preact@10.29.8`. |
| `used` | `Class.member` for every member of the subset that was read, written or called. |
| `missing` | Members looked up that nothing in the subset defines (reads that came back `undefined`). |
| `probed` | Names checked with `in` that the subset doesn't define: feature probes, not uses. |

## `@isoloop/dom/testing/worker`

### `driveUsageFixture`

Drives the usage fixture the way a user would, through host events: the
fixture renders `<button name="toggle">` (hides and shows a conditional
child), `<button name="reorder">` (reverses a keyed list), a controlled
`<input>` and a `<select>`.

```ts nocheck
function driveUsageFixture(dom: WorkerDom, settle: () => Promise<void>): Promise<void>;
```

| Parameter | Description |
| --- | --- |
| `dom` | The worker DOM from `serveFixture()`. |
| `settle` | Resolves once the framework has committed. |

**Throws:**
- {Error} when the fixture didn't render one of those controls.

### `reportUsage`

Runs the fixture, lets the framework settle, and posts the log to the page,
or the error if `run` throws.

```ts nocheck
function reportUsage(tracker: UsageTracker, framework: string, run: () => Promise<void>): Promise<void>;
```

| Parameter | Description |
| --- | --- |
| `tracker` | From `trackUsage()`. |
| `framework` | The framework and version to record, e.g. `preact@10.29.8`. |
| `run` | Renders the fixture and drives it, for example with `driveUsageFixture()`. |

### `serveFixture`

Installs the subset as this worker's `document`, posts every batch, and
delivers the page's events. Import it before the framework: React decides
at load time whether it has a DOM. Uncaught errors are posted with their
stack, which a worker `error` event doesn't carry. Pair with
`mountFixture()` on the page.

```ts nocheck
function serveFixture(): {
  dom: WorkerDom;
  container: Element;
};
```

**Returns:** The worker DOM, and its root as an `Element` to render into.

### `servePoolFixture`

A pooled fixture: one subset document installed as this worker's
`document`, with `n` render roots, one per member. Each root's batches are
posted with its `member` index, and the page's events for a member go to
its root. Pair with `mountMembers()` on the page.

```ts nocheck
function servePoolFixture(n: number): Element[];
```

| Parameter | Description |
| --- | --- |
| `n` | How many members, each with a render root. |

**Returns:** The roots, in member order, to render each member into.

### `trackUsage`

Starts logging which members of the subset a framework uses, and which it
reaches for that the subset doesn't have. Call it before the framework
renders; it patches the subset's classes for the whole worker and can't be
undone.

```ts nocheck
function trackUsage(): UsageTracker;
```

**Returns:** The tracker, whose `report()` gives the log.

### `FixtureMessage`

Re-exported from `@isoloop/dom/testing`: see [`FixtureMessage`](#fixturemessage).

### `UsageLog`

Re-exported from `@isoloop/dom/testing`: see [`UsageLog`](#usagelog).

### `UsageTracker`

The usage log being kept, from `trackUsage()`.

```ts nocheck
type UsageTracker = {
  report(framework: string): UsageLog;
};
```

| Member | Description |
| --- | --- |
| `report()` | The log so far, sorted. |

<!-- Generated by scripts/docs/api.ts from the published types. Do not edit: run `pnpm docs:api`. -->
