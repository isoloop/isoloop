/*
 * The public façade (design §4.1): spawn, stop, restart, events and
 * snapshots. Wiring only; the decisions live in the supervisor, the DOM writes
 * in the compositor.
 */
import {
  isIsolateToHost,
  isLegacyIsolateToHost,
  type Grants,
  type HostToIsolate,
  type LegacyHostToIsolate,
} from '@isoloop/protocol';
import { createCompositor, type FallbackRender, type SurfaceStats } from './compositor';
import { createLegacyBus, type BusDelivery } from './legacy-bus';
import { load, type LoadedWorker } from './loader';
import { createLegacyVdomBridge, LEGACY_VDOM } from './render/legacy-vdom';
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
  workers: {
    isolateBootstrap: string;
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
};

/** Codes `createKernel` and `spawn` throw with (design §4.1). */
export type KernelErrorCode = 'pools_unsupported' | 'suspend_unsupported' | 'invalid_manifest';

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
  on<E extends KernelEvent>(event: E, fn: (e: KernelEvents[E]) => void): () => void;
  isolates(): IsolateSnapshot[];
  destroy(): Promise<void>;
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
};

const DEFAULT_GRANTS: Grants = { publish: [], subscribe: [] };

function validate(m: IsolateManifest): void {
  if (typeof m.id !== 'string' || m.id === '' || typeof m.src !== 'string' || m.src === '')
    throw new KernelError('invalid_manifest', 'A manifest needs a non-empty `id` and `src`');
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
  };
  const budget = config.workers.budget ?? 32;
  let warnedBudget = false;
  const compositor = createCompositor(config.styles);

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
    slot.loaded.busPort.close();
    slot.loaded = null;
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

  const onMessage = (slot: Slot, msg: unknown): void => {
    const id = slot.manifest.id;
    if (isIsolateToHost(msg)) {
      switch (msg.t) {
        case 'ready':
          feed(slot, { k: 'ready' });
          return;
        case 'beat':
          feed(slot, { k: 'beat', at: performance.now(), lagMs: msg.p.lagMs });
          return;
        case 'patch':
          if (msg.p.fmt === LEGACY_VDOM) compositor.enqueue(id, msg.p.batch);
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
          // Host calls arrive in M1.
          slot.dropped++;
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
    if (manifest.surface) {
      compositor.reset(manifest.id, createLegacyVdomBridge());
    }
    let loaded: LoadedWorker;
    try {
      loaded = load({
        bootstrapUrl: config.workers.isolateBootstrap,
        id: manifest.id,
        src: manifest.src,
        config: manifest.config ?? null,
        grants: manifest.grants ?? DEFAULT_GRANTS,
        renderFmt: manifest.surface ? LEGACY_VDOM : 'none',
        heartbeatMs: everyMs,
      });
    } catch (err) {
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

  const tick = setInterval(() => {
    const at = performance.now();
    for (const slot of slots.values()) feed(slot, { k: 'tick', at });
  }, TICK_MS);

  // Hidden and frozen tabs (ADR 0001): a hidden page's timers are throttled
  // and a frozen one runs nothing, so silence there says nothing about an
  // isolate. Judge nothing while hidden; restart every clock on the way back.
  const visibility = (): void => {
    const at = performance.now();
    for (const slot of slots.values())
      feed(slot, document.hidden ? { k: 'hidden' } : { k: 'visible', at });
  };
  const resumed = (): void => {
    const at = performance.now();
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
      };
      slots.set(manifest.id, slot);
      if (document.hidden) feed(slot, { k: 'hidden' });
      if (manifest.surface) {
        compositor.attach(manifest.id, manifest.surface, createLegacyVdomBridge(), (event) => {
          post(slot, { v: 1, t: 'event', p: event });
        });
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
    },
  };
  return kernel;
}
