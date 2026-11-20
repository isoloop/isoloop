# @isoloop/dom

The render bridge's conformance kit, for authors of a framework adapter.

## `@isoloop/dom/testing`

### `checkDomUsage`

```ts nocheck
function checkDomUsage(worker: Worker, logPath: string, write: boolean): Promise<UsageLog>;
```

### `createIsoloopDomDriver`

The isolate side of isoloop-dom for the conformance suite: the real
worker-side subset, run in the test page without installing globals.
Batches are collected and handed over on `flush()`.

```ts nocheck
function createIsoloopDomDriver(): IsolateDriver & {
  dom: WorkerDom;
};
```

### `mountFixture`

```ts nocheck
function mountFixture(worker: Worker): FixtureHost;
```

### `mountMembers`

The page side of `servePoolFixture(n)`: one container per member, each
with its own applier, getting only that member's batches and sending its
events back for that member (ADR 0015, M2d task 2).

```ts nocheck
function mountMembers(worker: Worker, n: number): HTMLElement[];
```

### `runBridgeConformance`

The suite every render bridge must pass, with no known gaps for the
isoloop-dom bridge. Known gaps can be marked per bridge. Batches go through
`structuredClone`, as they would through `postMessage`.

```ts nocheck
function runBridgeConformance(name: string, makePair: MakeBridgePair, opts?: {
  knownGaps?: readonly CaseName[];
}): void;
```

### `snapshot`

What the smoke tests compare: the markup, and the controls' live values.

```ts nocheck
function snapshot(root: Element): {
  html: string;
  input: string;
  select: string;
};
```

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

```ts nocheck
interface BridgePair {
  host: ConformanceHost & Partial<NodeIds>;
  isolate: IsolateDriver;
  internalAttr?: (name: string) => boolean;
}
```

| Field | Description |
| --- | --- |
| `internalAttr?` | Attributes the bridge writes for its own bookkeeping, left out when trees are compared. |

### `CaseName`

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
| `apply()` | Applies one batch. Returns false and changes nothing if the batch is malformed. |

### `FixtureHost`

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
| `comment()` | `document.createComment(data)`. |
| `fragment()` | `document.createDocumentFragment()`; `insert` takes it as a parent or a child. |
| `childCount()` | How many children `parent` has, on the isolate side. |
| `insert()` | Inserts `child` into `parent` before `before`, or at the end. Moves it if it's already in the tree. |
| `setAttr()` | `null` removes the attribute. |
| `setValue()` | Sets the `value` property, as a framework does on a controlled input; `force` overrides a focused host input. |
| `classList()` | `el.classList`: `add`, `remove`, `toggle` (with `force`) or `contains`; returns whether `el` has the token after. |
| `dataset()` | `el.dataset[key] = value`, or `delete el.dataset[key]` for `null`; returns `el.dataset[key]` after. |
| `byId()` | `document.getElementById(id)`. |
| `contains()` | `a.contains(b)`. |
| `flush()` | The batches produced since the last flush, in order. |
| `idOf()` | The node id the isolate side uses for `h`, for bridges that expose ids. |
| `handleFor()` | The handle an event's `target` or `currentTargets` entry names. |

### `MakeBridgePair`

```ts nocheck
type MakeBridgePair = () => BridgePair;
```

### `NodeIds`

Host-side node-id lookups (design §4.5). Optional until every bridge has them.

```ts nocheck
interface NodeIds {
  idFor(node: Node): string | undefined;
  nodeFor(id: string): Element | undefined;
}
```

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
`<input>` and a `<select>`. `settle` waits for the framework to commit.

```ts nocheck
function driveUsageFixture(dom: WorkerDom, settle: () => Promise<void>): Promise<void>;
```

### `reportUsage`

Runs the fixture, lets the framework settle, and posts the log (or the error).

```ts nocheck
function reportUsage(tracker: UsageTracker, framework: string, run: () => Promise<void>): Promise<void>;
```

### `serveFixture`

Installs the subset as this worker's `document`, posts every batch, and
delivers the page's events. Import it before the framework: React decides
at load time whether it has a DOM. Uncaught errors are posted with their
stack, which a worker `error` event doesn't carry.

```ts nocheck
function serveFixture(): {
  dom: WorkerDom;
  container: Element;
};
```

### `servePoolFixture`

A pooled fixture (ADR 0015, M2d): one subset document installed as this
worker's `document`, with `n` render roots, one per member. Each root's
batches are posted with its `member` index, and the page's events for a
member go to its root. Pair with `mountMembers()` on the page.

```ts nocheck
function servePoolFixture(n: number): Element[];
```

### `trackUsage`

Starts logging. Call before the framework renders; it can't be undone.

```ts nocheck
function trackUsage(): UsageTracker;
```

### `FixtureMessage`

Re-exported from `@isoloop/dom/testing`: see [`FixtureMessage`](#fixturemessage).

### `UsageLog`

Re-exported from `@isoloop/dom/testing`: see [`UsageLog`](#usagelog).

### `UsageTracker`

```ts nocheck
type UsageTracker = {
  report(framework: string): UsageLog;
};
```

| Member | Description |
| --- | --- |
| `report()` | The log so far, sorted. |

<!-- Generated by scripts/docs/api.ts from the published types. Do not edit: run `pnpm docs:api`. -->
