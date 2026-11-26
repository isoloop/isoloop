# @isoloop/host

The main thread: `createKernel`, the kernel it returns, and the types for isolates, pools, the bus and agents.

## `@isoloop/host`

### `createKernel`

Creates the kernel: it starts the bus worker, then starts, watches and
restarts each isolate you spawn.

```ts nocheck
function createKernel(config: KernelConfig): Kernel;
```

| Parameter | Description |
| --- | --- |
| `config` | The workers, the contracts, and how isolates are supervised. |

**Returns:** The kernel.

**Throws:**
- `KernelError` `unsupported_browser` when the browser lacks something Isoloop needs, `invalid_config` for a malformed option, and `not_exposable` when `agents.expose` matches a topic that can't be a tool.

**Example:**

```ts
import { createKernel } from '@isoloop/host';
import workers from 'virtual:isoloop/workers';
import list from './contracts';
import contractsUrl from './contracts?isolate';
import cart from './cart?isolate';

const kernel = createKernel({ contracts: { url: contractsUrl, list }, workers });
kernel.spawn({ id: 'cart', src: cart, surface: document.querySelector('#cart')! });
```

**Guides:** [Getting started](../guide/getting-started.md).

### `BusError`

A rejected bus call (`kernel.publish`, `ctx.bus.publish`, `request`,
`reply`): the broker's error code, and the schema issues for `invalid`.

```ts nocheck
class BusError extends Error {
  readonly code: ErrorCode;
  readonly issues: readonly Issue[] | undefined;
  constructor(error: CallError);
}
```

| Member | Description |
| --- | --- |
| `code` | What went wrong, to branch on: `invalid`, `forbidden`, `timeout`, `bus_unavailable`, … |
| `issues` | For `invalid`: where the value failed its schema, and why. |

**Guides:** [The bus](../guide/bus.md).

### `KernelError`

An error the kernel API throws, with a code to branch on.

```ts nocheck
class KernelError extends Error {
  readonly code: KernelErrorCode;
  constructor(code: KernelErrorCode, message: string);
}
```

| Member | Description |
| --- | --- |
| `code` | What went wrong, to branch on. |

**Guides:** [Getting started](../guide/getting-started.md).

### `AgentsConfig`

**Experimental.**

`KernelConfig.agents`: the topics agents may call, as tools, through the dev
MCP or WebMCP.

```ts nocheck
type AgentsConfig = {
  readonly expose: readonly string[];
  readonly timeoutMs?: number;
};
```

| Member | Description |
| --- | --- |
| `expose` | Grant patterns (`*` matches one or more characters, dots included) naming the topics agents may call, for example `['markets.quote.v1', 'markets.alerts.*']`. Each topic matched needs a `reply`, a `tool`, and schemas that make JSON Schema (Standard JSON Schema; not `unchecked()`), or `createKernel` throws `not_exposable`. A pattern that matches nothing is reported once through the `agents:unmatched` event. |
| `timeoutMs?` | How long transports wait for a tool's reply, in ms. Default 10 000 (10 s). |

**Guides:** [Tools for agents](../guide/agents.md).

### `AgentTool`

**Experimental.**

An exposed tool, as `kernel.tools()` lists it. Everything but `topic` is
plain data a transport can send as is.

```ts nocheck
type AgentTool = {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly consequential: boolean;
  readonly untrustedContent: boolean;
  readonly inputSchema: ToolJsonSchema;
  readonly outputSchema: ToolJsonSchema;
  readonly timeoutMs: number;
  readonly topic: TopicRef<unknown, unknown, unknown, unknown>;
};
```

| Field | Description |
| --- | --- |
| `name` | The topic's name, which is the tool's name (`markets.quote.v1`). |
| `title?` | The tool's title, from the topic's `tool.title`. Absent when the topic gives none. |
| `description` | What the tool does, from the topic's `tool.description`. |
| `readOnly` | WebMCP and MCP `readOnlyHint`. |
| `consequential` | WebMCP `consequentialHint`, MCP `destructiveHint`. |
| `untrustedContent` | WebMCP `untrustedContentHint`: the reply can carry third-party text. |
| `inputSchema` | The topic schema's input, as JSON Schema draft 2020-12. |
| `outputSchema` | The `reply` schema's output, as JSON Schema draft 2020-12. |
| `timeoutMs` | `agents.timeoutMs`, for transports to pass to `kernel.request`. |
| `topic` | The topic, for `kernel.request(tool.topic, input, …)`. |

**Guides:** [Tools for agents](../guide/agents.md).

### `Backoff`

The wait before each restart in the restart window: `initialMs × factorⁿ`,
capped at `maxMs`, where n is the number of restarts already in the window.

```ts nocheck
type Backoff = {
  initialMs: number;
  factor: number;
  maxMs: number;
};
```

| Field | Description |
| --- | --- |
| `initialMs` | Delay before the first restart in a window, in ms. Default 250. |
| `factor` | Growth per restart already in the window. Default 2. |
| `maxMs` | The longest delay, in ms. Default 4 000 (4 s). |

**Guides:** [Supervision and restarts](../guide/supervision.md).

### `CrashReason`

Why an isolate (or the bus) crashed:
- `error`: the isolate reported a fatal error;
- `worker_error`: the worker's `error` or `messageerror` event;
- `ready_timeout`: no `ready` within `heartbeat.readyTimeoutMs` of the spawn;
- `unresponsive`: blocked for `heartbeat.killAfterMs` without a beat, so the worker was terminated;
- `spawn_failed`: `new Worker` threw;
- `render_format_mismatch`: the isolate renders in a format this host doesn't read;
- `bus_failed`: the bus couldn't load its contracts;
- `runtime_too_old`: the isolate was built for a newer Isoloop than this host;
- `isolate_too_old`: the isolate was built for an Isoloop older than this host still runs.

The last four fail at once, without restarts, since a restart can't fix them.

```ts nocheck
type CrashReason = "error" | "worker_error" | "ready_timeout" | "unresponsive" | "spawn_failed" | "render_format_mismatch" | "bus_failed" | "runtime_too_old" | "isolate_too_old";
```

**Guides:** [Supervision and restarts](../guide/supervision.md).

### `FallbackInfo`

What a failed isolate's fallback is given to show.

```ts nocheck
type FallbackInfo = {
  id: string;
  reason: string;
  message: string;
  respawn: () => void;
};
```

| Field | Description |
| --- | --- |
| `id` | The isolate's id. |
| `reason` | Why it failed: the last crash's `CrashReason`. |
| `message` | The last crash's message. |
| `respawn` | Respawns the isolate, resetting its restart window. |

**Guides:** [Supervision and restarts](../guide/supervision.md).

### `FallbackRender`

Renders a failed isolate's fallback into `slot`, an element in the surface's
shadow root that the compositor empties when the fallback is hidden.

```ts nocheck
type FallbackRender = (slot: HTMLElement, info: FallbackInfo) => void;
```

**Guides:** [Supervision and restarts](../guide/supervision.md).

### `HostComponent`

A host element an isolate may render by name, e.g. `iso-button` → `ds-button`.

```ts nocheck
type HostComponent = {
  tag: string;
  attributes?: readonly string[];
};
```

| Field | Description |
| --- | --- |
| `tag` | Custom element name defined on the host page. |
| `attributes?` | Attribute names allowed on it beyond the global ones. |

**Guides:** [Getting started](../guide/getting-started.md).

### `InspectBeat`

**Experimental.**

One isolate's latest beat in a `beats` message.

```ts nocheck
type InspectBeat = {
  id: string;
  pool?: string;
  lagMs: number;
  busyMs?: number;
  at: number;
};
```

| Member | Description |
| --- | --- |
| `id` | The isolate's id. |
| `pool?` | Its pool, when it's a pool member. |
| `lagMs` | How late its worker's beat fired, past the heartbeat interval, in ms. A block shows in it only on the first beat after the block ends; while it lasts, no beat arrives. |
| `busyMs?` | Milliseconds its worker spent running its code during the beat's interval. |
| `at` | `performance.now()` on the host when it arrived. |

**Guides:** [The inspection feed](../guide/inspection.md).

### `InspectBus`

**Experimental.**

The bus as the feed sees it. `state` is the bus supervisor's state
(`running`, `restarting`, `failed`, …), or `none` without contracts.
`restarts` counts bus restarts since the kernel started.

```ts nocheck
type InspectBus = {
  state: string;
  restarts: number;
  metrics?: BusMetrics;
};
```

| Field | Description |
| --- | --- |
| `state` | The bus supervisor's state, or `none`. |
| `restarts` | Bus restarts since the kernel started. |
| `metrics?` | The last `bus:metrics`, once one has arrived. |

**Guides:** [The inspection feed](../guide/inspection.md).

### `InspectEvent`

**Experimental.**

One kernel event, at once or from the ring buffer. `event` is a `KernelEvents` name (`isolate:crash`, `bus:restart`, …)
and `data` its payload. Beats and bus metrics come as their own messages.

```ts nocheck
type InspectEvent = {
  at: number;
  event: string;
  data: Record<string, unknown>;
};
```

| Member | Description |
| --- | --- |
| `at` | `performance.now()` on the host when it happened. |
| `event` | The event's name, a `KernelEvents` key. |
| `data` | The event's data, as `kernel.on` gives it. |

**Guides:** [The inspection feed](../guide/inspection.md).

### `InspectIsolate`

**Experimental.**

One isolate in the feed, as `kernel.isolates()` has it.
`state` and `reason` are the kernel's `IsolateState` and `CrashReason`,
typed as strings here so a reader built against an older list still reads
a newer kernel's values.

```ts nocheck
type InspectIsolate = {
  id: string;
  state: string;
  pool?: string;
  lastBeatAt: number;
  lagMs: number;
  restarts: number;
  reason?: string;
  error?: string;
  surface?: {
    queued: number;
    applied: number;
    rejected: number;
    dropped: number;
    lastFrameMs: number;
  };
  dropped: number;
  holds?: {
    ageMs: number;
    stack?: string;
  }[];
  busyMs?: number;
  memory?: InspectMemory;
};
```

| Member | Description |
| --- | --- |
| `id` | The isolate's id. |
| `state` | Its `IsolateState`. |
| `pool?` | The pool it runs in; absent for a worker of its own. |
| `lastBeatAt` | `performance.now()` on the host when its last beat arrived. |
| `lagMs` | How late its worker's last beat fired, past the heartbeat interval, in ms. It keeps the last beat's value while the worker is blocked and sends no beat. To see a block in progress, read `state` and the time since `lastBeatAt`. |
| `restarts` | Restarts after a crash since it was spawned. |
| `reason?` | The last crash's `CrashReason`, while restarting or failed. |
| `error?` | The last crash's message, while restarting or failed. |
| `surface?` | Compositor figures for a visual isolate (`SurfaceStats`). |
| `dropped` | Messages from its worker dropped because their version or type was unknown. |
| `holds?` | Open `ctx.keepAwake()` holds, from the last beat. |
| `busyMs?` | Milliseconds its worker spent running its code during the last beat's interval. |
| `memory?` | Its worker's memory, from the host's last measurement. Absent when the page isn't cross-origin isolated, in engines without `performance.measureUserAgentSpecificMemory()` (Firefox, Safari), and before the first measurement. |

**Guides:** [The inspection feed](../guide/inspection.md).

### `InspectMessage`

**Experimental.**

The feed's messages, each `{ v, t, p }`: `t` names it and `p` carries it.
- `snapshot`, on request: an isolate's `ctx.inspector.snapshot()` gets it
over its `inspect` port, as the reply to its `snapshot` call;
- `event`, a kernel event as it happens;
- `beats`, each isolate's latest beat, coalesced to about one a second;
- `metrics`, the latest `bus:metrics`, at most one a second;
- `memory`, each isolate's memory after a measurement, at most one every
5 s, and only where the page is cross-origin isolated.

```ts nocheck
type InspectMessage = Envelope<"snapshot", InspectSnapshot> | Envelope<"event", InspectEvent> | Envelope<"beats", {
  at: number;
  beats: InspectBeat[];
}> | Envelope<"metrics", BusMetrics> | Envelope<"memory", {
  at: number;
  isolates: {
    id: string;
    memory: InspectMemory;
  }[];
}>;
```

**Guides:** [The inspection feed](../guide/inspection.md).

### `Inspector`

**Experimental.**

A reader of the inspection feed, from `kernel.inspect()`. Every message is
plain, structured-cloneable data, the same as an isolate with the `inspect`
grant gets over its port.

```ts nocheck
interface Inspector {
  snapshot(): InspectSnapshot;
  on(fn: (m: InspectMessage) => void): () => void;
  tap(o: {
    topics: string[];
    maxPerSec?: number;
    onSkipped?: (count: number) => void;
  }, fn: (r: InspectRecord) => void): () => void;
  records(topic: string, o: {
    last: number;
  }): Promise<InspectRecord[]>;
  restart(id: string): Promise<void>;
  kill(id: string): Promise<void>;
  block(id: string, ms: number): Promise<void>;
  close(): void;
}
```

| Member | Description |
| --- | --- |
| `snapshot()` | The feed's state now. |
| `on()` | Feed messages from now on: events at once, beats and bus metrics about once a second. |
| `tap()` | **Experimental.** Copies records appended to matching topics to `fn` as they arrive, each value cut to a 2 KB preview. A tap isn't a consumer: it isn't in the bus figures. It's opened again after a bus restart; records appended while no bus runs aren't seen. |
| `records()` | The last records of a topic still retained, oldest first, as previews. |
| `restart()` | Restarts an isolate, as `kernel.restart(id)` does. |
| `kill()` | Ends an isolate's worker as a crash (`worker_error`), so the supervisor restarts it like any other. For a pooled isolate that ends the pool's worker: every member crashes and restarts, and the feed shows each one. |
| `block()` | Busy-loops an isolate's worker, so you can watch containment work. For a pooled isolate it blocks the whole worker. |
| `close()` | Stops every listener and tap of this inspector, and makes its controls reject. Its `snapshot()` still works. |

**Guides:** [The inspection feed](../guide/inspection.md).

### `InspectPool`

**Experimental.**

One pool in the feed, as `kernel.pools()` has it.

```ts nocheck
type InspectPool = {
  name: string;
  members: string[];
  running: boolean;
  grants: Grants;
  sharesDocument: boolean;
  warning?: string;
};
```

| Field | Description |
| --- | --- |
| `name` | The pool's name. |
| `members` | Isolates naming this pool, not stopped, in spawn order. |
| `running` | True while the pool's worker runs. |
| `grants` | The union of its members' grants: what the pool can do in effect. |
| `sharesDocument` | True when a member has a surface: the visual members share one document. |
| `warning?` | When `sharesDocument`: what that means for the members, in a sentence for people. |

**Guides:** [The inspection feed](../guide/inspection.md).

### `InspectRecord`

**Experimental.**

One record from a tap or a read: its value cut to a 2 KB preview, with its
full size.

```ts nocheck
type InspectRecord = RecordPreview;
```

**Guides:** [The inspection feed](../guide/inspection.md).

### `InspectSnapshot`

**Experimental.**

What a reader gets first: the feed's state at one moment.

```ts nocheck
type InspectSnapshot = {
  at: number;
  isolates: InspectIsolate[];
  pools: InspectPool[];
  bus: InspectBus;
  events: InspectEvent[];
};
```

| Member | Description |
| --- | --- |
| `at` | `performance.now()` on the host when it was taken. |
| `isolates` | Every isolate not stopped. |
| `pools` | The named pools that have members. |
| `bus` | The bus. |
| `events` | The ring buffer: the last 200 events since the kernel started, oldest first. |

**Guides:** [The inspection feed](../guide/inspection.md).

### `IsolateHandle`

A spawned isolate, from `kernel.spawn`: its id, and its own controls.

```ts nocheck
interface IsolateHandle {
  readonly id: string;
  snapshot(): IsolateSnapshot;
  stop(): Promise<void>;
  restart(): Promise<void>;
}
```

| Member | Description |
| --- | --- |
| `id` | The isolate's id, from its manifest. |
| `snapshot()` | The isolate as the kernel sees it now. |
| `stop()` | Stops the isolate, as `kernel.stop(id)` does. |
| `restart()` | Restarts the isolate, as `kernel.restart(id)` does. |

### `IsolateManifest`

One isolate to spawn: `kernel.spawn` takes it.

```ts nocheck
type IsolateManifest = {
  id: string;
  src: string;
  surface?: Element;
  config?: unknown;
  grants?: Grants;
  fallback?: FallbackRender;
  pool?: string;
  suspend?: "never" | "when-idle" | {
    whenIdle: {
      afterMs: number;
    };
  };
  bus?: {
    onReset?: "reset" | "restart";
  };
};
```

| Member | Description |
| --- | --- |
| `id` | The isolate's id, unique among the kernel's isolates. |
| `src` | The isolate module's URL, resolved against the document. |
| `surface?` | Where the isolate renders. Without one, the isolate is headless. Default: none. |
| `config?` | Any value, passed to the isolate as `ctx.config`. Default: none. |
| `grants?` | The topics it may publish to and subscribe to, and its other grants. Default: none. |
| `fallback?` | Renders the fallback shown once the isolate has `failed`. Default: a message and a Retry button. |
| `pool?` | A named worker pool: the isolate shares one worker with every other isolate naming the same pool, headless or visual. Pool members share an event loop, globals and fate: a hang or crash restarts the pool. Visual members also share one document, so they can read each other's DOM and input: pool only trusted isolates, and keep widgets that handle secrets on their own worker. Default: a worker of its own. |
| `suspend?` | Opt-in suspension. Default `'never'`. `'when-idle'` waits 60 s. Idle means: no visible surface (headless counts as never visible), nothing delivered for `afterMs`, no `ctx.keepAwake()` hold, and no host call or publish waiting for an answer. |
| `bus?` | After a bus restart, memory topics start empty and each subscription gets `onReset`. `onReset: 'restart'` restarts the isolate instead. Default `'reset'`. |

### `IsolateSnapshot`

One isolate as the kernel sees it now: `kernel.isolates()` and `handle.snapshot()`.

```ts nocheck
type IsolateSnapshot = {
  id: string;
  state: IsolateState;
  pool?: string;
  lastBeatAt: number;
  lagMs: number;
  restarts: number;
  reason?: CrashReason;
  error?: string;
  surface?: SurfaceStats;
  dropped: number;
  holds?: {
    ageMs: number;
    stack?: string;
  }[];
  busyMs?: number;
};
```

| Member | Description |
| --- | --- |
| `id` | The isolate's id. |
| `state` | Where it is in its life. |
| `pool?` | The pool it runs in; absent for a worker of its own. |
| `lastBeatAt` | `performance.now()` of the last beat. |
| `lagMs` | How late its worker's last beat fired, past the heartbeat interval, in ms. A blocked worker sends no beat, so this keeps the last beat's value (often 0) while a block lasts, and the late beat shows it only once the block ends. To see a block in progress, read `state` and the time since `lastBeatAt`. |
| `restarts` | Restarts after a crash since it was spawned. A manual restart doesn't count. |
| `reason?` | The last crash, while restarting or failed. |
| `error?` | The last crash's message, while restarting or failed. |
| `surface?` | Its surface's batches, for an isolate with a surface. |
| `dropped` | Messages dropped because their `v` or `t` was unknown. |
| `holds?` | Open `ctx.keepAwake()` holds, from the last beat, with their age and where they were taken. |
| `busyMs?` | Milliseconds its worker spent running its code during the last beat's interval. Absent before its first beat, and from runtimes that don't report it. |

**Guides:** [Supervision and restarts](../guide/supervision.md).

### `IsolateState`

Where an isolate is in its life:
- `loading`: its worker is starting, and it hasn't sent `ready`;
- `running`: ready and beating;
- `blocked`: no beat for `heartbeat.blockedAfterMs`; its surface shows a busy overlay;
- `stopped`: stopped by `kernel.stop` or its handle;
- `crashed`: passed through on a crash, on the way to `restarting` or `failed`;
- `restarting`: waiting out the backoff before a new worker;
- `failed`: past the restart limit, or a crash a restart can't fix; it stays down and shows its fallback;
- `suspended`: opt-in, idle, so its worker was shut down; it wakes on visibility, a record or `kernel.resume`.

```ts nocheck
type IsolateState = "loading" | "running" | "blocked" | "stopped" | "crashed" | "restarting" | "failed" | "suspended";
```

**Guides:** [Supervision and restarts](../guide/supervision.md).

### `Kernel`

The kernel `createKernel` returns: it spawns and supervises isolates, and talks to the bus from the host.

```ts nocheck
interface Kernel {
  spawn(manifest: IsolateManifest): IsolateHandle;
  stop(id: string): Promise<void>;
  restart(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  publish<In>(topic: TopicRef<In, any, any, any>, value: In, opts?: {
    key?: string;
  }): Promise<void>;
  dropTopic(name: string, opts?: {
    force?: boolean;
  }): Promise<void>;
  request<In, ROut>(topic: TopicRef<In, any, any, ROut>, value: In, opts?: KernelRequestOptions): Promise<ROut>;
  tools(): readonly AgentTool[];
  subscribe<Out>(topic: TopicRef<any, Out, any, any>, fn: (r: TypedRecord<Out>) => void, opts?: {
    from?: StartPosition;
  }): () => void;
  on<E extends KernelEvent>(event: E, fn: (e: KernelEvents[E]) => void): () => void;
  isolates(): IsolateSnapshot[];
  pools(): PoolSnapshot[];
  inspect(): Inspector;
  syncRoute(): void;
  destroy(): Promise<void>;
}
```

| Member | Description |
| --- | --- |
| `spawn()` | Starts an isolate in a worker of its own, or in its `pool`'s worker. |
| `stop()` | Stops an isolate: its `onShutdown` handlers get the stop grace (1 s), then its worker goes. The id is free at once: a `spawn` with it before then starts when the old worker is gone. |
| `restart()` | Restarts an isolate now, whatever its state, `failed` included, and clears its restart window. |
| `resume()` | Wakes a suspended isolate; a no-op otherwise. |
| `publish()` | Publishes a record from the host: `kernel.publish(count, 1)`, or `kernel.publish(prices, 102, { key: 'AAPL' })` with a key. |
| `dropTopic()` | Deletes a persistent topic the contracts no longer list (see `bus:orphaned_topics`). |
| `request()` | **Experimental.** Requests from the host, the mirror of `bus.request`: appends a request record with `req: { from: 'host', id, via }` and resolves with the first valid reply. Works on any requestable topic, exposed to agents or not. An isolate that restarts within the timeout still gets the request and can answer it. |
| `tools()` | **Experimental.** The tools exposed through `agents.expose`, with their JSON Schemas, made once at `createKernel`. Transports list these and call them with `kernel.request`. |
| `subscribe()` | Subscribes from the host. Records cross the main thread only here. |
| `on()` | Listens to one of the kernel's events. |
| `isolates()` | Every isolate not stopped, as the kernel sees it now. |
| `pools()` | The named pools that have members. |
| `inspect()` | **Experimental.** A reader of the inspection feed: a snapshot of isolates, pools, the bus and the last 200 events, then events as they happen, with beats and bus metrics coalesced to about one a second. Costs nothing until a reader listens, apart from the ring buffer of recent events the kernel always keeps. |
| `syncRoute()` | Tells the kernel the host's router changed the URL: it republishes `isoloop.route.v1` if `href` or `state` differ. Wire it once, for example `router.subscribe(() => kernel.syncRoute())`. A no-op with routing off. |
| `destroy()` | Stops every isolate and the bus, and removes the kernel's listeners. |

### `KernelConfig`

What `createKernel` takes: the workers, the topics, and how isolates are supervised.

```ts nocheck
type KernelConfig = {
  contracts?: {
    url: string;
    list: ContractsList;
  };
  workers: {
    isolateBootstrap: string;
    bus?: string;
    budget?: number;
  };
  supervisor?: {
    strategy?: "one-for-one" | "never";
    maxRestarts?: number;
    withinMs?: number;
    healthyAfterMs?: number;
    backoff?: Partial<Backoff>;
  };
  heartbeat?: {
    everyMs?: number;
    blockedAfterMs?: number;
    killAfterMs?: number;
    readyTimeoutMs?: number;
  };
  styles?: readonly CSSStyleSheet[];
  compositor?: {
    frameBudgetMs: number;
  };
  components?: Readonly<Record<string, HostComponent>>;
  routing?: boolean;
  basePath?: string;
  onNavigate?: OnNavigate;
  suspend?: {
    maxConcurrentWakes?: number;
  };
  dev?: boolean;
  agents?: AgentsConfig;
  bus?: {
    commitIntervalMs?: number;
  };
};
```

| Member | Description |
| --- | --- |
| `contracts?` | The topics: `url` is the ES module the bus worker imports, `list` its default export, imported by the host. Needs `workers.bus`. Without both there is no bus worker: isolates get an unconnected port, and `kernel.publish` rejects with `bus_unavailable`. Default: none. |
| `workers` | The worker scripts' URLs, and the worker budget. |
| `supervisor?` | How crashed isolates and the bus worker are restarted. Defaults: one-for-one, 3 restarts in 60 s or 3 in a row after runs shorter than 60 s, backoff 250 ms × 2ⁿ capped at 4 s. |
| `heartbeat?` | How the host tells a busy or hung isolate from a working one. Defaults: 100 / 400 / 10 000 ms, ready timeout 10 000 ms. |
| `styles?` | Stylesheets adopted into every surface's shadow root. Default: none. |
| `compositor?` | `frameBudgetMs`: DOM work per frame, in ms. Default 8. The first batch of a frame always applies, so a frame does at most the budget plus one batch. |
| `components?` | Host elements isolates may render by name, for example `{ 'iso-button': { tag: 'ds-button', attributes: ['variant'] } }`. Malformed entries make `createKernel` throw `invalid_config`. Default: none. |
| `routing?` | Whether the kernel takes part in routing. Default true. With false the kernel adds no listeners, never publishes `isoloop.route.v1`, leaves link clicks alone, and `navigate` rejects with `routing_disabled`. |
| `basePath?` | The app's base path. Must match the host router's `basename`; `/x` hrefs resolve against it. Default `/`. |
| `onNavigate?` | Decides a navigation from an isolate or a link click. Return `true` once accepted (not when finished), `false` to refuse. Default: `history.pushState` / `replaceState`. |
| `suspend?` | Suspension. `maxConcurrentWakes`: at most this many suspended isolates start at once. Default 4. |
| `dev?` | Development checks: the bus checks every schema output with `structuredClone`, and the console warns about a `keepAwake()` hold older than 10 minutes and about tags put into `document.head`. Default false. |
| `agents?` | **Experimental.** Tools for agents: which requestable topics agents may call through the dev MCP or WebMCP. Without it nothing is exposed. Default: none. |
| `bus?` | The bus's own settings. |

**Guides:** [Getting started](../guide/getting-started.md).

### `KernelErrorCode`

The codes a `KernelError` carries:
- `unsupported_browser`: the browser lacks a feature Isoloop needs; the message names them;
- `invalid_manifest`: a manifest without an `id` or `src`, with an empty `pool`, an id the kernel reserves, or an unknown `suspend`;
- `invalid_config`: a `KernelConfig` value out of range or malformed, or a pooled isolate holding `inspect`;
- `bus_failed`: the bus couldn't load its contracts, so nothing can start;
- `reserved_pool`: a `pool` name starting `balancer-`, which belongs to `@isoloop/balancer`;
- `balancer_exists`: a second balancer on a kernel that already has one;
- `not_exposable`: an `agents.expose` pattern matches a topic that can't be a tool (no `reply`, no `tool`, or a schema without Standard JSON Schema); the message names the topic. `@experimental`.

```ts nocheck
type KernelErrorCode = "unsupported_browser" | "invalid_manifest" | "invalid_config" | "bus_failed" | "reserved_pool" | "balancer_exists" | "not_exposable";
```

**Guides:** [Getting started](../guide/getting-started.md).

### `KernelEvent`

A kernel event's name.

```ts nocheck
type KernelEvent = keyof KernelEvents;
```

**Guides:** [Supervision and restarts](../guide/supervision.md).

### `KernelEvents`

The kernel's events and what each carries; `kernel.on(event, fn)` listens to one.

```ts nocheck
type KernelEvents = {
  "isolate:state": {
    id: string;
    state: IsolateState;
    prev: IsolateState;
  };
  "isolate:ready": {
    id: string;
  };
  "isolate:crash": {
    id: string;
    reason: CrashReason;
    message: string;
    pool?: string;
  };
  "isolate:failed": {
    id: string;
    reason: CrashReason;
    message: string;
    pool?: string;
  };
  "isolate:error": {
    id: string;
    message: string;
  };
  "isolate:beat": {
    id: string;
    pool?: string;
    lagMs: number;
    busyMs?: number;
    at: number;
  };
  "workers:budget": {
    live: number;
    budget: number;
  };
  "agents:unmatched": {
    patterns: string[];
  };
  "bus:ready": {
    first: boolean;
  };
  "bus:crash": {
    reason: CrashReason;
    message: string;
  };
  "bus:recovered": {
    quarantined: string[];
  };
  "bus:durability_degraded": {
    reason: DurabilityDegraded;
  };
  "bus:quota": {
    usage: number;
    quota: number;
  };
  "bus:seed_rejected": {
    topic: string;
    from: string;
    offset: number;
    code: ErrorCode;
    issues: Issue[];
  };
  "bus:seeded": {
    topic: string;
    copied: number;
    rejected: number;
  };
  "bus:orphaned_topics": {
    names: string[];
    bytes: number;
  };
  "bus:restart": {
    restarts: number;
  };
  "bus:failed": {
    code?: ErrorCode;
    reason?: CrashReason;
    message: string;
  };
  "bus:metrics": BusMetrics;
  "route:state_dropped": {
    bytes: number;
  };
  "route:navigate_error": {
    from: string;
    href: string;
    error: string;
  };
};
```

| Member | Description |
| --- | --- |
| `isolate:state` | An isolate moved from `prev` to `state`. |
| `isolate:ready` | An isolate is ready: its module loaded and it's about to run `start`. |
| `isolate:crash` | An isolate crashed. `pool`: its pool, when it's a pool member; a pool's members crash together. |
| `isolate:failed` | Past the restart limit, or strategy `never`: the isolate stays down. |
| `isolate:error` | An isolate reported an error that wasn't fatal (`ctx.reportError(e, { fatal: false })`); it keeps running. |
| `isolate:beat` | One isolate's heartbeat, as it arrives: its worker's `lagMs` (how late this beat fired, so a block shows in it only once the block ends and the beat arrives) and, from runtimes that report it, its own `busyMs` for the interval the beat covers. A pool's beat gives one event per member. `at` is the host's `performance.now()` on receipt. Emitted only while someone listens, so apps without a listener pay nothing. `@isoloop/balancer` reads every beat through it rather than polling `isolates()`, which keeps only the latest. |
| `workers:budget` | More live workers than `workers.budget`. Emitted once per kernel. |
| `agents:unmatched` | **Experimental.** `agents.expose` patterns that match no topic in the contracts. Emitted once, in the microtask after `createKernel`, so a listener added right after it hears it. |
| `bus:ready` | The bus worker loaded its contracts. `first` is false after a restart. |
| `bus:crash` | The bus worker crashed. The kernel restarts it, within the supervisor's restart limit. |
| `bus:recovered` | The bus crashed twice while loading, so it started in safe mode: each persistent topic's newest segment was set aside, renamed and kept. `quarantined` lists them as `<topic>/<file>`. |
| `bus:durability_degraded` | Persistent topics run in memory on this bus, so they won't survive a reload. `another_tab`: another tab's bus holds the origin's files; `no_sync_access`: OPFS sync access handles are missing; `open_failed`: the files couldn't be opened. |
| `bus:quota` | The origin's storage is 80 % used, once per crossing. At 100 % persistent publishes reject with `quota_exceeded`; memory topics carry on. |
| `bus:seed_rejected` | A source record a seed skipped: `map` threw or returned a promise (`seed_async`), or the topic's schema rejected the result. It stays in `from`. At most 10 a second per topic; the rest are counted in `bus:seeded`. |
| `bus:seeded` | A seed ended and the topic opened: `copied` records, `rejected` skipped. |
| `bus:orphaned_topics` | Persistent topics on disk that the contracts no longer list, and their total size. They are kept, not opened; nothing is deleted until `kernel.dropTopic`. |
| `bus:restart` | A new bus worker is starting; running isolates get a new bus port. `restarts` counts them. |
| `bus:failed` | The bus is down for good. With `code`, its contracts couldn't be used and no isolate runs; with `reason`, it crashed past the restart limit and isolates keep running with every publish rejected. |
| `bus:metrics` | The bus's figures, sampled every second: topics, subscriptions and rejected publishes. |
| `route:state_dropped` | `history.state` was too large for the route topic; it was published as `null`. |
| `route:navigate_error` | `onNavigate` threw; the navigate call rejected with `navigate_failed`. |

**Guides:** [Supervision and restarts](../guide/supervision.md).

### `KernelRequestOptions`

**Experimental.**

`kernel.request`'s options.

```ts nocheck
type KernelRequestOptions = {
  key?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  via?: RequestVia;
};
```

| Field | Description |
| --- | --- |
| `key?` | The request record's key. Default: none. |
| `timeoutMs?` | How long to wait for a reply, in ms. Default 30 000 (30 s), the bus's. Transports pass `agents.timeoutMs` (`AgentTool.timeoutMs`). |
| `signal?` | Aborting rejects the call with `BusError('aborted')`. Default: none. |
| `via?` | The transport making the call, set on the record as `req.via`. A label for logging and policy between cooperating code on one page; never authorize anything by it. Default: none. |

**Guides:** [Tools for agents](../guide/agents.md).

### `NavigateRequest`

A navigation an isolate asked for, or a link click, as `onNavigate` gets it.

```ts nocheck
type NavigateRequest = {
  href: string;
  replace: boolean;
  state?: unknown;
  from: string;
};
```

| Field | Description |
| --- | --- |
| `href` | Where to go: an absolute, same-origin URL. |
| `replace` | True to replace the current history entry rather than push one. |
| `state?` | The `history.state` to set, when the isolate gave one. |
| `from` | The isolate that asked, or whose link was clicked. |

**Guides:** [Writing isolates](../guide/isolates.md).

### `OnNavigate`

`KernelConfig.onNavigate`: decides a navigation. Returns, or resolves with,
`true` once accepted (not when finished) and `false` to refuse.

```ts nocheck
type OnNavigate = (req: NavigateRequest) => boolean | Promise<boolean>;
```

**Guides:** [Writing isolates](../guide/isolates.md).

### `PoolSnapshot`

A named pool now: `kernel.pools()`.

```ts nocheck
type PoolSnapshot = {
  name: string;
  members: string[];
  running: boolean;
  grants: Grants;
  sharesDocument: boolean;
  warning?: string;
};
```

| Field | Description |
| --- | --- |
| `name` | The pool's name. |
| `members` | Isolates naming this pool, not stopped, in spawn order. |
| `running` | True while the pool's worker runs. |
| `grants` | What the pool can do in effect: the union of its members' grants. Members share a worker, so one member can reach another's bus port. |
| `sharesDocument` | True when a member has a surface: the pool's visual members render into one shared document, so `warning` is set. |
| `warning?` | When `sharesDocument`: what that means for the members, in a sentence for people. |

**Guides:** [Worker pools](../guide/pools.md).

### `RequestVia`

**Experimental.**

The agent transports that call through `kernel.request`: `mcp` (the dev
MCP) and `webmcp` (WebMCP). Nothing in Isoloop sets `builder`.

Self-declared by the caller: a label for logging and policy between
cooperating code on one page. Never authorize anything by it.

```ts nocheck
type RequestVia = "mcp" | "webmcp" | "builder";
```

**Guides:** [Tools for agents](../guide/agents.md).

### `SurfaceStats`

One isolate's surface, as the compositor sees it: `IsolateSnapshot.surface`.

```ts nocheck
type SurfaceStats = {
  queued: number;
  applied: number;
  rejected: number;
  dropped: number;
  lastFrameMs: number;
};
```

| Field | Description |
| --- | --- |
| `queued` | Batches waiting for a frame. |
| `applied` | Batches applied since the surface was made. |
| `rejected` | Batches the bridge refused as malformed. |
| `dropped` | Batches dropped unapplied by a restart. |
| `lastFrameMs` | Milliseconds spent applying this isolate's batches in the last frame it had work. |

### `ToolJsonSchema`

A JSON Schema document, draft 2020-12.

```ts nocheck
type ToolJsonSchema = {
  readonly [key: string]: unknown;
};
```

**Guides:** [Tools for agents](../guide/agents.md).

## `@isoloop/host/dev-mcp`

### `connectDevMCP`

**Experimental.**

Connects the page to the dev MCP (`isoloop mcp`), so an agent can list and
call the tools the kernel exposes (`agents.expose`). Each call is a
`kernel.request` with `via: 'mcp'` and the tool's `timeoutMs`; an agent's
cancellation aborts it. Given a kernel with `inspect()`, it also answers the
dev MCP's own `isoloop_*` tools: reads from the inspection feed, and the
CLI's `--allow-write` writes (restart, kill, block, publish, request). The
CLI enforces `--allow-write`; the page runs what the paired CLI sends, since
only a CLI holding the token on 127.0.0.1 can send it.

```ts nocheck
function connectDevMCP(kernel: Pick<Kernel, "tools" | "request"> & Partial<Pick<Kernel, "inspect" | "publish">>, options: DevMcpOptions): () => void;
```

| Parameter | Description |
| --- | --- |
| `kernel` | The page's kernel. |
| `options` | The CLI's URL, the token, and the page's title. |

**Returns:** A function that disconnects and aborts the calls in flight.

**Example:**

```ts
import { connectDevMCP } from '@isoloop/host/dev-mcp';

if (import.meta.env.DEV) connectDevMCP(kernel, { token: import.meta.env.VITE_ISOLOOP_MCP_TOKEN });
```

**Guides:** [Tools for agents](../guide/agents.md).

### `DevMcpOptions`

**Experimental.**

`connectDevMCP`'s options.

```ts nocheck
type DevMcpOptions = {
  readonly url?: string;
  readonly token: string;
  readonly title?: string;
};
```

| Field | Description |
| --- | --- |
| `url?` | The CLI's WebSocket. Default `ws://127.0.0.1:4317`. |
| `token` | The token `isoloop mcp` printed, or its fixed `ISOLOOP_MCP_TOKEN`, which the page sees only under a `VITE_` name (`VITE_ISOLOOP_MCP_TOKEN`). |
| `title?` | What `isoloop_pages` shows as the page's title. Default `document.title`. |

**Guides:** [Tools for agents](../guide/agents.md).

<!-- Generated by scripts/docs/api.ts from the published types. Do not edit: run `pnpm docs:api`. -->
