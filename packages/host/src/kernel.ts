/*
 * The public façade (design §4.1): spawn, stop, restart, events and
 * snapshots. Wiring only; the decisions live in the supervisor, the DOM writes
 * in the compositor.
 */
import {
  isIsolateToHost,
  isLegacyIsolateToHost,
  isSystemTopic,
  type BusMetrics,
  type BusRecord,
  type CallResult,
  type ContractsList,
  type StartPosition,
  type TopicRef,
  type TypedRecord,
  type ErrorCode,
  type Grants,
  type HostMethod,
  type Rect,
  type HostToIsolate,
  type LegacyHostToIsolate,
} from '@isoloop/protocol';
import { createBusController, HOST_CONNECTION_PREFIX, type BusController } from './bus/controller';
import { BusError } from './bus/errors';
import { createCompositor, type FallbackRender, type SurfaceStats } from './compositor';
import { missingFeatures } from './features';
import { createLegacyBus, type BusDelivery } from './legacy-bus';
import { load, type LoadedWorker } from './loader';
import { createIsoloopDomBridge, ISOLOOP_DOM_FMT } from './render/isoloop-dom';
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
   * Without it there is no bus worker; M2 task 11 makes it required.
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
  /** Opt-in suspension (ADR 0001). Anything but `'never'` is rejected with `suspend_unsupported` until M2. */
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
  | 'suspend_unsupported'
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
  /** A publish on the M0 main-thread bus. */
  'bus:publish': BusDelivery;
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
  destroy(): Promise<void>;
  /** @internal Test hooks; not part of the API. */
  readonly debug: { crashBus(): void };
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
};

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
  if (s !== undefined && s !== 'never') {
    const ok =
      s === 'when-idle' ||
      (typeof s === 'object' && s !== null && typeof s.whenIdle?.afterMs === 'number');
    if (!ok) throw new KernelError('invalid_manifest', `"${m.id}": unknown \`suspend\` value`);
    throw new KernelError(
      'suspend_unsupported',
      `"${m.id}" asks for suspension, which arrives in M2 (ADR 0001)`,
    );
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
    'bus:publish': new Set(),
    'bus:ready': new Set(),
    'bus:crash': new Set(),
    'bus:restart': new Set(),
    'bus:failed': new Set(),
    'bus:metrics': new Set(),
  };
  const budget = config.workers.budget ?? 32;
  let warnedBudget = false;
  const compositor = createCompositor({
    ...(config.styles ? { styles: config.styles } : {}),
    ...(config.compositor ? { frameBudgetMs: config.compositor.frameBudgetMs } : {}),
  });

  const emit = <E extends KernelEvent>(event: E, data: KernelEvents[E]): void => {
    for (const fn of listeners[event]) fn(data);
  };

  const post = (slot: Slot, msg: HostToIsolate | LegacyHostToIsolate): void => {
    slot.loaded?.worker.postMessage(msg);
  };

  const bus = createLegacyBus((to, d) => {
    const slot = slots.get(to);
    if (slot)
      post(slot, { v: 1, t: 'x-deliver', p: { topic: d.topic, value: d.value, from: d.from } });
  });

  const terminate = (slot: Slot): void => {
    clearTimeout(slot.graceTimer);
    slot.graceTimer = undefined;
    if (!slot.loaded) return;
    slot.loaded.worker.terminate();
    slot.loaded = null;
    controller?.detach(slot.manifest.id);
    bus.remove(slot.manifest.id);
    slot.onClosed();
  };

  const shutdown = (slot: Slot, graceMs: number): void => {
    if (!slot.loaded) return;
    post(slot, { v: 1, t: 'shutdown', p: { reason: 'stop', graceMs } });
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
      case 'navigate':
        fail('routing_disabled', 'navigate: routing arrives in M2 (ADR 0002)');
        return;
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
          if (slot.sup.state === 'stopped') terminate(slot);
          return;
      }
    }
    if (isLegacyIsolateToHost(msg)) {
      if (msg.t === 'x-sub') bus.subscribe(id, msg.p.topic);
      else {
        const targets = bus.publish(id, msg.p.topic, msg.p.value);
        emit('bus:publish', { from: id, topic: msg.p.topic, value: msg.p.value, targets });
      }
      return;
    }
    slot.dropped++;
  };

  const start = (slot: Slot): void => {
    const { manifest } = slot;
    slot.fmt = undefined;
    if (manifest.surface) {
      compositor.reset(manifest.id, createIsoloopDomBridge(registry));
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
      });
    } catch (err) {
      controller?.detach(manifest.id);
      const message = err instanceof Error ? err.message : String(err);
      feed(slot, { k: 'spawnFailed', at: performance.now(), message });
      return;
    }
    loaded.worker.addEventListener('message', (e: MessageEvent<unknown>) => {
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
          events: {
            ready: (first) => emit('bus:ready', { first }),
            crash: (reason, message) => emit('bus:crash', { reason, message }),
            restart: (restarts) => emit('bus:restart', { restarts }),
            metrics: (m) => emit('bus:metrics', m),
            failed: (f) => {
              emit('bus:failed', f);
              if (!('code' in f)) return;
              // Nothing can run without contracts: fail every isolate, accept no new ones.
              contractsFailed = true;
              const at = performance.now();
              for (const slot of slots.values())
                feed(slot, { k: 'busFailed', at, message: `bus: ${f.code}: ${f.message}` });
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

  const tick = setInterval(() => {
    const at = performance.now();
    controller?.feed({ k: 'tick', at });
    for (const slot of slots.values()) feed(slot, { k: 'tick', at });
  }, TICK_MS);

  // Hidden and frozen tabs (ADR 0001): a hidden page's timers are throttled
  // and a frozen one runs nothing, so silence there says nothing about an
  // isolate. Judge nothing while hidden; restart every clock on the way back.
  const visibility = (): void => {
    const at = performance.now();
    controller?.feed(document.hidden ? { k: 'hidden' } : { k: 'visible', at });
    for (const slot of slots.values())
      feed(slot, document.hidden ? { k: 'hidden' } : { k: 'visible', at });
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
      };
      slots.set(manifest.id, slot);
      if (document.hidden) feed(slot, { k: 'hidden' });
      if (manifest.surface) {
        compositor.attach(
          manifest.id,
          manifest.surface,
          createIsoloopDomBridge(registry),
          (event) => {
            post(slot, { v: 1, t: 'event', p: event });
          },
        );
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

    async destroy() {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('resume', resumed);
      await Promise.all([...slots.keys()].map((id) => kernel.stop(id)));
      controller?.destroy();
    },
  };
  return kernel;
}
