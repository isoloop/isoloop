# @isoloop/host

The main thread: `createKernel`, the kernel it returns, and the types for isolates, pools, the bus and agents.

## `@isoloop/host`

### `createKernel`

```ts nocheck
function createKernel(config: KernelConfig): Kernel;
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

**Guides:** [The bus](../guide/bus.md).

### `KernelError`

An error the kernel API throws, with a code to branch on.

```ts nocheck
class KernelError extends Error {
  readonly code: KernelErrorCode;
  constructor(code: KernelErrorCode, message: string);
}
```

**Guides:** [Getting started](../guide/getting-started.md).

### `AgentsConfig`

**Experimental.**

`KernelConfig.agents` (ADR 0018, decision 2): the topics agents may call.

```ts nocheck
type AgentsConfig = {
  readonly expose: readonly string[];
  readonly timeoutMs?: number;
};
```

| Member | Description |
| --- | --- |
| `expose` | Grant patterns (`*` matches one or more characters, dots included) naming the topics agents may call, for example `['markets.quote.v1', 'markets.alerts.*']`. Each topic matched needs a `reply`, a `tool`, and schemas that make JSON Schema (Standard JSON Schema; not `unchecked()`), or `createKernel` throws `not_exposable`. A pattern that matches nothing is reported once through the `agents:unmatched` event. |
| `timeoutMs?` | How long transports wait for a tool's reply, in ms. Default 10 s (ADR 0018, decision 5). |

**Guides:** [Tools for agents](../guide/agents.md).

### `AgentTool`

**Experimental.**

An exposed tool, as `kernel.tools()` lists it (ADR 0018, decision 2).
Everything but `topic` is plain data a transport can send as is.

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
| `readOnly` | WebMCP and MCP `readOnlyHint`. |
| `consequential` | WebMCP `consequentialHint`, MCP `destructiveHint`. |
| `untrustedContent` | WebMCP `untrustedContentHint`: the reply can carry third-party text. |
| `inputSchema` | The topic schema's input, as JSON Schema draft 2020-12. |
| `outputSchema` | The `reply` schema's output, as JSON Schema draft 2020-12. |
| `timeoutMs` | `agents.timeoutMs`, for transports to pass to `kernel.request`. |
| `topic` | The topic, for `kernel.request(tool.topic, input, …)`. |

**Guides:** [Tools for agents](../guide/agents.md).

### `Backoff`

```ts nocheck
type Backoff = {
  initialMs: number;
  factor: number;
  maxMs: number;
};
```

| Field | Description |
| --- | --- |
| `initialMs` | Delay before the first restart in a window. Default 250 ms. |
| `factor` | Growth per restart already in the window. Default 2. |
| `maxMs` | Cap. Default 4 s. |

**Guides:** [Supervision and restarts](../guide/supervision.md).

### `CrashReason`

```ts nocheck
type CrashReason = "error" | "worker_error" | "ready_timeout" | "unresponsive" | "spawn_failed" | "render_format_mismatch" | "bus_failed" | "runtime_too_old" | "isolate_too_old";
```

**Guides:** [Supervision and restarts](../guide/supervision.md).

### `FallbackInfo`

What a failed isolate's fallback shows (design §4.3).

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
| `metrics?` | The last `bus:metrics`, once one has arrived. |

**Guides:** [The inspection feed](../guide/inspection.md).

### `InspectEvent`

**Experimental.**

One kernel event, at once or from the ring buffer (ADR 0020, decisions 2
and 5). `event` is a `KernelEvents` name (`isolate:crash`, `bus:restart`, …)
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
| `lastBeatAt` | `performance.now()` on the host when its last beat arrived. |
| `surface?` | Compositor figures for a visual isolate (`SurfaceStats`). |
| `memory?` | Its worker's memory, from the host's last measurement (ADR 0020, decision 4). Absent when the page isn't cross-origin isolated, in engines without `performance.measureUserAgentSpecificMemory()` (Firefox, Safari), and before the first measurement. |

**Guides:** [The inspection feed](../guide/inspection.md).

### `InspectMessage`

**Experimental.**

The feed's messages, in the usual envelope (ADR 0020, decision 7):
- `snapshot`, on request: an isolate's `ctx.inspector.snapshot()` gets it
over its `inspect` port, as the reply to its `snapshot` call;
- `event`, a kernel event as it happens;
- `beats`, each isolate's latest beat, coalesced to about one a second;
- `metrics`, the latest `bus:metrics`, at most one a second;
- `memory`, each isolate's memory after a measurement, at most one every
5 s, and only where the page is cross-origin isolated (decision 4).

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

A reader of the inspection feed (ADR 0020, decision 1), from
`kernel.inspect()`. Every message is plain, structured-cloneable data, the
same as an isolate with the `inspect` grant gets over its port.

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
| `snapshot()` | Isolates, pools, the bus, and the last 200 events. |
| `on()` | Feed messages from now on: events at once, beats and bus metrics about once a second. Returns the function that stops them. |
| `tap()` | **Experimental.** Copies records appended to matching topics to `fn` as they arrive, at most `maxPerSec` a second (default 50), each value cut to a 2 KB preview. A tap isn't a consumer: it isn't in the bus figures. It's opened again after a bus restart; records appended while no bus runs aren't seen. Returns the function that ends it. Throws `bus_unavailable` without contracts. `onSkipped` gets each count of records the bus left out over `maxPerSec`, at most once a second (ADR 0020, decision 6, amended 2026-11-19). |
| `records()` | The last `last` records of `topic` still retained (at most 100), oldest first, as previews. Rejects with a `BusError`. |
| `restart()` | Restarts an isolate: calls `kernel.restart(id)`. Like `kill` and `block`, it rejects for an unknown id, and after `close()`. |
| `kill()` | Ends an isolate's worker as a crash (`worker_error`), so the supervisor restarts it like any other. For a pooled isolate that ends the pool's worker: every member crashes and restarts, and the feed shows each one. Resolves once the kill is sent, not when the isolate is back. |
| `block()` | Busy-loops an isolate's worker for `ms` (at most 10 s), so you can watch containment work. For a pooled isolate it blocks the whole worker. |
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

**Guides:** [The inspection feed](../guide/inspection.md).

### `InspectRecord`

**Experimental.**

One record from a tap or a read (ADR 0020, decision 3): its value cut to a
2 KB preview, with its full size.

```ts nocheck
type InspectRecord = RecordPreview;
```

**Guides:** [The inspection feed](../guide/inspection.md).

### `InspectSnapshot`

**Experimental.**

What a reader gets first (ADR 0020, decision 2).

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
| `events` | The ring buffer: the last 200 events since the kernel started, oldest first. |

**Guides:** [The inspection feed](../guide/inspection.md).

### `IsolateHandle`

```ts nocheck
interface IsolateHandle {
  readonly id: string;
  snapshot(): IsolateSnapshot;
  stop(): Promise<void>;
  restart(): Promise<void>;
}
```

### `IsolateManifest`

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
| `src` | Isolate module URL, resolved against the document. |
| `surface?` | Where the isolate renders. Without one, the isolate is headless (ADR 0008). |
| `fallback?` | Renders the fallback shown once the isolate has `failed`. Defaults to a message and a Retry button. |
| `pool?` | Named worker pool (ADR 0001, M2c, M2d): the isolate shares one worker with every other isolate naming the same pool, headless or visual (ADR 0015). Pool members share an event loop, globals and fate: a hang or crash restarts the pool. Visual members also share one document, so they can read each other's DOM and input: pool only trusted isolates, and keep widgets that handle secrets on their own worker. |
| `suspend?` | Opt-in suspension (ADR 0001), default `'never'`. `'when-idle'` waits 60 s. Idle means: no visible surface (headless counts as never visible), nothing delivered for `afterMs`, no `ctx.keepAwake()` hold, and no host call or publish waiting for an answer. |
| `bus?` | After a bus restart, memory topics start empty and each subscription gets `reset` (ADR 0007). `onReset: 'restart'` restarts the isolate instead. |

### `IsolateSnapshot`

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
| `pool?` | The pool it runs in (M2c, ADR 0001); absent for an own worker. |
| `lastBeatAt` | `performance.now()` of the last beat. |
| `reason?` | The last crash, while restarting or failed. |
| `dropped` | Messages dropped because their `v` or `t` was unknown. |
| `holds?` | Open `ctx.keepAwake()` holds, from the last beat (devtools). |
| `busyMs?` | Milliseconds its worker spent running its code during the last beat's interval (ADR 0017); see `IdleReport.busyMs`. Absent before its first beat. |

**Guides:** [Supervision and restarts](../guide/supervision.md).

### `IsolateState`

```ts nocheck
type IsolateState = "loading" | "running" | "blocked" | "stopped" | "crashed" | "restarting" | "failed" | "suspended";
```

**Guides:** [Supervision and restarts](../guide/supervision.md).

### `Kernel`

```ts nocheck
interface Kernel {
  spawn(manifest: IsolateManifest): IsolateHandle;
  stop(id: string): Promise<void>;
  restart(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  publish<In>(topic: TopicRef<In, any, any, any>, rec: {
    key?: string;
    value: In;
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
| `stop()` | Stops an isolate: its `onShutdown` handlers get the stop grace, then its worker goes. Resolves once the worker is gone. The id is free at once: a `spawn` with it before then starts when the old worker is gone. |
| `resume()` | Wakes a suspended isolate (ADR 0001); a no-op otherwise. |
| `publish()` | Publishes from the host. Rejects with a `BusError`: `forbidden` for `isoloop.*` topics, or the broker's code (`invalid`, `bus_unavailable`, …). |
| `dropTopic()` | Deletes a persistent topic the contracts no longer list (ADR 0003, decision 19; see `bus:orphaned_topics`). Rejects with a `BusError`: `seed_pending` while a declared seed that reads it hasn't ended on this device, `invalid` for a topic the contracts list, or one whose rejected seed records are recorded unless `force` is set, `unknown_topic` when nothing is stored under the name. |
| `request()` | **Experimental.** Requests from the host (ADR 0018, decision 4), the mirror of `bus.request`: appends a request record with `req: { from: 'host', id, via }` and resolves with the first valid reply. Works on any requestable topic, exposed to agents or not. An isolate that restarts within the timeout still gets the request and can answer it. Rejects with a `BusError`: - `no_responder` at once when no isolate could answer: none has a subscribe grant for the topic, or every one that has is stopped or `failed`. A positive check doesn't promise a reply; - `timeout` after `timeoutMs` (default 30 s, the bus's); - `aborted` when `signal` aborts; - `dropped` at once when the topic's retention removed the request before the bus delivered it to any subscriber (a burst of more calls than the topic keeps); - `forbidden` for `isoloop.*` topics, `unknown_topic`, `not_requestable`, `invalid`, `reply_invalid` and `bus_unavailable`, as `bus.request` does. |
| `tools()` | **Experimental.** The tools exposed through `agents.expose` (ADR 0018, decision 2), with their JSON Schemas, made once at `createKernel`. Empty without `agents`. Transports list these and call them with `kernel.request`. |
| `subscribe()` | Subscribes from the host, from `latest` by default. Records cross the main thread only here. |
| `pools()` | Named pools with members (M2c): members, whether the worker runs, effective grants. |
| `inspect()` | **Experimental.** A reader of the inspection feed (ADR 0020): a snapshot of isolates, pools, the bus and the last 200 events, then events as they happen, with beats and bus metrics coalesced to about one a second. Costs nothing until a reader listens, apart from the ring buffer of recent events the kernel always keeps. |
| `syncRoute()` | The host's router changed the URL: republish `isoloop.route.v1` if `href` or `state` differ (ADR 0002). Wire it once, e.g. `router.subscribe(() => kernel.syncRoute())`. A no-op with routing off. |

### `KernelConfig`

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

| Field | Description |
| --- | --- |
| `contracts?` | The topics (ADR 0003): `url` is the ES module the bus worker imports, `list` its default export, imported by the host. Needs `workers.bus`. Without both there is no bus worker: isolates get an unconnected port, and `kernel.publish` rejects with `bus_unavailable`. |
| `supervisor?` | Defaults: one-for-one, 3 restarts in 60 s, backoff 250 ms × 2ⁿ capped at 4 s. |
| `heartbeat?` | Defaults: 100 / 400 / 10 000 ms, ready timeout 10 000 ms. |
| `styles?` | Adopted into every surface's shadow root. |
| `compositor?` | DOM work per frame; default 8 ms. The first batch of a frame always applies (I8). |
| `components?` | Host elements isolates may render by name (design §4.5), e.g. `{ 'iso-button': { tag: 'ds-button', attributes: ['variant'] } }`. Malformed entries make `createKernel` throw `invalid_config`. |
| `routing?` | Default true. With false the kernel adds no listeners, never publishes `isoloop.route.v1`, leaves link clicks alone, and `navigate` rejects with `routing_disabled` (ADR 0002). |
| `basePath?` | Default `/`. Must match the host router's `basename`; `/x` hrefs resolve against it. |
| `onNavigate?` | Decides a navigation from an isolate or a link click. Return `true` once accepted (not when finished), `false` to refuse. Default: `history.pushState` / `replaceState`. |
| `suspend?` | Suspension: at most this many suspended isolates start at once (default 4, ADR 0001). |
| `dev?` | Dev checks: the bus checks every schema output with `structuredClone` (ADR 0003, decision 11). Default false. |
| `agents?` | **Experimental.** Tools for agents (ADR 0018, decision 2): which requestable topics agents may call through the dev MCP or WebMCP. Without it nothing is exposed. |

**Guides:** [Getting started](../guide/getting-started.md).

### `KernelErrorCode`

Codes `createKernel` and `spawn` throw with (design §4.1).

```ts nocheck
type KernelErrorCode = "unsupported_browser" | "invalid_manifest" | "invalid_config" | "bus_failed" | "reserved_pool" | "balancer_exists" | "not_exposable";
```

**Guides:** [Getting started](../guide/getting-started.md).

### `KernelEvent`

```ts nocheck
type KernelEvent = keyof KernelEvents;
```

**Guides:** [Supervision and restarts](../guide/supervision.md).

### `KernelEvents`

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
| `isolate:crash` | `pool`: the isolate's pool, when it is a pool member (M2c); a pool's members crash together. |
| `isolate:failed` | Past the restart limit, or strategy `never`: the isolate stays down. |
| `isolate:beat` | One isolate's heartbeat, as it arrives (ADR 0017): its worker's `lagMs` and, from runtimes that report it, its own `busyMs` for the interval the beat covers. A pool's beat gives one event per member. `at` is the host's `performance.now()` on receipt. Emitted only while someone listens, so apps without a listener pay nothing. `@isoloop/balancer` reads every beat through it rather than polling `isolates()`, which keeps only the latest. |
| `workers:budget` | More live workers than `workers.budget`. Emitted once per kernel. |
| `agents:unmatched` | **Experimental.** `agents.expose` patterns that match no topic in the contracts (ADR 0018, decision 3). Emitted once, in the microtask after `createKernel`, so a listener added right after it hears it. |
| `bus:ready` | The bus worker loaded its contracts. `first` is false after a restart. |
| `bus:recovered` | The bus crashed twice while loading, so it started in safe mode: each persistent topic's newest segment was set aside, renamed and kept (ADR 0007, decision 5). `quarantined` lists them as `<topic>/<file>`. |
| `bus:durability_degraded` | Persistent topics run in memory on this bus, so they won't survive a reload (ADR 0007, decision 6). `another_tab`: another tab's bus holds the origin's files; `no_sync_access`: OPFS sync access handles are missing; `open_failed`: the files couldn't be opened. |
| `bus:quota` | The origin's storage is 80 % used, once per crossing (M2b task 14). At 100 % persistent publishes reject with `quota_exceeded`; memory topics carry on. |
| `bus:seed_rejected` | A source record a seed skipped: `map` threw or returned a promise (`seed_async`), or the topic's schema rejected the result (ADR 0003, decision 18). It stays in `from`. At most 10 a second per topic; the rest are counted in `bus:seeded`. |
| `bus:seeded` | A seed ended and the topic opened: `copied` records, `rejected` skipped. |
| `bus:orphaned_topics` | Persistent topics on disk that the contracts no longer list, and their total size (ADR 0003, decision 19). They are kept, not opened; nothing is deleted until `kernel.dropTopic`. |
| `bus:restart` | A new bus worker is starting; running isolates get a new bus port (ADR 0007). |
| `bus:failed` | The bus is down for good. With `code`, its contracts couldn't be used and no isolate runs (ADR 0003); with `reason`, it crashed past the restart limit and isolates keep running with every publish rejected (ADR 0007). |
| `bus:metrics` | Sampled every second (design §6.3). |
| `route:state_dropped` | `history.state` was too large for the route topic; it was published as `null` (ADR 0002). |
| `route:navigate_error` | `onNavigate` threw; the navigate call rejected with `navigate_failed`. |

**Guides:** [Supervision and restarts](../guide/supervision.md).

### `KernelRequestOptions`

**Experimental.**

`kernel.request`'s options (ADR 0018, decision 4).

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
| `timeoutMs?` | Default 30 s, the bus's. Transports pass `agents.timeoutMs` (`AgentTool.timeoutMs`). |
| `signal?` | Aborting rejects the call with `BusError('aborted')`. |
| `via?` | The transport making the call, set on the record as `req.via`. A label for logging and policy between cooperating code on one page; never authorize anything by it. |

**Guides:** [Tools for agents](../guide/agents.md).

### `NavigateRequest`

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
| `href` | Absolute, same-origin. |
| `from` | The isolate that asked, or whose link was clicked. |

**Guides:** [Writing isolates](../guide/isolates.md).

### `OnNavigate`

```ts nocheck
type OnNavigate = (req: NavigateRequest) => boolean | Promise<boolean>;
```

**Guides:** [Writing isolates](../guide/isolates.md).

### `PoolSnapshot`

A named pool (M2c, ADR 0001), for devtools.

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
| `members` | Isolates naming this pool, not stopped, in spawn order. |
| `running` | True while the pool's worker runs. |
| `grants` | What the pool can do in effect: the union of its members' grants. Members share a worker, so one member can reach another's bus port. |
| `sharesDocument` | True when a member has a surface: the pool's visual members render into one shared document (ADR 0015), so `warning` is set. |
| `warning?` | For devtools, when `sharesDocument`: what that means for the members. |

**Guides:** [Worker pools](../guide/pools.md).

### `RequestVia`

**Experimental.**

The agent transports that call through `kernel.request` (ADR 0018, decision 4):
the dev MCP, WebMCP, and later the Builder.

Self-declared by the caller: a label for logging and policy between
cooperating code on one page. Never authorize anything by it.

```ts nocheck
type RequestVia = "mcp" | "webmcp" | "builder";
```

**Guides:** [Tools for agents](../guide/agents.md).

### `SurfaceStats`

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
Returns a function that disconnects and aborts the calls in flight.

```ts nocheck
function connectDevMCP(kernel: Pick<Kernel, "tools" | "request"> & Partial<Pick<Kernel, "inspect" | "publish">>, options: DevMcpOptions): () => void;
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
