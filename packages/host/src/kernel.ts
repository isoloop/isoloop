/*
 * The public façade (design §4.1): spawn, stop, restart, events and
 * snapshots. Wiring only; the decisions live in the supervisor, the DOM writes
 * in the compositor.
 */
import {
  commitIntervalProblem,
  DEFAULT_COMMIT_INTERVAL_MS,
  BusError,
  isIsolateToHost,
  isSystemTopic,
  matchAny,
  ROUTE_KEY,
  routeTopic,
  type BusMetrics,
  type DurabilityDegraded,
  type BusRecord,
  type CallResult,
  type ContractsList,
  type IdleReport,
  type Retention,
  type StartPosition,
  type TopicRef,
  type TypedRecord,
  type ErrorCode,
  type Issue,
  type Grants,
  type HostMethod,
  type Rect,
  type HostToIsolate,
  type InspectControl,
  type InspectIsolate,
  MAX_BLOCK_MS,
} from '@isoloop/protocol';
import {
  agentsConfigProblem,
  buildTools,
  requestOptionsProblem,
  type AgentsConfig,
  type AgentTool,
  type KernelRequestOptions,
} from './agents';
import { createBusController, HOST_CONNECTION_PREFIX, type BusController } from './bus/controller';
import { createCompositor, type FallbackRender, type SurfaceStats } from './compositor';
import { missingFeatures } from './features';
import { createInspectFeed, serveInspectPort, type Inspector } from './inspect';
import { createLoader, ENTRY_MARK, type LoadedWorker } from './loader';
import { memoryMeasure, type MemoryWorker } from './memory';
import { createIsoloopDomBridge, ISOLOOP_DOM_FMT } from './render/isoloop-dom';
import { createRouter, type OnNavigate, type Router } from './router';
import { checkRequires } from './version';
import { createRegistry, type ComponentRegistry, type HostComponent } from './render/registry';
import {
  DEFAULT_BACKOFF,
  DEFAULT_SUPERVISOR_CONFIG,
  initialSupervision,
  step,
  type Backoff,
  type CrashReason,
  type IsolateState,
  type IsolateSupervision,
  type SupervisorConfig,
  type SupervisorEffect,
  type SupervisorInput,
} from './supervisor';

/** What `createKernel` takes: the workers, the topics, and how isolates are supervised. */
export type KernelConfig = {
  /**
   * The topics: `url` is the ES module the bus worker imports, `list` its
   * default export, imported by the host. Needs `workers.bus`. Without both
   * there is no bus worker: isolates get an unconnected port, and
   * `kernel.publish` rejects with `bus_unavailable`. Default: none.
   */
  contracts?: { url: string; list: ContractsList };
  /** The worker scripts' URLs, and the worker budget. */
  workers: {
    /** URL of the isolate bootstrap, the script every isolate worker starts from. Required. */
    isolateBootstrap: string;
    /** URL of the bus worker's script (`bus-worker.js`). Needed with `contracts`. Default: none. */
    bus?: string;
    /**
     * Soft worker count: going over it warns once (`workers:budget`) and never
     * blocks a spawn. Default 32.
     */
    budget?: number;
  };
  /** How crashed isolates are restarted. Defaults: one-for-one, 3 restarts in 60 s, backoff 250 ms × 2ⁿ capped at 4 s. */
  supervisor?: {
    /** `one-for-one` restarts the isolate that crashed; `never` fails it on its first crash. Default `one-for-one`. */
    strategy?: 'one-for-one' | 'never';
    /** Restarts allowed within `withinMs` before the isolate is `failed`. Default 3. */
    maxRestarts?: number;
    /** The restart window, in ms. Default 60 000 (60 s). */
    withinMs?: number;
    /** The wait before each restart. Default `{ initialMs: 250, factor: 2, maxMs: 4000 }`. */
    backoff?: Partial<Backoff>;
  };
  /** How the host tells a busy or hung isolate from a working one. Defaults: 100 / 400 / 10 000 ms, ready timeout 10 000 ms. */
  heartbeat?: {
    /** How often each worker beats, in ms. Default 100. */
    everyMs?: number;
    /** No beat for this long marks the isolate `blocked`, in ms. Default 400. */
    blockedAfterMs?: number;
    /** No beat for this long terminates the worker as `unresponsive`, in ms. Default 10 000 (10 s). */
    killAfterMs?: number;
    /** No `ready` this long after the spawn crashes it as `ready_timeout`, in ms. Default 10 000 (10 s). */
    readyTimeoutMs?: number;
  };
  /** Stylesheets adopted into every surface's shadow root. Default: none. */
  styles?: readonly CSSStyleSheet[];
  /**
   * `frameBudgetMs`: DOM work per frame, in ms. Default 8. The first batch of
   * a frame always applies, so a frame does at most the budget plus one batch.
   */
  compositor?: { frameBudgetMs: number };
  /**
   * Host elements isolates may render by name, for example
   * `{ 'iso-button': { tag: 'ds-button', attributes: ['variant'] } }`.
   * Malformed entries make `createKernel` throw `invalid_config`. Default: none.
   */
  components?: Readonly<Record<string, HostComponent>>;
  /**
   * Whether the kernel takes part in routing. Default true. With false the
   * kernel adds no listeners, never publishes `isoloop.route.v1`, leaves link
   * clicks alone, and `navigate` rejects with `routing_disabled`.
   */
  routing?: boolean;
  /** The app's base path. Must match the host router's `basename`; `/x` hrefs resolve against it. Default `/`. */
  basePath?: string;
  /**
   * Decides a navigation from an isolate or a link click. Return `true` once
   * accepted (not when finished), `false` to refuse. Default:
   * `history.pushState` / `replaceState`.
   */
  onNavigate?: OnNavigate;
  /** Suspension. `maxConcurrentWakes`: at most this many suspended isolates start at once. Default 4. */
  suspend?: { maxConcurrentWakes?: number };
  /**
   * Development checks: the bus checks every schema output with
   * `structuredClone`, and the console warns about a `keepAwake()` hold older
   * than 10 minutes and about tags put into `document.head`. Default false.
   */
  dev?: boolean;
  /**
   * Tools for agents: which requestable topics agents may call through the
   * dev MCP or WebMCP. Without it nothing is exposed. Default: none.
   * @experimental
   */
  agents?: AgentsConfig;
  /** The bus's own settings. */
  bus?: {
    /**
     * How far behind the broker's record of what each subscriber handled may
     * be, in ms: one `commits` message per port per interval, earlier at half
     * a subscription's credit. An integer from 0 to 1,000; 0 is every task. A
     * crash can redeliver up to one interval of records. Default 100.
     */
    commitIntervalMs?: number;
  };
};

/** One isolate to spawn: `kernel.spawn` takes it. */
export type IsolateManifest = {
  /** The isolate's id, unique among the kernel's isolates. */
  id: string;
  /** The isolate module's URL, resolved against the document. */
  src: string;
  /** Where the isolate renders. Without one, the isolate is headless. Default: none. */
  surface?: Element;
  /** Any value, passed to the isolate as `ctx.config`. Default: none. */
  config?: unknown;
  /** The topics it may publish to and subscribe to, and its other grants. Default: none. */
  grants?: Grants;
  /** Renders the fallback shown once the isolate has `failed`. Default: a message and a Retry button. */
  fallback?: FallbackRender;
  /**
   * A named worker pool: the isolate shares one worker with every other
   * isolate naming the same pool, headless or visual. Pool members share an
   * event loop, globals and fate: a hang or crash restarts the pool. Visual
   * members also share one document, so they can read each other's DOM and
   * input: pool only trusted isolates, and keep widgets that handle secrets
   * on their own worker. Default: a worker of its own.
   */
  pool?: string;
  /**
   * Opt-in suspension. Default `'never'`. `'when-idle'` waits 60 s. Idle
   * means: no visible surface (headless counts as never visible), nothing
   * delivered for `afterMs`, no `ctx.keepAwake()` hold, and no host call or
   * publish waiting for an answer.
   */
  suspend?: 'never' | 'when-idle' | { whenIdle: { afterMs: number } };
  /**
   * After a bus restart, memory topics start empty and each subscription gets
   * `onReset`. `onReset: 'restart'` restarts the isolate instead. Default `'reset'`.
   */
  bus?: { onReset?: 'reset' | 'restart' };
};

/**
 * The codes a `KernelError` carries:
 * - `unsupported_browser`: the browser lacks a feature Isoloop needs; the message names them;
 * - `invalid_manifest`: a manifest without an `id` or `src`, with an empty `pool`, an id the kernel reserves, or an unknown `suspend`;
 * - `invalid_config`: a `KernelConfig` value out of range or malformed, or a pooled isolate holding `inspect`;
 * - `bus_failed`: the bus couldn't load its contracts, so nothing can start;
 * - `reserved_pool`: a `pool` name starting `balancer-`, which belongs to `@isoloop/balancer`;
 * - `balancer_exists`: a second balancer on a kernel that already has one;
 * - `not_exposable`: an `agents.expose` pattern matches a topic that can't be a tool (no `reply`, no `tool`, or a schema without Standard JSON Schema); the message names the topic. `@experimental`.
 */
export type KernelErrorCode =
  | 'unsupported_browser'
  /** A manifest without `id` or `src`, with an empty `pool`, a reserved id, or an unknown `suspend`. */
  | 'invalid_manifest'
  | 'invalid_config'
  /** The bus couldn't load its contracts, so nothing can start. */
  | 'bus_failed'
  /** A `pool` name starting `balancer-`: those belong to `@isoloop/balancer`. */
  | 'reserved_pool'
  /** A second balancer on the same kernel: one balancer per kernel at a time. */
  | 'balancer_exists'
  /**
   * An `agents.expose` pattern matches a topic that can't be a tool: no
   * `reply`, no `tool`, or a schema without Standard JSON Schema. The
   * message names the topic.
   * @experimental
   */
  | 'not_exposable';

/** An error the kernel API throws, with a code to branch on. */
export class KernelError extends Error {
  /** What went wrong, to branch on. */
  readonly code: KernelErrorCode;
  /**
   * @param code What went wrong.
   * @param message A sentence for people, naming what to fix.
   */
  constructor(code: KernelErrorCode, message: string) {
    super(message);
    this.name = 'KernelError';
    this.code = code;
  }
}

/** One isolate as the kernel sees it now: `kernel.isolates()` and `handle.snapshot()`. */
export type IsolateSnapshot = {
  /** The isolate's id. */
  id: string;
  /** Where it is in its life. */
  state: IsolateState;
  /** The pool it runs in; absent for a worker of its own. */
  pool?: string;
  /** `performance.now()` of the last beat. */
  lastBeatAt: number;
  /** How late its worker's last beat fired, past the heartbeat interval, in ms: a busy event loop shows here. */
  lagMs: number;
  /** Restarts after a crash since it was spawned. A manual restart doesn't count. */
  restarts: number;
  /** The last crash, while restarting or failed. */
  reason?: CrashReason;
  /** The last crash's message, while restarting or failed. */
  error?: string;
  /** Its surface's batches, for an isolate with a surface. */
  surface?: SurfaceStats;
  /** Messages dropped because their `v` or `t` was unknown. */
  dropped: number;
  /** Open `ctx.keepAwake()` holds, from the last beat, with their age and where they were taken. */
  holds?: { ageMs: number; stack?: string }[];
  /**
   * Milliseconds its worker spent running its code during the last beat's
   * interval. Absent before its first beat, and from runtimes that don't report it.
   */
  busyMs?: number;
};

/** A named pool now: `kernel.pools()`. */
export type PoolSnapshot = {
  /** The pool's name. */
  name: string;
  /** Isolates naming this pool, not stopped, in spawn order. */
  members: string[];
  /** True while the pool's worker runs. */
  running: boolean;
  /**
   * What the pool can do in effect: the union of its members' grants.
   * Members share a worker, so one member can reach another's bus port.
   */
  grants: Grants;
  /**
   * True when a member has a surface: the pool's visual members render into
   * one shared document, so `warning` is set.
   */
  sharesDocument: boolean;
  /** When `sharesDocument`: what that means for the members, in a sentence for people. */
  warning?: string;
};

/** ADR 0015, decision 6, in the words the guide and devtools use. */
const SHARED_DOCUMENT_WARNING = "Members of this pool can read each other's DOM and input.";

/** `bus:quota` fires once storage use reaches this share of the quota. */
const QUOTA_WARN = 0.8;

/** The kernel's events and what each carries; `kernel.on(event, fn)` listens to one. */
export type KernelEvents = {
  /** An isolate moved from `prev` to `state`. */
  'isolate:state': { id: string; state: IsolateState; prev: IsolateState };
  /** An isolate is ready: its module loaded and it's about to run `start`. */
  'isolate:ready': { id: string };
  /** An isolate crashed. `pool`: its pool, when it's a pool member; a pool's members crash together. */
  'isolate:crash': { id: string; reason: CrashReason; message: string; pool?: string };
  /** Past the restart limit, or strategy `never`: the isolate stays down. */
  'isolate:failed': { id: string; reason: CrashReason; message: string; pool?: string };
  /** An isolate reported an error that wasn't fatal (`ctx.reportError(e, { fatal: false })`); it keeps running. */
  'isolate:error': { id: string; message: string };
  /**
   * One isolate's heartbeat, as it arrives: its worker's `lagMs`
   * and, from runtimes that report it, its own `busyMs` for the interval the
   * beat covers. A pool's beat gives one event per member. `at` is the host's
   * `performance.now()` on receipt. Emitted only while someone listens, so
   * apps without a listener pay nothing. `@isoloop/balancer` reads every beat
   * through it rather than polling `isolates()`, which keeps only the latest.
   */
  'isolate:beat': { id: string; pool?: string; lagMs: number; busyMs?: number; at: number };
  /** More live workers than `workers.budget`. Emitted once per kernel. */
  'workers:budget': { live: number; budget: number };
  /**
   * `agents.expose` patterns that match no topic in the contracts. Emitted once, in the microtask after `createKernel`, so a
   * listener added right after it hears it.
   * @experimental
   */
  'agents:unmatched': { patterns: string[] };
  /** The bus worker loaded its contracts. `first` is false after a restart. */
  'bus:ready': { first: boolean };
  /** The bus worker crashed. The kernel restarts it, within the supervisor's restart limit. */
  'bus:crash': { reason: CrashReason; message: string };
  /**
   * The bus crashed twice while loading, so it started in safe mode: each
   * persistent topic's newest segment was set aside, renamed and kept.
   * `quarantined` lists them as `<topic>/<file>`.
   */
  'bus:recovered': { quarantined: string[] };
  /**
   * Persistent topics run in memory on this bus, so they won't survive a
   * reload. `another_tab`: another tab's bus holds the
   * origin's files; `no_sync_access`: OPFS sync access handles are missing;
   * `open_failed`: the files couldn't be opened.
   */
  'bus:durability_degraded': { reason: DurabilityDegraded };
  /**
   * The origin's storage is 80 % used, once per crossing. At
   * 100 % persistent publishes reject with `quota_exceeded`; memory topics
   * carry on.
   */
  'bus:quota': { usage: number; quota: number };
  /**
   * A source record a seed skipped: `map` threw or returned a promise
   * (`seed_async`), or the topic's schema rejected the result. It stays in `from`. At most 10 a second per topic; the rest
   * are counted in `bus:seeded`.
   */
  'bus:seed_rejected': {
    topic: string;
    from: string;
    offset: number;
    code: ErrorCode;
    issues: Issue[];
  };
  /** A seed ended and the topic opened: `copied` records, `rejected` skipped. */
  'bus:seeded': { topic: string; copied: number; rejected: number };
  /**
   * Persistent topics on disk that the contracts no longer list, and their
   * total size. They are kept, not opened; nothing is
   * deleted until `kernel.dropTopic`.
   */
  'bus:orphaned_topics': { names: string[]; bytes: number };
  /** A new bus worker is starting; running isolates get a new bus port. `restarts` counts them. */
  'bus:restart': { restarts: number };
  /**
   * The bus is down for good. With `code`, its contracts couldn't be used and
   * no isolate runs; with `reason`, it crashed past the restart limit and
   * isolates keep running with every publish rejected.
   */
  'bus:failed': { code?: ErrorCode; reason?: CrashReason; message: string };
  /** The bus's figures, sampled every second: topics, subscriptions and rejected publishes. */
  'bus:metrics': BusMetrics;
  /** `history.state` was too large for the route topic; it was published as `null`. */
  'route:state_dropped': { bytes: number };
  /** `onNavigate` threw; the navigate call rejected with `navigate_failed`. */
  'route:navigate_error': { from: string; href: string; error: string };
};

/** A kernel event's name. */
export type KernelEvent = keyof KernelEvents;

/** A spawned isolate, from `kernel.spawn`: its id, and its own controls. */
export interface IsolateHandle {
  /** The isolate's id, from its manifest. */
  readonly id: string;
  /**
   * The isolate as the kernel sees it now.
   * @returns The same as its entry in `kernel.isolates()`.
   * @throws `Error` once the isolate has been stopped.
   */
  snapshot(): IsolateSnapshot;
  /**
   * Stops the isolate, as `kernel.stop(id)` does.
   * @returns Resolves once its worker is gone.
   */
  stop(): Promise<void>;
  /**
   * Restarts the isolate, as `kernel.restart(id)` does.
   * @returns Resolves once the restart has started.
   */
  restart(): Promise<void>;
}

/** The kernel `createKernel` returns: it spawns and supervises isolates, and talks to the bus from the host. */
export interface Kernel {
  /**
   * Starts an isolate in a worker of its own, or in its `pool`'s worker.
   * @param manifest What to start and where it renders.
   * @returns Its handle. The isolate starts loading at once; `isolate:ready` follows.
   * @throws `KernelError` `invalid_manifest`, `reserved_pool`, `invalid_config`
   *   (a pooled isolate holding `inspect`) or `bus_failed`; `Error` when an
   *   isolate with the same id exists.
   */
  spawn(manifest: IsolateManifest): IsolateHandle;
  /**
   * Stops an isolate: its `onShutdown` handlers get the stop grace (1 s), then
   * its worker goes. The id is free at once: a `spawn` with it before then
   * starts when the old worker is gone.
   * @param id The isolate's id.
   * @returns Resolves once the worker is gone.
   * @throws `Error` for an unknown id.
   */
  stop(id: string): Promise<void>;
  /**
   * Restarts an isolate now, whatever its state, `failed` included, and
   * clears its restart window.
   * @param id The isolate's id.
   * @returns Resolves once the restart has started.
   * @throws `Error` for an unknown id.
   */
  restart(id: string): Promise<void>;
  /**
   * Wakes a suspended isolate; a no-op otherwise.
   * @param id The isolate's id.
   * @returns Resolves once the wake is queued.
   * @throws `Error` for an unknown id.
   */
  resume(id: string): Promise<void>;
  /**
   * Publishes a record from the host.
   * @param topic The topic, from the contracts.
   * @param rec The record's `value`, and its `key` if any.
   * @returns Resolves once the bus has appended the record.
   * @throws Rejects with a `BusError`: `forbidden` for `isoloop.*` topics,
   *   `bus_unavailable` without contracts, or the broker's code (`invalid`,
   *   `quota_exceeded`, …).
   */
  publish<In>(topic: TopicRef<In, any, any, any>, rec: { key?: string; value: In }): Promise<void>;
  /**
   * Deletes a persistent topic the contracts no longer list (see
   * `bus:orphaned_topics`).
   * @param name The topic's name.
   * @param opts `force`: delete it even when it holds seed records the topic
   *   rejected. Default false.
   * @returns Resolves once the topic's files are gone.
   * @throws Rejects with a `BusError`: `seed_pending` while a declared seed that
   *   reads it hasn't ended on this device, `invalid` for a topic the contracts
   *   list (or one holding rejected seed records, without `force`),
   *   `unknown_topic` when nothing is stored under the name, `bus_unavailable`
   *   without contracts.
   */
  dropTopic(name: string, opts?: { force?: boolean }): Promise<void>;
  /**
   * Requests from the host, the mirror of `bus.request`: appends a request
   * record with `req: { from: 'host', id, via }` and resolves with the first
   * valid reply. Works on any requestable topic, exposed to agents or not. An
   * isolate that restarts within the timeout still gets the request and can
   * answer it.
   * @param topic A topic with a `reply` schema.
   * @param value The request's value, checked against the topic's schema.
   * @param opts The key, the timeout, an abort signal and the `via` label.
   * @returns The reply's value, checked against the `reply` schema.
   * @throws Rejects with a `BusError`:
   * - `no_responder` at once when no isolate could answer: none has a
   *   subscribe grant for the topic, or every one that has is stopped or
   *   `failed`. A positive check doesn't promise a reply;
   * - `timeout` after `timeoutMs` (default 30 s, the bus's);
   * - `aborted` when `signal` aborts;
   * - `dropped` at once when the topic's retention removed the request
   *   before the bus delivered it to any subscriber (a burst of more calls
   *   than the topic keeps);
   * - `forbidden` for `isoloop.*` topics, `unknown_topic`, `not_requestable`,
   *   `invalid`, `reply_invalid` and `bus_unavailable`, as `bus.request` does.
   * @example
   * ```ts
   * // `quoteTool` is a topic with a `reply` schema; an isolate answers it with `bus.reply`.
   * import { quoteTool } from './contracts';
   *
   * const { vwap } = await kernel.request(quoteTool, { symbol: 'ACME' }, { timeoutMs: 5_000 });
   * ```
   * @experimental
   */
  request<In, ROut>(
    topic: TopicRef<In, any, any, ROut>,
    value: In,
    opts?: KernelRequestOptions,
  ): Promise<ROut>;
  /**
   * The tools exposed through `agents.expose`, with their JSON Schemas, made
   * once at `createKernel`. Transports list these and call them with
   * `kernel.request`.
   * @returns The tools, in contracts order. Empty without `agents`.
   * @experimental
   */
  tools(): readonly AgentTool[];
  /**
   * Subscribes from the host. Records cross the main thread only here.
   * @param topic The topic, from the contracts.
   * @param fn Called with each record, in order.
   * @param opts `from`: where to start. Default `latest`.
   * @returns The function that unsubscribes.
   * @throws `Error` without contracts.
   */
  subscribe<Out>(
    topic: TopicRef<any, Out, any, any>,
    fn: (r: TypedRecord<Out>) => void,
    opts?: { from?: StartPosition },
  ): () => void;
  /**
   * Listens to one of the kernel's events.
   * @param event The event's name, a key of `KernelEvents`.
   * @param fn Called with each event's data.
   * @returns The function that stops listening.
   */
  on<E extends KernelEvent>(event: E, fn: (e: KernelEvents[E]) => void): () => void;
  /**
   * Every isolate not stopped, as the kernel sees it now.
   * @returns One snapshot per isolate, in spawn order.
   */
  isolates(): IsolateSnapshot[];
  /**
   * The named pools that have members.
   * @returns Each pool's members, whether its worker runs, and its members' grants together.
   */
  pools(): PoolSnapshot[];
  /**
   * A reader of the inspection feed: a snapshot of isolates, pools, the bus
   * and the last 200 events, then events as they happen, with beats and bus
   * metrics coalesced to about one a second. Costs nothing until a reader
   * listens, apart from the ring buffer of recent events the kernel always
   * keeps.
   * @returns A new reader; `close()` it when you're done.
   * @experimental
   */
  inspect(): Inspector;
  /**
   * Tells the kernel the host's router changed the URL: it republishes
   * `isoloop.route.v1` if `href` or `state` differ. Wire it once, for example
   * `router.subscribe(() => kernel.syncRoute())`. A no-op with routing off.
   */
  syncRoute(): void;
  /**
   * Stops every isolate and the bus, and removes the kernel's listeners.
   * @returns Resolves once every isolate's worker is gone.
   */
  destroy(): Promise<void>;
  /**
   * @internal Test hooks; not part of the API. `messages()` counts what the
   * main thread received from isolate workers and the bus control port, by
   * type, to check that no topic record crosses the main thread.
   * `onSurfaceWrite(fn)` calls `fn` when the compositor starts and stops
   * writing to surfaces, to check that only the compositor writes there.
   */
  readonly debug: {
    crashBus(): void;
    messages(): Record<string, number>;
    /** Live workers, a pool counting once, and each running pool's members. */
    workers(): { live: number; pools: Record<string, readonly string[]> };
    onSurfaceWrite(fn: (phase: 'start' | 'end') => void): () => void;
  };
}

type Slot = {
  manifest: IsolateManifest;
  sup: IsolateSupervision;
  loaded: LoadedWorker | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Terminates a worker that outlives its shutdown grace. */
  graceTimer: ReturnType<typeof setTimeout> | undefined;
  /** Settled once the worker is gone. */
  closed: Promise<void>;
  onClosed: () => void;
  dropped: number;
  /** The render format the isolate reported in `ready`; patches in any other are dropped. */
  fmt: string | undefined;
  /** From the last beat: what suspension needs to know. */
  idle: IdleReport | undefined;
  /** The surface is on screen (IntersectionObserver), ignoring the tab's visibility. */
  intersecting: boolean;
  /** `performance.now()` when the surface last stopped being visible. */
  hiddenSince: number;
  /** Started by the wake queue and not yet out of `loading`. */
  waking: boolean;
  queuedWake: boolean;
  warnedHold: boolean;
  /** `dev`: already warned that this isolate renders into `document.head`. */
  warnedHead: boolean;
  /** Canvases handed over with `requestCanvas`; each goes once. */
  canvases: WeakSet<HTMLCanvasElement>;
  /** Resize observers on those canvases, disconnected when the worker goes. */
  observers: ResizeObserver[];
  /** Ends the `inspect` port of this worker (ADR 0020, decision 6), for an isolate holding `inspect`. */
  inspectEnd: (() => void) | undefined;
  warnedTopics: Set<string>;
};

/** `afterMs` for a suspendable manifest, or `undefined` for `'never'`. */
function suspendAfter(m: IsolateManifest): number | undefined {
  const s = m.suspend;
  if (s === undefined || s === 'never') return undefined;
  if (s === 'when-idle') return 60_000;
  return s.whenIdle.afterMs;
}

/** On-screen order: top to bottom, then left to right; headless last. */
export function wakeOrder(
  items: readonly { id: string; rect: { top: number; left: number } | undefined }[],
): string[] {
  const ranked = items.map((x, i) => ({ ...x, i }));
  ranked.sort((a, b) => {
    if (!a.rect || !b.rect) return a.rect ? -1 : b.rect ? 1 : a.i - b.i;
    return a.rect.top - b.rect.top || a.rect.left - b.rect.left || a.i - b.i;
  });
  return ranked.map((x) => x.id);
}

/** Render formats a host accepts in `ready` for an isolate with a surface (ADR 0011: exact match). */
const SURFACE_FMTS: readonly string[] = [ISOLOOP_DOM_FMT];

const DEFAULT_GRANTS: Grants = { publish: [], subscribe: [] };
/** `kernel.request`'s default timeout: the bus's (system design §6.3). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Stylesheet texts from a patch; anything else is ignored. Capped so one patch can't flood the root. */
function stylesOf(x: unknown): string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const texts = x.filter((t): t is string => typeof t === 'string').slice(0, 64);
  return texts.length > 0 ? texts : undefined;
}

/** Head tags from a patch: short tag names only, at most 8. */
function headOf(x: unknown): string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const tags = x
    .filter((t): t is string => typeof t === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(t))
    .slice(0, 8);
  return tags.length > 0 ? tags : undefined;
}

/** A canvas side from `requestCanvas`'s size: a positive integer up to 16,384, or nothing. */
function canvasSide(size: unknown, k: 'width' | 'height'): number | undefined {
  const v: unknown = typeof size === 'object' && size !== null ? Reflect.get(size, k) : undefined;
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 16_384 ? v : undefined;
}

/** `scrollIntoView` options from an isolate, keeping only what the DOM accepts. */
function scrollOptions(x: unknown): ScrollIntoViewOptions {
  const out: ScrollIntoViewOptions = {};
  if (typeof x !== 'object' || x === null) return out;
  const pick = <T extends string>(k: string, ok: readonly T[]): T | undefined => {
    const v: unknown = Reflect.get(x, k);
    return ok.find((o) => o === v);
  };
  const positions = ['start', 'center', 'end', 'nearest'] as const;
  const behavior = pick('behavior', ['auto', 'instant', 'smooth'] as const);
  const block = pick('block', positions);
  const inline = pick('inline', positions);
  if (behavior) out.behavior = behavior;
  if (block) out.block = block;
  if (inline) out.inline = inline;
  return out;
}

/** Pool names `@isoloop/balancer` owns (ADR 0017); only a `claimPools` spawn may use them. */
const RESERVED_POOL_PREFIX = 'balancer-';

function validate(m: IsolateManifest, reservedOk: boolean): void {
  if (typeof m.id !== 'string' || m.id === '' || typeof m.src !== 'string' || m.src === '')
    throw new KernelError('invalid_manifest', 'A manifest needs a non-empty `id` and `src`');
  if (m.id.startsWith(HOST_CONNECTION_PREFIX))
    throw new KernelError(
      'invalid_manifest',
      `"${m.id}": ids starting with ${HOST_CONNECTION_PREFIX} belong to the kernel`,
    );
  if (m.pool !== undefined) {
    if (typeof m.pool !== 'string' || m.pool === '')
      throw new KernelError('invalid_manifest', `"${m.id}": \`pool\` must be a non-empty string`);
    if (!reservedOk && m.pool.startsWith(RESERVED_POOL_PREFIX))
      throw new KernelError(
        'reserved_pool',
        `"${m.id}": pool names starting ${RESERVED_POOL_PREFIX} belong to @isoloop/balancer`,
      );
  }
  if (m.pool !== undefined && m.grants?.inspect === true)
    throw new KernelError(
      'invalid_config',
      `"${m.id}": an isolate holding \`inspect\` can't be pooled: a pool merges its members' grants (ADR 0020, decision 6)`,
    );
  const s = m.suspend;
  if (s !== undefined && s !== 'never' && s !== 'when-idle') {
    const ms: unknown = typeof s === 'object' && s !== null ? s.whenIdle?.afterMs : undefined;
    if (typeof ms !== 'number' || !(ms > 0))
      throw new KernelError('invalid_manifest', `"${m.id}": unknown \`suspend\` value`);
  }
}
// How often the supervisor judges heartbeats and timeouts (plan m1-kernel, task 2).
const TICK_MS = 50;

/**
 * Creates the kernel: it starts the bus worker, then starts, watches and
 * restarts each isolate you spawn.
 * @param config The workers, the contracts, and how isolates are supervised.
 * @returns The kernel.
 * @throws `KernelError` `unsupported_browser` when the browser lacks something
 *   Isoloop needs, `invalid_config` for a malformed option, and
 *   `not_exposable` when `agents.expose` matches a topic that can't be a tool.
 * @example
 * ```ts
 * import { createKernel } from '@isoloop/host';
 * import workers from 'virtual:isoloop/workers';
 * import list from './contracts';
 * import contractsUrl from './contracts?isolate';
 * import cart from './cart?isolate';
 *
 * const kernel = createKernel({ contracts: { url: contractsUrl, list }, workers });
 * kernel.spawn({ id: 'cart', src: cart, surface: document.querySelector('#cart')! });
 * ```
 */
export function createKernel(config: KernelConfig): Kernel {
  const missing = missingFeatures();
  if (missing.length > 0)
    throw new KernelError(
      'unsupported_browser',
      `This browser lacks what Isoloop needs: ${missing.join(', ')}. See ADR 0009 rule 7 for the minimum versions.`,
    );
  let registry: ComponentRegistry;
  try {
    registry = createRegistry({ components: config.components ?? {} });
  } catch (error) {
    throw new KernelError('invalid_config', error instanceof Error ? error.message : String(error));
  }
  if ((config.contracts === undefined) !== (config.workers.bus === undefined))
    throw new KernelError(
      'invalid_config',
      '`contracts` and `workers.bus` go together: the bus worker needs both',
    );
  if (config.bus?.commitIntervalMs !== undefined) {
    const problem = commitIntervalProblem(config.bus.commitIntervalMs);
    if (problem) throw new KernelError('invalid_config', problem);
  }
  let tools: readonly AgentTool[] = [];
  let unmatched: string[] = [];
  if (config.agents !== undefined) {
    const problem = agentsConfigProblem(config.agents);
    if (problem) throw new KernelError('invalid_config', problem);
    const built = buildTools(config.contracts?.list, config.agents);
    if (!built.ok) throw new KernelError('not_exposable', built.message);
    tools = built.tools;
    unmatched = built.unmatched;
  }
  /** Contracts topics by name, for `kernel.request`'s checks. */
  const topicsByName = new Map((config.contracts?.list.topics ?? []).map((t) => [t.name, t]));
  const commitIntervalMs = config.bus?.commitIntervalMs ?? DEFAULT_COMMIT_INTERVAL_MS;
  const everyMs = config.heartbeat?.everyMs ?? 100;
  const def = DEFAULT_SUPERVISOR_CONFIG;
  const cfg: SupervisorConfig = {
    ...def,
    strategy: config.supervisor?.strategy ?? def.strategy,
    maxRestarts: config.supervisor?.maxRestarts ?? def.maxRestarts,
    withinMs: config.supervisor?.withinMs ?? def.withinMs,
    backoff: { ...DEFAULT_BACKOFF, ...config.supervisor?.backoff },
    blockedAfterMs: config.heartbeat?.blockedAfterMs ?? def.blockedAfterMs,
    killAfterMs: config.heartbeat?.killAfterMs ?? def.killAfterMs,
    readyTimeoutMs: config.heartbeat?.readyTimeoutMs ?? def.readyTimeoutMs,
  };
  const slots = new Map<string, Slot>();
  /**
   * Stopped isolates whose worker is still shutting down, by id. A new
   * isolate with the same id starts once its predecessor is gone: the bus
   * connection, the pool member and the surface all go by the id.
   */
  const closing = new Map<string, Slot>();
  const listeners: { [E in KernelEvent]: Set<(e: KernelEvents[E]) => void> } = {
    'isolate:state': new Set(),
    'isolate:ready': new Set(),
    'isolate:crash': new Set(),
    'isolate:failed': new Set(),
    'isolate:error': new Set(),
    'isolate:beat': new Set(),
    'workers:budget': new Set(),
    'agents:unmatched': new Set(),
    'bus:ready': new Set(),
    'bus:crash': new Set(),
    'bus:recovered': new Set(),
    'bus:durability_degraded': new Set(),
    'bus:quota': new Set(),
    'bus:seed_rejected': new Set(),
    'bus:seeded': new Set(),
    'bus:orphaned_topics': new Set(),
    'bus:restart': new Set(),
    'bus:failed': new Set(),
    'bus:metrics': new Set(),
    'route:state_dropped': new Set(),
    'route:navigate_error': new Set(),
  };
  const budget = config.workers.budget ?? 32;
  let warnedBudget = false;
  const surfaceWrites = new Set<(phase: 'start' | 'end') => void>();
  const compositor = createCompositor({
    onWrite: (phase) => {
      for (const fn of surfaceWrites) fn(phase);
    },
    ...(config.styles ? { styles: config.styles } : {}),
    ...(config.compositor ? { frameBudgetMs: config.compositor.frameBudgetMs } : {}),
  });

  // Chromium on a cross-origin isolated page; otherwise no memory figures (ADR 0020, decision 4).
  const measureMemory = memoryMeasure();
  // Read lazily: the getters it calls are defined below.
  const inspectFeed = createInspectFeed({
    isolates: (): InspectIsolate[] => [...slots.values()].map(snapshot),
    pools: () => kernel.pools(),
    busState: () => controller?.state ?? 'none',
    tap: (spec, fn) => {
      if (!controller) {
        throw new BusError({
          code: 'bus_unavailable',
          message: 'No bus worker: KernelConfig.contracts is not set',
        });
      }
      return controller.tap(spec, fn);
    },
    read: (topic, last) =>
      controller
        ? controller.read(topic, last)
        : Promise.resolve({
            ok: false,
            error: {
              code: 'bus_unavailable',
              message: 'No bus worker: KernelConfig.contracts is not set',
            },
          }),
    control: (action, id, ms) => inspectControl(action, id, ms),
    workers: (): MemoryWorker[] => {
      // One entry per live worker; a URL that several live workers share
      // (a bootstrap URL without the tiny entry's mark) can't be told apart,
      // so those workers get no figure.
      const byWorker = new Map<Worker, MemoryWorker & { ids: string[] }>();
      for (const [id, slot] of slots) {
        const l = slot.loaded;
        if (!l) continue;
        const w = byWorker.get(l.worker) ?? { url: l.url, ids: [], pool: l.pool !== undefined };
        w.ids.push(id);
        byWorker.set(l.worker, w);
      }
      const all = [...byWorker.values()];
      const count = new Map<string, number>();
      for (const w of all) count.set(w.url, (count.get(w.url) ?? 0) + 1);
      return all.filter((w) => count.get(w.url) === 1);
    },
    ...(measureMemory ? { measure: measureMemory } : {}),
  });

  const emit = <E extends KernelEvent>(event: E, data: KernelEvents[E]): void => {
    inspectFeed.event(event, data);
    for (const fn of listeners[event]) fn(data);
  };

  if (unmatched.length > 0) {
    const patterns = unmatched;
    console.warn(
      `Isoloop: agents.expose ${patterns.map((p) => JSON.stringify(p)).join(', ')} match${patterns.length === 1 ? 'es' : ''} no topic in the contracts`,
    );
    queueMicrotask(() => emit('agents:unmatched', { patterns: [...patterns] }));
  }

  /**
   * An isolate could answer a request on `topic` (ADR 0018, decision 6): its
   * grants let it subscribe, and it isn't stopped or failed. Stopped isolates
   * leave `slots`, so only `failed` is left to rule out.
   */
  const hasResponder = (topic: string): boolean => {
    for (const slot of slots.values()) {
      if (slot.sup.state === 'failed' || slot.sup.state === 'stopped') continue;
      if (matchAny((slot.manifest.grants ?? DEFAULT_GRANTS).subscribe, topic)) return true;
    }
    return false;
  };

  const post = (slot: Slot, msg: HostToIsolate, transfer: Transferable[] = []): void => {
    slot.loaded?.post(msg, transfer);
  };

  /** Messages the main thread received, by type: the I7 test hook (`kernel.debug`). */
  const received: Record<string, number> = {};
  /** Pool members share a worker, so each of its messages reaches several listeners: count it once. */
  const counted = new WeakSet<Event>();
  const count = (msg: unknown): void => {
    const t: unknown = typeof msg === 'object' && msg !== null ? Reflect.get(msg, 't') : undefined;
    const k = typeof t === 'string' ? t : '?';
    received[k] = (received[k] ?? 0) + 1;
  };

  const terminate = (slot: Slot): void => {
    clearTimeout(slot.graceTimer);
    slot.graceTimer = undefined;
    for (const o of slot.observers.splice(0)) o.disconnect();
    slot.inspectEnd?.();
    slot.inspectEnd = undefined;
    if (!slot.loaded) return;
    slot.loaded.terminate();
    slot.loaded = null;
    // A suspended headless isolate is woken by records on its topics (ADR 0001).
    controller?.detach(slot.manifest.id, {
      wake: slot.sup.state === 'suspended' && !slot.manifest.surface,
    });
    if (closing.get(slot.manifest.id) === slot) closing.delete(slot.manifest.id);
    slot.onClosed();
  };

  const shutdown = (slot: Slot, graceMs: number, reason: 'stop' | 'suspend' = 'stop'): void => {
    if (!slot.loaded) return;
    post(slot, { v: 1, t: 'shutdown', p: { reason, graceMs } });
    slot.graceTimer = setTimeout(() => {
      terminate(slot);
    }, graceMs);
  };

  const loader = createLoader();
  /** Set once the marked bootstrap URL turned out not to be the tiny entry. */
  let entryWarned = false;
  /** Live workers: a pool counts once (ADR 0001). */
  const live = (): number => loader.workers();

  const run = (slot: Slot, effects: SupervisorEffect[]): void => {
    const id = slot.manifest.id;
    for (const fx of effects) {
      switch (fx.k) {
        case 'terminate':
          terminate(slot);
          break;
        case 'shutdown':
          shutdown(slot, fx.graceMs);
          break;
        case 'suspend':
          compositor.freeze(id);
          shutdown(slot, fx.graceMs, 'suspend');
          break;
        case 'wake':
          // Any member's wake condition wakes the whole pool (M2c, ADR 0001).
          for (const s of slot.manifest.pool === undefined
            ? [slot]
            : [...slots.values()].filter(
                (o) =>
                  o.manifest.pool === slot.manifest.pool &&
                  (o === slot || o.sup.state === 'suspended'),
              ))
            if (!s.queuedWake) {
              s.queuedWake = true;
              wakeQueue.push(s);
            }
          pumpWakes();
          break;
        case 'spawn':
          clearTimeout(slot.timer);
          slot.timer = setTimeout(() => {
            slot.timer = undefined;
            // A stop while waiting wins.
            if (slot.sup.state === 'restarting') start(slot);
          }, fx.afterMs);
          break;
        case 'showBusy':
        case 'hideBusy':
          compositor.busy(id, fx.k === 'showBusy');
          break;
        case 'showFallback':
          compositor.fallback(
            id,
            {
              id,
              reason: fx.reason,
              message: fx.message,
              respawn: () => {
                if (slots.get(id) === slot) feed(slot, { k: 'respawn' });
              },
            },
            slot.manifest.fallback,
          );
          break;
        case 'hideFallback':
          compositor.fallback(id, null);
          break;
        case 'emit':
          switch (fx.event) {
            case 'isolate:state':
              emit(fx.event, { id, ...fx.data });
              break;
            case 'isolate:ready':
              emit(fx.event, { id });
              break;
            case 'isolate:crash':
            case 'isolate:failed':
              emit(fx.event, {
                id,
                ...fx.data,
                ...(slot.manifest.pool === undefined ? {} : { pool: slot.manifest.pool }),
              });
              break;
            case 'isolate:error':
              emit(fx.event, { id, ...fx.data });
              break;
          }
          break;
      }
    }
  };

  const feed = (slot: Slot, input: SupervisorInput): void => {
    const loaded = slot.loaded;
    const { s, effects } = step(slot.sup, input, cfg);
    slot.sup = s;
    run(slot, effects);
    if (loaded?.pool !== undefined) poolFate(slot, loaded, effects);
  };

  /**
   * A pool's members share fate (M2c, ADR 0001). When one crashes for a
   * reason that is the worker's (it stopped beating, or the worker itself
   * errored), every other member on that worker crashes with it, so the
   * worker is terminated with its last member and they all restart in a new
   * one, each replaying from its committed offsets. A member's own fatal
   * error, ready timeout or version mismatch stays that member's: it leaves
   * the pool alone.
   */
  const poolFate = (slot: Slot, loaded: LoadedWorker, effects: SupervisorEffect[]): void => {
    for (const fx of effects) {
      if (fx.k !== 'emit' || fx.event !== 'isolate:crash') continue;
      const { reason, message } = fx.data;
      if (reason !== 'unresponsive' && reason !== 'worker_error') return;
      const at = performance.now();
      const why = `pool "${loaded.pool}" restarted: "${slot.manifest.id}" ${reason === 'unresponsive' ? 'stopped responding' : 'took the worker down'} (${message})`;
      for (const other of slots.values())
        if (other !== slot && other.loaded?.worker === loaded.worker)
          feed(other, { k: 'poolCrash', at, reason, message: why });
      return;
    }
  };

  /**
   * Host calls (design §4.7). DOM calls run after every patch the isolate
   * sent before them, in the compositor's frame, so `measure` sees the
   * layout those patches produce.
   */
  const hostCall = (slot: Slot, re: string, method: HostMethod, args: unknown[]): void => {
    const reply = (p: CallResult): void => {
      if (slot.loaded) post(slot, { v: 1, t: 'result', re, p });
    };
    const fail = (code: ErrorCode, message: string): void => {
      reply({ ok: false, error: { code, message } });
    };
    switch (method) {
      case 'measure':
      case 'focus':
      case 'scrollIntoView': {
        if (!slot.manifest.surface) {
          fail('no_surface', `${method}: a headless isolate has no surface (ADR 0008)`);
          return;
        }
        const [nodeId, opts] = args;
        compositor.after(slot.manifest.id, ({ host, bridge }) => {
          const el = typeof nodeId === 'string' ? bridge.nodeFor?.(nodeId) : undefined;
          if (!el) {
            fail('not_found', `${method}: no rendered node ${JSON.stringify(nodeId)}`);
            return;
          }
          if (method === 'measure') {
            const r = el.getBoundingClientRect();
            const base = host.getBoundingClientRect();
            const rect: Rect = {
              x: r.x - base.x,
              y: r.y - base.y,
              width: r.width,
              height: r.height,
            };
            reply({ ok: true, value: rect });
            return;
          }
          if (method === 'focus') {
            if (el instanceof HTMLElement || el instanceof SVGElement) el.focus();
          } else {
            el.scrollIntoView(scrollOptions(opts));
          }
          reply({ ok: true, value: null });
        });
        return;
      }
      case 'navigate': {
        // Checked in the runtime too; the kernel is the one that counts (ADR 0002).
        if (slot.manifest.grants?.navigate !== true) {
          fail('forbidden', 'navigate: this isolate has no navigate grant (ADR 0002)');
          return;
        }
        if (!router) {
          fail('routing_disabled', 'navigate: routing is off (KernelConfig.routing)');
          return;
        }
        const [href, opts] = args;
        if (typeof href !== 'string') {
          fail('invalid', 'navigate: href must be a string');
          return;
        }
        const o = typeof opts === 'object' && opts !== null ? opts : {};
        const replace: unknown = Reflect.get(o, 'replace');
        const state: unknown = Reflect.get(o, 'state');
        void router
          .navigate(href, {
            replace: replace === true,
            from: slot.manifest.id,
            ...(state === undefined ? {} : { state }),
          })
          .then((r) => {
            if (r.ok) reply({ ok: true, value: r.value });
            else fail(r.code, r.message);
          });
        return;
      }
      case 'requestCanvas': {
        if (!slot.manifest.surface) {
          fail('no_surface', 'requestCanvas: a headless isolate has no surface (ADR 0008)');
          return;
        }
        const [nodeId, size] = args;
        if (typeof nodeId !== 'string') {
          fail('not_found', 'requestCanvas: not a rendered node');
          return;
        }
        compositor.after(slot.manifest.id, ({ bridge }) => {
          const el = bridge.nodeFor?.(nodeId);
          if (!(el instanceof HTMLCanvasElement)) {
            fail('not_found', `requestCanvas: no rendered <canvas> ${JSON.stringify(nodeId)}`);
            return;
          }
          if (slot.canvases.has(el)) {
            fail('invalid', 'requestCanvas: this canvas was already handed over');
            return;
          }
          const w = canvasSide(size, 'width');
          const h = canvasSide(size, 'height');
          if (w !== undefined) el.width = w;
          if (h !== undefined) el.height = h;
          const off = el.transferControlToOffscreen();
          slot.canvases.add(el);
          // Its CSS size, as `resize` events (the first one comes at once).
          const watch = new ResizeObserver(([entry]) => {
            if (!entry || !slot.loaded) return;
            const { width, height } = entry.contentRect;
            post(slot, {
              v: 1,
              t: 'event',
              p: {
                type: 'resize',
                target: nodeId,
                currentTargets: [nodeId],
                mods: { alt: false, ctrl: false, meta: false, shift: false },
                width,
                height,
              },
            });
          });
          watch.observe(el);
          slot.observers.push(watch);
          if (slot.loaded)
            post(slot, { v: 1, t: 'result', re, p: { ok: true, value: off } }, [off]);
        });
        return;
      }
      default:
        fail('unsupported', `Unknown host method ${JSON.stringify(method)}`);
    }
  };

  const onMessage = (slot: Slot, msg: unknown): void => {
    const id = slot.manifest.id;
    // A stopped isolate whose id was spawned again only finishes shutting
    // down: what else it sends would reach the new isolate's surface.
    const current = slots.get(id);
    if (current !== undefined && current !== slot) {
      if (isIsolateToHost(msg) && msg.t === 'bye') terminate(slot);
      return;
    }
    if (isIsolateToHost(msg)) {
      switch (msg.t) {
        case 'ready': {
          const fmt = msg.p.renderFmt;
          const surface = Boolean(slot.manifest.surface);
          if (surface ? !SURFACE_FMTS.includes(fmt) : fmt !== 'none') {
            const speaks = surface ? SURFACE_FMTS.join(' or ') : "'none' (headless)";
            feed(slot, {
              k: 'renderFmtMismatch',
              at: performance.now(),
              message: `The isolate renders ${JSON.stringify(fmt)}; this host speaks ${speaks}`,
            });
            return;
          }
          const verdict = checkRequires(msg.p.requires);
          if (!verdict.ok) {
            feed(slot, {
              k: 'versionMismatch',
              at: performance.now(),
              reason: verdict.reason,
              message: `"${id}" was ${verdict.message} (ADR 0012)`,
            });
            return;
          }
          slot.fmt = fmt;
          const boot = config.workers.isolateBootstrap;
          if (msg.p.entry !== true && boot.endsWith(ENTRY_MARK) && !entryWarned) {
            // Marked as the tiny entry, but it isn't: stop giving workers fragments.
            entryWarned = true;
            loader.entryDenied(boot);
            console.warn(
              `Isoloop: workers.isolateBootstrap ends in ${ENTRY_MARK} but doesn't start @isoloop/runtime/worker; memory per isolate is off (ADR 0020)`,
            );
          }
          feed(slot, { k: 'ready' });
          return;
        }
        case 'beat':
          slot.idle = slot.loaded?.pool === undefined ? msg.p.idle : msg.p.members?.[id];
          if (
            config.dev &&
            !slot.warnedHold &&
            msg.p.idle?.holds.some((h) => h.ageMs > 10 * 60_000)
          ) {
            slot.warnedHold = true;
            console.warn(
              `[isoloop] "${id}" has held keepAwake() for over 10 minutes; it can't be suspended (ADR 0001).`,
            );
          }
          {
            const at = performance.now();
            feed(slot, { k: 'beat', at, lagMs: msg.p.lagMs });
            if (listeners['isolate:beat'].size > 0 || inspectFeed.live) {
              const pool = slot.manifest.pool;
              const busyMs = slot.idle?.busyMs;
              const beat = {
                id,
                ...(pool === undefined ? {} : { pool }),
                lagMs: msg.p.lagMs,
                ...(busyMs === undefined ? {} : { busyMs }),
                at,
              };
              emit('isolate:beat', beat);
              if (inspectFeed.live) inspectFeed.beat(beat);
            }
          }
          return;
        case 'patch':
          if (slot.fmt !== undefined && slot.fmt !== 'none' && msg.p.fmt === slot.fmt)
            compositor.enqueue(id, msg.p.batch, stylesOf(msg.p.styles));
          else slot.dropped++;
          if (config.dev && !slot.warnedHead) {
            const tags = headOf(msg.p.head);
            if (tags) {
              slot.warnedHead = true;
              console.warn(
                `[isoloop] "${id}" put ${tags.map((t) => `<${t}>`).join(', ')} into document.head; Isoloop doesn't render an isolate's head, so it stays in the worker (M3a).`,
              );
            }
          }
          return;
        case 'error':
          feed(slot, {
            k: 'error',
            at: performance.now(),
            fatal: msg.p.fatal,
            message: msg.p.message,
          });
          return;
        case 'call':
          if (msg.id === undefined) slot.dropped++;
          else hostCall(slot, msg.id, msg.p.method, msg.p.args);
          return;
        case 'bye':
          if (slot.sup.state === 'stopped' || slot.sup.state === 'suspended') terminate(slot);
          return;
      }
    }
    slot.dropped++;
  };

  const start = (slot: Slot, o: { wake?: boolean } = {}): void => {
    const { manifest } = slot;
    // Spawned again before the stopped isolate with this id said `bye`: start
    // after it, so its late `bye` can't end this one's bus connection or pool
    // member. Waits at most the stop grace (`stopGraceMs`).
    const prev = closing.get(manifest.id);
    if (prev) {
      void prev.closed.then(() => {
        if (slots.get(manifest.id) === slot && slot.sup.state === 'restarting' && !slot.loaded)
          start(slot, o);
      });
      return;
    }
    slot.fmt = undefined;
    slot.idle = undefined;
    if (manifest.surface) {
      compositor.reset(manifest.id, bridgeFor(manifest.id));
    }
    const grants = manifest.grants ?? DEFAULT_GRANTS;
    const busPort = controller
      ? controller.connect(manifest.id, grants)
      : new MessageChannel().port2; // no bus worker: an unconnected port
    let loaded: LoadedWorker;
    try {
      loaded = loader.load({
        bootstrapUrl: config.workers.isolateBootstrap,
        id: manifest.id,
        src: manifest.src,
        config: manifest.config ?? null,
        grants,
        renderFmt: manifest.surface ? ISOLOOP_DOM_FMT : 'none',
        heartbeatMs: everyMs,
        commitIntervalMs,
        busPort,
        ...(o.wake ? { wake: true } : {}),
        ...(manifest.pool === undefined ? {} : { pool: manifest.pool }),
      });
    } catch (err) {
      controller?.detach(manifest.id);
      // Free memory before the retry: suspend every idle suspendable isolate (ADR 0001).
      const at = performance.now();
      for (const other of slots.values())
        if (other !== slot && isIdle(other, at)) feed(other, { k: 'suspend' });
      const message = err instanceof Error ? err.message : String(err);
      feed(slot, { k: 'spawnFailed', at: performance.now(), message });
      return;
    }
    loaded.worker.addEventListener('message', (e: MessageEvent<unknown>) => {
      if (!counted.has(e)) {
        counted.add(e);
        count(e.data);
      }
      if (slot.loaded === loaded && loaded.mine(e.data)) onMessage(slot, e.data);
    });
    loaded.worker.addEventListener('error', (e) => {
      e.preventDefault();
      if (slot.loaded === loaded)
        feed(slot, {
          k: 'workerError',
          at: performance.now(),
          message: e.message || 'Unknown error',
        });
    });
    loaded.worker.addEventListener('messageerror', () => {
      if (slot.loaded === loaded)
        feed(slot, {
          k: 'workerError',
          at: performance.now(),
          message: 'A message from the isolate could not be deserialised',
        });
    });
    slot.loaded = loaded;
    if (grants.inspect === true) {
      // Its own port to the host, never through the bus (ADR 0020, decision 6).
      const { port1, port2 } = new MessageChannel();
      slot.inspectEnd = serveInspectPort(port1, inspectFeed.open());
      loaded.post({ v: 1, t: 'inspect', p: { port: port2 } }, [port2]);
    }
    slot.closed = new Promise((resolve) => {
      slot.onClosed = resolve;
    });
    feed(slot, { k: 'spawned', at: performance.now() });
    const n = live();
    if (n > budget && !warnedBudget) {
      warnedBudget = true;
      console.warn(
        `Isoloop: ${n} isolate workers are running, more than the budget of ${budget}. Each worker has its own heap; see ADR 0001.`,
      );
      emit('workers:budget', { live: n, budget });
    }
  };

  /**
   * The bus worker (ADR 0005, ADR 0007), started before any isolate. After a
   * bus restart each running isolate gets a new port (`reattach`) and keeps
   * running, unless its manifest asks to be restarted.
   */
  let contractsFailed = false;
  const controller: BusController | undefined =
    config.contracts && config.workers.bus
      ? createBusController({
          workerUrl: config.workers.bus,
          contracts: config.contracts,
          heartbeatMs: everyMs,
          commitIntervalMs,
          supervisor: cfg,
          dev: config.dev ?? false,
          onControlMessage: (m) => count(m),
          events: {
            ready: (first) => {
              emit('bus:ready', { first });
              // The new bus starts with an empty route topic (ADR 0002, ADR 0007).
              if (!first) void router?.sync(true);
              // It also forgot what suspended isolates were waiting for: wake the headless ones.
              if (!first)
                for (const slot of slots.values())
                  if (!slot.manifest.surface) feed(slot, { k: 'wake' });
            },
            crash: (reason, message) => emit('bus:crash', { reason, message }),
            recovered: (quarantined) => emit('bus:recovered', { quarantined }),
            degraded: (reason) => emit('bus:durability_degraded', { reason }),
            orphaned: (names, bytes) => emit('bus:orphaned_topics', { names, bytes }),
            seed: (e) => {
              if (e.kind === 'seeded') {
                emit('bus:seeded', { topic: e.topic, copied: e.copied, rejected: e.rejected });
              } else {
                const { topic, from, offset, code, issues } = e;
                emit('bus:seed_rejected', { topic, from, offset, code, issues });
              }
            },
            restart: (restarts) => emit('bus:restart', { restarts }),
            metrics: (m) => {
              warnLossyTopics(m.subscriptions);
              if (m.storage && m.storage.quota > 0) {
                const high = m.storage.usage >= m.storage.quota * QUOTA_WARN;
                if (high && !quotaWarned) emit('bus:quota', m.storage);
                quotaWarned = high;
              }
              routeWatched = m.subscriptions.some(
                (x) =>
                  x.topic === routeTopic.name && !x.consumer.startsWith(HOST_CONNECTION_PREFIX),
              );
              inspectFeed.metrics(m);
              emit('bus:metrics', m);
            },
            failed: (f) => {
              emit('bus:failed', f);
              if (!('code' in f)) return;
              // Nothing can run without contracts: fail every isolate, accept no new ones.
              contractsFailed = true;
              const at = performance.now();
              for (const slot of slots.values())
                feed(slot, { k: 'busFailed', at, message: `bus: ${f.code}: ${f.message}` });
            },
            wake: (id) => {
              const slot = slots.get(id);
              // Visual isolates wake only when seen (ADR 0001).
              if (slot && !slot.manifest.surface) feed(slot, { k: 'wake' });
            },
            reattach: (id) => {
              const slot = slots.get(id);
              if (!slot?.loaded || !controller) return;
              if (slot.manifest.bus?.onReset === 'restart' && controller.state !== 'failed') {
                feed(slot, { k: 'respawn' });
                return;
              }
              const port = controller.connect(id, slot.manifest.grants ?? DEFAULT_GRANTS, {
                reattach: true,
              });
              slot.loaded.post({ v: 1, t: 'reattach', p: { busPort: port } }, [port]);
            },
          },
        })
      : undefined;

  /** From the last metrics: an isolate subscribes to the route topic (for the basePath warning). */
  let routeWatched = false;
  /** `bus:quota` was emitted and storage use hasn't dropped below the mark since. */
  let quotaWarned = false;
  const router: Router | undefined =
    config.routing === false
      ? undefined
      : createRouter({
          ...(config.basePath === undefined ? {} : { basePath: config.basePath }),
          ...(config.onNavigate ? { onNavigate: config.onNavigate } : {}),
          publish: (value) =>
            controller
              ? controller.publish(routeTopic.name, ROUTE_KEY, value)
              : Promise.resolve({
                  ok: false,
                  error: { code: 'bus_unavailable', message: 'No bus worker' },
                }),
          busDown: () =>
            !controller ||
            controller.state === 'restarting' ||
            controller.state === 'crashed' ||
            controller.state === 'failed',
          stateDropped: (bytes) => emit('route:state_dropped', { bytes }),
          navigateError: (e) => emit('route:navigate_error', e),
          ...(config.dev ? { dev: { subscribed: () => routeWatched } } : {}),
        });
  if (router && controller) void router.sync();

  /** A render bridge for one isolate: links go through the router when routing is on. */
  function bridgeFor(id: string): ReturnType<typeof createIsoloopDomBridge> {
    if (!router) return createIsoloopDomBridge(registry);
    return createIsoloopDomBridge(registry, {
      rewriteHref: (href) => router.rewrite(href),
      onLink: (a, e) => {
        router.linkClick(a, e, id);
      },
    });
  }

  // Suspension (ADR 0001): idleness, visibility and the wake queue.
  const maxWakes = config.suspend?.maxConcurrentWakes ?? 4;
  const wakeQueue: Slot[] = [];
  const retentionOf = new Map<string, Retention>(
    (config.contracts?.list.topics ?? []).map((t) => [t.name, t.retention]),
  );

  const visible = (slot: Slot): boolean =>
    Boolean(slot.manifest.surface) && slot.intersecting && !document.hidden;

  /**
   * Suspendable now (ADR 0001). A pool member only when its whole pool is:
   * every other member not stopped or failed is idle or already suspended,
   * so the pool suspends as a whole (M2c).
   */
  function isIdle(slot: Slot, at: number): boolean {
    if (!memberIdle(slot, at)) return false;
    const pool = slot.manifest.pool;
    if (pool === undefined) return true;
    for (const other of slots.values()) {
      if (other === slot || other.manifest.pool !== pool) continue;
      const st = other.sup.state;
      if (st === 'stopped' || st === 'failed' || st === 'suspended') continue;
      if (!memberIdle(other, at)) return false;
    }
    return true;
  }

  function memberIdle(slot: Slot, at: number): boolean {
    const afterMs = suspendAfter(slot.manifest);
    const idle = slot.idle;
    if (afterMs === undefined || slot.sup.state !== 'running' || !idle) return false;
    if (idle.holds.length > 0 || idle.inFlight > 0 || idle.sinceDeliveryMs < afterMs) return false;
    if (slot.manifest.surface && (visible(slot) || at - slot.hiddenSince < afterMs)) return false;
    return true;
  }

  /** Pools already warned that a member's `suspend` has no effect. */
  const warnedPools = new Set<string>();
  /**
   * Registration warning (M2c): a pool suspends only as a whole, so a member
   * that asks for `suspend` in a pool with a member that never suspends
   * never will. Warns once per pool.
   */
  function warnPoolSuspend(pool: string): void {
    if (warnedPools.has(pool)) return;
    const members = [...slots.values()].filter((s) => s.manifest.pool === pool);
    const asks = members.filter((s) => suspendAfter(s.manifest) !== undefined);
    const never = members.filter((s) => suspendAfter(s.manifest) === undefined);
    if (asks.length === 0 || never.length === 0) return;
    warnedPools.add(pool);
    console.warn(
      `[isoloop] pool "${pool}" suspends only as a whole, and ${never.map((s) => `"${s.manifest.id}"`).join(', ')} never suspends, so \`suspend\` on ${asks.map((s) => `"${s.manifest.id}"`).join(', ')} has no effect (ADR 0001).`,
    );
  }

  /** Starts queued wakes, visible surfaces first in on-screen order, at most `maxWakes` at once. */
  function pumpWakes(): void {
    let running = 0;
    for (const slot of slots.values()) {
      if (slot.waking && slot.sup.state !== 'loading') slot.waking = false;
      if (slot.waking) running++;
    }
    if (running >= maxWakes || wakeQueue.length === 0) return;
    const pending = wakeQueue.filter(
      (s) => s.sup.state === 'suspended' && slots.get(s.manifest.id) === s,
    );
    const order = wakeOrder(
      pending.map((s) => {
        const host = s.manifest.surface ? compositor.host(s.manifest.id) : undefined;
        const r = host && visible(s) ? host.getBoundingClientRect() : undefined;
        return { id: s.manifest.id, rect: r ? { top: r.top, left: r.left } : undefined };
      }),
    );
    wakeQueue.length = 0;
    for (const id of order) {
      const slot = slots.get(id);
      if (!slot) continue;
      if (running >= maxWakes) {
        wakeQueue.push(slot);
        continue;
      }
      slot.queuedWake = false;
      slot.waking = true;
      running++;
      start(slot, { wake: true });
    }
  }

  /** Registration warning: a suspendable isolate reading a topic that can drop records while it sleeps. */
  function warnLossyTopics(subs: readonly { consumer: string; topic: string }[]): void {
    for (const { consumer, topic } of subs) {
      const slot = slots.get(consumer);
      if (!slot || suspendAfter(slot.manifest) === undefined || slot.warnedTopics.has(topic))
        continue;
      const r = retentionOf.get(topic);
      if (r?.kind !== 'last-n' && r?.kind !== 'time') continue;
      slot.warnedTopics.add(topic);
      console.warn(
        `[isoloop] "${consumer}" can be suspended and reads ${topic} (${r.kind} retention): records it misses while suspended may be dropped, which arrives as a gap (ADR 0001).`,
      );
    }
  }

  const observer =
    typeof IntersectionObserver === 'undefined'
      ? undefined
      : new IntersectionObserver((entries) => {
          const at = performance.now();
          for (const e of entries) {
            const id = e.target instanceof HTMLElement ? e.target.dataset['isolateId'] : undefined;
            const slot = id === undefined ? undefined : slots.get(id);
            if (!slot) continue;
            const was = visible(slot);
            slot.intersecting = e.isIntersecting;
            if (was && !visible(slot)) slot.hiddenSince = at;
            if (visible(slot)) feed(slot, { k: 'wake' });
          }
        });

  const tick = setInterval(() => {
    const at = performance.now();
    controller?.feed({ k: 'tick', at });
    for (const slot of slots.values()) {
      feed(slot, { k: 'tick', at });
      if (isIdle(slot, at)) feed(slot, { k: 'suspend' });
    }
    if (wakeQueue.length > 0) pumpWakes();
  }, TICK_MS);

  // Hidden and frozen tabs (ADR 0001): a hidden page's timers are throttled
  // and a frozen one runs nothing, so silence there says nothing about an
  // isolate. Judge nothing while hidden; restart every clock on the way back.
  const visibility = (): void => {
    const at = performance.now();
    controller?.feed(document.hidden ? { k: 'hidden' } : { k: 'visible', at });
    for (const slot of slots.values()) {
      if (document.hidden && slot.intersecting) slot.hiddenSince = at;
      feed(slot, document.hidden ? { k: 'hidden' } : { k: 'visible', at });
      if (visible(slot)) feed(slot, { k: 'wake' });
    }
  };
  const resumed = (): void => {
    const at = performance.now();
    controller?.feed({ k: 'visible', at });
    for (const slot of slots.values()) feed(slot, { k: 'visible', at });
  };
  // Persistent topics are written at once when the page may be discarded or
  // go away (ADR 0001, what the browser still controls).
  const flush = (): void => controller?.flush();
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('resume', resumed);
  document.addEventListener('freeze', flush);
  window.addEventListener('pagehide', flush);

  const get = (id: string): Slot => {
    const slot = slots.get(id);
    if (!slot) throw new Error(`No isolate "${id}"`);
    return slot;
  };

  /** The inspection feed's controls (ADR 0020, decision 6). */
  const inspectControl = (action: InspectControl, id: string, ms?: number): void => {
    const slot = get(id);
    switch (action) {
      case 'restart':
        void kernel.restart(id);
        return;
      case 'kill':
        // As if its worker had died: the supervisor restarts it, and a pool's
        // other members restart with it (M2c).
        if (slot.loaded)
          feed(slot, {
            k: 'workerError',
            at: performance.now(),
            message: 'killed through the inspection feed',
          });
        return;
      case 'block':
        post(slot, { v: 1, t: 'block', p: { ms: Math.min(Math.max(0, ms ?? 0), MAX_BLOCK_MS) } });
        return;
    }
  };

  const snapshot = (slot: Slot): IsolateSnapshot => {
    const { state, lastBeatAt, lagMs, restarts, reason, error } = slot.sup;
    const surface = compositor.stats(slot.manifest.id);
    return {
      id: slot.manifest.id,
      state,
      ...(slot.manifest.pool === undefined ? {} : { pool: slot.manifest.pool }),
      lastBeatAt,
      lagMs,
      restarts,
      dropped: slot.dropped,
      ...(reason === undefined ? {} : { reason }),
      ...(error === undefined ? {} : { error }),
      ...(surface === undefined ? {} : { surface }),
      ...(slot.idle && slot.idle.holds.length > 0 ? { holds: slot.idle.holds } : {}),
      ...(slot.idle?.busyMs === undefined ? {} : { busyMs: slot.idle.busyMs }),
    };
  };

  // Set only for the length of a `claimPools` spawn, which may use reserved pools.
  let reservedOk = false;
  const kernel: Kernel = {
    spawn(manifest) {
      validate(manifest, reservedOk);
      if (contractsFailed)
        throw new KernelError(
          'bus_failed',
          `"${manifest.id}": the bus failed to load its contracts`,
        );
      if (slots.has(manifest.id)) throw new Error(`Isolate "${manifest.id}" already exists`);
      const slot: Slot = {
        manifest,
        sup: initialSupervision(performance.now()),
        loaded: null,
        timer: undefined,
        graceTimer: undefined,
        closed: Promise.resolve(),
        onClosed: () => {},
        dropped: 0,
        fmt: undefined,
        idle: undefined,
        intersecting: true,
        hiddenSince: performance.now(),
        waking: false,
        queuedWake: false,
        warnedHold: false,
        warnedHead: false,
        canvases: new WeakSet(),
        observers: [],
        inspectEnd: undefined,
        warnedTopics: new Set(),
      };
      slots.set(manifest.id, slot);
      if (manifest.pool !== undefined) warnPoolSuspend(manifest.pool);
      if (document.hidden) feed(slot, { k: 'hidden' });
      if (manifest.surface) {
        compositor.attach(manifest.id, manifest.surface, bridgeFor(manifest.id), (event) => {
          post(slot, { v: 1, t: 'event', p: event });
        });
        const host = compositor.host(manifest.id);
        if (host && suspendAfter(manifest) !== undefined) observer?.observe(host);
      }
      start(slot);
      const id = manifest.id;
      return {
        id,
        snapshot: () => snapshot(get(id)),
        stop: () => kernel.stop(id),
        restart: () => kernel.restart(id),
      };
    },

    stop(id) {
      const slot = get(id);
      clearTimeout(slot.timer);
      const host = compositor.host(id);
      if (host) observer?.unobserve(host);
      if (slot.sup.state === 'suspended') controller?.forget(id);
      feed(slot, { k: 'stop' });
      // A failed isolate has no worker; nothing else to wait for.
      if (slot.sup.state !== 'stopped') terminate(slot);
      compositor.detach(id);
      slots.delete(id);
      if (slot.loaded) closing.set(id, slot);
      return slot.loaded ? slot.closed : Promise.resolve();
    },

    restart(id) {
      feed(get(id), { k: 'respawn' });
      return Promise.resolve();
    },

    resume(id) {
      feed(get(id), { k: 'wake' });
      return Promise.resolve();
    },

    async publish(topic, rec) {
      if (isSystemTopic(topic.name))
        throw new BusError({ code: 'forbidden', message: `${topic.name} belongs to the kernel` });
      if (!controller)
        throw new BusError({
          code: 'bus_unavailable',
          message: 'No bus worker: KernelConfig.contracts is not set',
        });
      const r = await controller.publish(topic.name, rec.key, rec.value);
      if (!r.ok) throw new BusError(r.error);
    },

    async request(topic, value, opts = {}) {
      const name = topic.name;
      const problem = requestOptionsProblem(opts);
      if (problem) throw new BusError({ code: 'invalid', message: problem });
      if (isSystemTopic(name))
        throw new BusError({ code: 'forbidden', message: `${name} belongs to the kernel` });
      if (!controller)
        throw new BusError({
          code: 'bus_unavailable',
          message: 'No bus worker: KernelConfig.contracts is not set',
        });
      const shape = topicsByName.get(name);
      if (!shape) throw new BusError({ code: 'unknown_topic', message: `unknown topic ${name}` });
      if (shape.reply === undefined)
        throw new BusError({ code: 'not_requestable', message: `${name} has no reply schema` });
      const { signal } = opts;
      const aborted = (): BusError =>
        new BusError({ code: 'aborted', message: `The request on ${name} was aborted` });
      if (signal?.aborted) throw aborted();
      if (!hasResponder(name))
        throw new BusError({
          code: 'no_responder',
          message: `No isolate can answer ${name}: none with a subscribe grant for it is running or restarting`,
        });
      const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const call = controller.request(name, opts.key, value, {
        timeoutMs,
        ...(opts.via === undefined ? {} : { via: opts.via }),
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const stop = new Promise<CallResult>((resolve) => {
        timer = setTimeout(() => {
          resolve({
            ok: false,
            error: { code: 'timeout', message: `No reply on ${name} within ${timeoutMs} ms` },
          });
        }, timeoutMs);
        onAbort = () =>
          resolve({ ok: false, error: { code: 'aborted', message: aborted().message } });
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      const r = await Promise.race([call.result, stop]);
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      if (!r.ok) {
        call.cancel();
        throw new BusError(r.error);
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the broker validated the reply against the topic's reply schema
      return r.value as never;
    },

    tools: () => tools,

    async dropTopic(name, opts) {
      if (!controller)
        throw new BusError({
          code: 'bus_unavailable',
          message: 'No bus worker: KernelConfig.contracts is not set',
        });
      const r = await controller.drop(name, opts?.force ?? false);
      if (!r.ok) throw new BusError(r.error);
    },

    subscribe(topic, fn, opts) {
      if (!controller) throw new Error('No bus worker: KernelConfig.contracts is not set');
      return controller.subscribe({
        topic: topic.name,
        from: opts?.from ?? 'latest',
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the broker validated the value against the topic's schema
        fn: (r: BusRecord) => fn(r as TypedRecord<never>),
      });
    },

    debug: {
      crashBus: () => controller?.crash(),
      messages: () => ({ ...received }),
      workers: () => ({ live: loader.workers(), pools: loader.pools() }),
      onSurfaceWrite: (fn) => {
        surfaceWrites.add(fn);
        return () => {
          surfaceWrites.delete(fn);
        };
      },
    },

    on(event, fn) {
      const set = listeners[event];
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },

    isolates() {
      return [...slots.values()].map(snapshot);
    },

    inspect() {
      return inspectFeed.open();
    },

    pools() {
      const running = loader.pools();
      const out = new Map<string, PoolSnapshot>();
      for (const slot of slots.values()) {
        const name = slot.manifest.pool;
        if (name === undefined || slot.sup.state === 'stopped') continue;
        const g = slot.manifest.grants ?? DEFAULT_GRANTS;
        const pool: PoolSnapshot = out.get(name) ?? {
          name,
          members: [],
          running: name in running,
          grants: { publish: [], subscribe: [] },
          sharesDocument: false,
        };
        pool.members.push(slot.manifest.id);
        if (slot.manifest.surface && !pool.sharesDocument) {
          pool.sharesDocument = true;
          pool.warning = SHARED_DOCUMENT_WARNING;
        }
        for (const t of g.publish)
          if (!pool.grants.publish.includes(t)) pool.grants.publish.push(t);
        for (const t of g.subscribe)
          if (!pool.grants.subscribe.includes(t)) pool.grants.subscribe.push(t);
        if (g.navigate) pool.grants.navigate = true;
        out.set(name, pool);
      }
      return [...out.values()];
    },

    syncRoute() {
      void router?.sync();
    },

    async destroy() {
      clearInterval(tick);
      inspectFeed.destroy();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('resume', resumed);
      document.removeEventListener('freeze', flush);
      window.removeEventListener('pagehide', flush);
      await Promise.all([...slots.keys()].map((id) => kernel.stop(id)));
      router?.destroy();
      controller?.destroy();
    },
  };
  reservedSpawns.set(kernel, (manifest) => {
    reservedOk = true;
    try {
      return kernel.spawn(manifest);
    } finally {
      reservedOk = false;
    }
  });
  return kernel;
}

/** Each kernel's spawn that may use reserved pools, handed out by `claimPools`, one claim at a time. */
const reservedSpawns = new WeakMap<Kernel, (manifest: IsolateManifest) => IsolateHandle>();
const claimed = new WeakSet<Kernel>();

/**
 * Claims a kernel's reserved pools (`balancer-…`) for `@isoloop/balancer`.
 * The returned `spawn` is `kernel.spawn` that may also name those
 * pools; a plain `kernel.spawn` with one throws `reserved_pool`. A kernel has
 * one claim at a time, so one balancer: a second claim throws
 * `balancer_exists` until the first is released. `release()` gives the claim
 * back (the balancer's `dispose`): its `spawn` then throws `reserved_pool`,
 * isolates already in reserved pools keep running, and the kernel can be
 * claimed again.
 *
 * @internal Used by `@isoloop/balancer`; not part of the public API.
 */
export function claimPools(
  kernel: Kernel,
  prefix: 'balancer',
): { spawn: (manifest: IsolateManifest) => IsolateHandle; release: () => void } {
  if (`${prefix}-` !== RESERVED_POOL_PREFIX)
    throw new KernelError('invalid_config', `claimPools: unknown prefix ${JSON.stringify(prefix)}`);
  const spawn = reservedSpawns.get(kernel);
  if (!spawn) throw new KernelError('invalid_config', 'claimPools: not a kernel from createKernel');
  if (claimed.has(kernel))
    throw new KernelError('balancer_exists', 'claimPools: this kernel already has a balancer');
  claimed.add(kernel);
  let released = false;
  return {
    spawn: (manifest) => {
      if (released) throw new KernelError('reserved_pool', 'claimPools: this claim was released');
      return spawn(manifest);
    },
    release: () => {
      if (released) return;
      released = true;
      claimed.delete(kernel);
    },
  };
}
