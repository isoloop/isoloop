/*
 * The public façade (design §4.1): spawn, stop, restart, events and
 * snapshots. Wiring only; the decisions live in the supervisor, the DOM writes
 * in the compositor.
 */
import {
  BusError,
  isIsolateToHost,
  isSystemTopic,
  ROUTE_KEY,
  routeTopic,
  type BusMetrics,
  type BusRecord,
  type CallResult,
  type ContractsList,
  type IdleReport,
  type Retention,
  type StartPosition,
  type TopicRef,
  type TypedRecord,
  type ErrorCode,
  type Grants,
  type HostMethod,
  type Rect,
  type HostToIsolate,
} from '@isoloop/protocol';
import { createBusController, HOST_CONNECTION_PREFIX, type BusController } from './bus/controller';
import { createCompositor, type FallbackRender, type SurfaceStats } from './compositor';
import { missingFeatures } from './features';
import { load, type LoadedWorker } from './loader';
import { createIsoloopDomBridge, ISOLOOP_DOM_FMT } from './render/isoloop-dom';
import { createRouter, type OnNavigate, type Router } from './router';
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

export type KernelConfig = {
  /**
   * The topics (ADR 0003): `url` is the ES module the bus worker imports,
   * `list` its default export, imported by the host. Needs `workers.bus`.
   * Without both there is no bus worker: isolates get an unconnected port,
   * and `kernel.publish` rejects with `bus_unavailable`.
   */
  contracts?: { url: string; list: ContractsList };
  workers: {
    isolateBootstrap: string;
    /** `bus-worker.js` URL. */
    bus?: string;
    /** Soft worker count: passing it warns once (`workers:budget`) and never blocks a spawn. Default 32 (ADR 0001). */
    budget?: number;
  };
  /** Defaults: one-for-one, 3 restarts in 60 s, backoff 250 ms × 2ⁿ capped at 4 s. */
  supervisor?: {
    strategy?: 'one-for-one' | 'never';
    maxRestarts?: number;
    withinMs?: number;
    backoff?: Partial<Backoff>;
  };
  /** Defaults: 100 / 400 / 10 000 ms, ready timeout 10 000 ms. */
  heartbeat?: {
    everyMs?: number;
    blockedAfterMs?: number;
    killAfterMs?: number;
    readyTimeoutMs?: number;
  };
  /** Adopted into every surface's shadow root. */
  styles?: readonly CSSStyleSheet[];
  /** DOM work per frame; default 8 ms. The first batch of a frame always applies (I8). */
  compositor?: { frameBudgetMs: number };
  /**
   * Host elements isolates may render by name (design §4.5), e.g.
   * `{ 'iso-button': { tag: 'ds-button', attributes: ['variant'] } }`.
   * Malformed entries make `createKernel` throw `invalid_config`.
   */
  components?: Readonly<Record<string, HostComponent>>;
  /**
   * Default true. With false the kernel adds no listeners, never publishes
   * `isoloop.route.v1`, leaves link clicks alone, and `navigate` rejects with
   * `routing_disabled` (ADR 0002).
   */
  routing?: boolean;
  /** Default `/`. Must match the host router's `basename`; `/x` hrefs resolve against it. */
  basePath?: string;
  /**
   * Decides a navigation from an isolate or a link click. Return `true` once
   * accepted (not when finished), `false` to refuse. Default:
   * `history.pushState` / `replaceState`.
   */
  onNavigate?: OnNavigate;
  /** Suspension: at most this many suspended isolates start at once (default 4, ADR 0001). */
  suspend?: { maxConcurrentWakes?: number };
  /** Dev checks: the bus checks every schema output with `structuredClone` (ADR 0003, decision 11). Default false. */
  dev?: boolean;
};

export type IsolateManifest = {
  id: string;
  /** Isolate module URL, resolved against the document. */
  src: string;
  /** Where the isolate renders. Without one, the isolate is headless (ADR 0008). */
  surface?: Element;
  config?: unknown;
  grants?: Grants;
  /** Renders the fallback shown once the isolate has `failed`. Defaults to a message and a Retry button. */
  fallback?: FallbackRender;
  /** Named worker pool (ADR 0001). Typed now, rejected with `pools_unsupported` until M2c. */
  pool?: string;
  /**
   * Opt-in suspension (ADR 0001), default `'never'`. `'when-idle'` waits
   * 60 s. Idle means: no visible surface (headless counts as never visible),
   * nothing delivered for `afterMs`, no `ctx.keepAwake()` hold, and no host
   * call or publish waiting for an answer.
   */
  suspend?: 'never' | 'when-idle' | { whenIdle: { afterMs: number } };
  /**
   * After a bus restart, memory topics start empty and each subscription gets
   * `reset` (ADR 0007). `onReset: 'restart'` restarts the isolate instead.
   */
  bus?: { onReset?: 'reset' | 'restart' };
};

/** Codes `createKernel` and `spawn` throw with (design §4.1). */
export type KernelErrorCode =
  | 'unsupported_browser'
  | 'pools_unsupported'
  | 'invalid_manifest'
  | 'invalid_config'
  /** The bus couldn't load its contracts, so nothing can start (ADR 0003, decision 7). */
  | 'bus_failed';

/** An error the kernel API throws, with a code to branch on. */
export class KernelError extends Error {
  readonly code: KernelErrorCode;
  constructor(code: KernelErrorCode, message: string) {
    super(message);
    this.name = 'KernelError';
    this.code = code;
  }
}

export type IsolateSnapshot = {
  id: string;
  state: IsolateState;
  /** `performance.now()` of the last beat. */
  lastBeatAt: number;
  lagMs: number;
  restarts: number;
  /** The last crash, while restarting or failed. */
  reason?: CrashReason;
  error?: string;
  surface?: SurfaceStats;
  /** Messages dropped because their `v` or `t` was unknown. */
  dropped: number;
  /** Open `ctx.keepAwake()` holds, from the last beat (devtools). */
  holds?: { ageMs: number; stack?: string }[];
};

export type KernelEvents = {
  'isolate:state': { id: string; state: IsolateState; prev: IsolateState };
  'isolate:ready': { id: string };
  'isolate:crash': { id: string; reason: CrashReason; message: string };
  /** Past the restart limit, or strategy `never`: the isolate stays down. */
  'isolate:failed': { id: string; reason: CrashReason; message: string };
  'isolate:error': { id: string; message: string };
  /** More live workers than `workers.budget`. Emitted once per kernel. */
  'workers:budget': { live: number; budget: number };
  /** The bus worker loaded its contracts. `first` is false after a restart. */
  'bus:ready': { first: boolean };
  'bus:crash': { reason: CrashReason; message: string };
  /** A new bus worker is starting; running isolates get a new bus port (ADR 0007). */
  'bus:restart': { restarts: number };
  /**
   * The bus is down for good. With `code`, its contracts couldn't be used and
   * no isolate runs (ADR 0003); with `reason`, it crashed past the restart
   * limit and isolates keep running with every publish rejected (ADR 0007).
   */
  'bus:failed': { code?: ErrorCode; reason?: CrashReason; message: string };
  /** Sampled every second (design §6.3). */
  'bus:metrics': BusMetrics;
  /** `history.state` was too large for the route topic; it was published as `null` (ADR 0002). */
  'route:state_dropped': { bytes: number };
  /** `onNavigate` threw; the navigate call rejected with `navigate_failed`. */
  'route:navigate_error': { from: string; href: string; error: string };
};

export type KernelEvent = keyof KernelEvents;

export interface IsolateHandle {
  readonly id: string;
  snapshot(): IsolateSnapshot;
  stop(): Promise<void>;
  restart(): Promise<void>;
}

export interface Kernel {
  spawn(manifest: IsolateManifest): IsolateHandle;
  stop(id: string): Promise<void>;
  restart(id: string): Promise<void>;
  /** Wakes a suspended isolate (ADR 0001); a no-op otherwise. */
  resume(id: string): Promise<void>;
  /**
   * Publishes from the host. Rejects with a `BusError`: `forbidden` for
   * `isoloop.*` topics, or the broker's code (`invalid`, `bus_unavailable`, …).
   */
  publish<In>(topic: TopicRef<In, any, any, any>, rec: { key?: string; value: In }): Promise<void>;
  /** Subscribes from the host, from `latest` by default. Records cross the main thread only here. */
  subscribe<Out>(
    topic: TopicRef<any, Out, any, any>,
    fn: (r: TypedRecord<Out>) => void,
    opts?: { from?: StartPosition },
  ): () => void;
  on<E extends KernelEvent>(event: E, fn: (e: KernelEvents[E]) => void): () => void;
  isolates(): IsolateSnapshot[];
  /**
   * The host's router changed the URL: republish `isoloop.route.v1` if
   * `href` or `state` differ (ADR 0002). Wire it once, e.g.
   * `router.subscribe(() => kernel.syncRoute())`. A no-op with routing off.
   */
  syncRoute(): void;
  destroy(): Promise<void>;
  /**
   * @internal Test hooks; not part of the API. `messages()` counts what the
   * main thread received from isolate workers and the bus control port, by
   * type, for invariant I7 (no topic record crosses the main thread).
   * `onSurfaceWrite(fn)` calls `fn` when the compositor starts and stops
   * writing to surfaces, for invariant I1 (only the compositor writes there).
   */
  readonly debug: {
    crashBus(): void;
    messages(): Record<string, number>;
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

/** Stylesheet texts from a patch; anything else is ignored. Capped so one patch can't flood the root. */
function stylesOf(x: unknown): string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const texts = x.filter((t): t is string => typeof t === 'string').slice(0, 64);
  return texts.length > 0 ? texts : undefined;
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

function validate(m: IsolateManifest): void {
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
    throw new KernelError(
      'pools_unsupported',
      `"${m.id}" asks for pool "${m.pool}", but worker pools arrive in M2c (ADR 0001)`,
    );
  }
  const s = m.suspend;
  if (s !== undefined && s !== 'never' && s !== 'when-idle') {
    const ms: unknown = typeof s === 'object' && s !== null ? s.whenIdle?.afterMs : undefined;
    if (typeof ms !== 'number' || !(ms > 0))
      throw new KernelError('invalid_manifest', `"${m.id}": unknown \`suspend\` value`);
  }
}
/** How often the supervisor judges heartbeats and timeouts (plan m1-kernel, task 2). */
const TICK_MS = 50;

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
  const listeners: { [E in KernelEvent]: Set<(e: KernelEvents[E]) => void> } = {
    'isolate:state': new Set(),
    'isolate:ready': new Set(),
    'isolate:crash': new Set(),
    'isolate:failed': new Set(),
    'isolate:error': new Set(),
    'workers:budget': new Set(),
    'bus:ready': new Set(),
    'bus:crash': new Set(),
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

  const emit = <E extends KernelEvent>(event: E, data: KernelEvents[E]): void => {
    for (const fn of listeners[event]) fn(data);
  };

  const post = (slot: Slot, msg: HostToIsolate): void => {
    slot.loaded?.worker.postMessage(msg);
  };

  /** Messages the main thread received, by type: the I7 test hook (`kernel.debug`). */
  const received: Record<string, number> = {};
  const count = (msg: unknown): void => {
    const t: unknown = typeof msg === 'object' && msg !== null ? Reflect.get(msg, 't') : undefined;
    const k = typeof t === 'string' ? t : '?';
    received[k] = (received[k] ?? 0) + 1;
  };

  const terminate = (slot: Slot): void => {
    clearTimeout(slot.graceTimer);
    slot.graceTimer = undefined;
    if (!slot.loaded) return;
    slot.loaded.worker.terminate();
    slot.loaded = null;
    // A suspended headless isolate is woken by records on its topics (ADR 0001).
    controller?.detach(slot.manifest.id, {
      wake: slot.sup.state === 'suspended' && !slot.manifest.surface,
    });
    slot.onClosed();
  };

  const shutdown = (slot: Slot, graceMs: number, reason: 'stop' | 'suspend' = 'stop'): void => {
    if (!slot.loaded) return;
    post(slot, { v: 1, t: 'shutdown', p: { reason, graceMs } });
    slot.graceTimer = setTimeout(() => {
      terminate(slot);
    }, graceMs);
  };

  const live = (): number => {
    let n = 0;
    for (const slot of slots.values()) if (slot.loaded) n++;
    return n;
  };

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
          if (!slot.queuedWake) {
            slot.queuedWake = true;
            wakeQueue.push(slot);
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
              emit(fx.event, { id, ...fx.data });
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
    const { s, effects } = step(slot.sup, input, cfg);
    slot.sup = s;
    run(slot, effects);
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
      case 'requestCanvas':
        fail('unsupported', 'requestCanvas arrives in M3');
        return;
      default:
        fail('unsupported', `Unknown host method ${JSON.stringify(method)}`);
    }
  };

  const onMessage = (slot: Slot, msg: unknown): void => {
    const id = slot.manifest.id;
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
          slot.fmt = fmt;
          feed(slot, { k: 'ready' });
          return;
        }
        case 'beat':
          slot.idle = msg.p.idle;
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
          feed(slot, { k: 'beat', at: performance.now(), lagMs: msg.p.lagMs });
          return;
        case 'patch':
          if (slot.fmt !== undefined && slot.fmt !== 'none' && msg.p.fmt === slot.fmt)
            compositor.enqueue(id, msg.p.batch, stylesOf(msg.p.styles));
          else slot.dropped++;
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
      loaded = load({
        bootstrapUrl: config.workers.isolateBootstrap,
        id: manifest.id,
        src: manifest.src,
        config: manifest.config ?? null,
        grants,
        renderFmt: manifest.surface ? ISOLOOP_DOM_FMT : 'none',
        heartbeatMs: everyMs,
        busPort,
        ...(o.wake ? { wake: true } : {}),
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
      count(e.data);
      if (slot.loaded === loaded) onMessage(slot, e.data);
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
            restart: (restarts) => emit('bus:restart', { restarts }),
            metrics: (m) => {
              warnLossyTopics(m.subscriptions);
              routeWatched = m.subscriptions.some(
                (x) =>
                  x.topic === routeTopic.name && !x.consumer.startsWith(HOST_CONNECTION_PREFIX),
              );
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
              slot.loaded.worker.postMessage(
                { v: 1, t: 'reattach', p: { busPort: port } } satisfies HostToIsolate,
                [port],
              );
            },
          },
        })
      : undefined;

  /** From the last metrics: an isolate subscribes to the route topic (for the basePath warning). */
  let routeWatched = false;
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

  function isIdle(slot: Slot, at: number): boolean {
    const afterMs = suspendAfter(slot.manifest);
    const idle = slot.idle;
    if (afterMs === undefined || slot.sup.state !== 'running' || !idle) return false;
    if (idle.holds.length > 0 || idle.inFlight > 0 || idle.sinceDeliveryMs < afterMs) return false;
    if (slot.manifest.surface && (visible(slot) || at - slot.hiddenSince < afterMs)) return false;
    return true;
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
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('resume', resumed);

  const get = (id: string): Slot => {
    const slot = slots.get(id);
    if (!slot) throw new Error(`No isolate "${id}"`);
    return slot;
  };

  const snapshot = (slot: Slot): IsolateSnapshot => {
    const { state, lastBeatAt, lagMs, restarts, reason, error } = slot.sup;
    const surface = compositor.stats(slot.manifest.id);
    return {
      id: slot.manifest.id,
      state,
      lastBeatAt,
      lagMs,
      restarts,
      dropped: slot.dropped,
      ...(reason === undefined ? {} : { reason }),
      ...(error === undefined ? {} : { error }),
      ...(surface === undefined ? {} : { surface }),
      ...(slot.idle && slot.idle.holds.length > 0 ? { holds: slot.idle.holds } : {}),
    };
  };

  const kernel: Kernel = {
    spawn(manifest) {
      validate(manifest);
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
        warnedTopics: new Set(),
      };
      slots.set(manifest.id, slot);
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

    syncRoute() {
      void router?.sync();
    },

    async destroy() {
      clearInterval(tick);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('resume', resumed);
      await Promise.all([...slots.keys()].map((id) => kernel.stop(id)));
      router?.destroy();
      controller?.destroy();
    },
  };
  return kernel;
}
