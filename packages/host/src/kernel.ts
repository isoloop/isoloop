/*
 * The public façade (design §4.1), reduced to what M0 needs to run the proof
 * of concept: spawn, stop, restart, events and snapshots. Wiring only; the
 * decisions live in the supervisor, the DOM writes in the compositor.
 */
import {
  isIsolateToHost,
  isLegacyIsolateToHost,
  type Grants,
  type HostToIsolate,
  type LegacyHostToIsolate,
} from '@isoloop/protocol';
import { createCompositor, type SurfaceStats } from './compositor';
import { createLegacyBus, type BusDelivery } from './legacy-bus';
import { load, type LoadedWorker } from './loader';
import { createLegacyVdomBridge, LEGACY_VDOM } from './render/legacy-vdom';
import {
  initialSupervision,
  step,
  type IsolateState,
  type Supervision,
  type SupervisorConfig,
  type SupervisorEffect,
  type SupervisorInput,
} from './supervisor';

export type KernelConfig = {
  workers: { isolateBootstrap: string };
  heartbeat?: { everyMs?: number; blockedAfterMs?: number };
  /** Delay before a crashed isolate is restarted. Default 1500 ms, as in the PoC. */
  restartAfterMs?: number;
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
};

export type IsolateSnapshot = {
  id: string;
  state: IsolateState;
  /** `performance.now()` of the last beat. */
  lastBeatAt: number;
  lagMs: number;
  restarts: number;
  error?: string;
  surface?: SurfaceStats;
  /** Messages dropped because their `v` or `t` was unknown. */
  dropped: number;
};

export type KernelEvents = {
  'isolate:state': { id: string; state: IsolateState; prev: IsolateState };
  'isolate:crash': { id: string; message: string; restarts: number };
  'isolate:error': { id: string; message: string };
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
  sup: Supervision;
  loaded: LoadedWorker | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  dropped: number;
};

const DEFAULT_GRANTS: Grants = { publish: [], subscribe: [] };

export function createKernel(config: KernelConfig): Kernel {
  const everyMs = config.heartbeat?.everyMs ?? 100;
  const cfg: SupervisorConfig = {
    blockedAfterMs: config.heartbeat?.blockedAfterMs ?? 400,
    restartAfterMs: config.restartAfterMs ?? 1500,
  };
  const slots = new Map<string, Slot>();
  const listeners: { [E in KernelEvent]: Set<(e: KernelEvents[E]) => void> } = {
    'isolate:state': new Set(),
    'isolate:crash': new Set(),
    'isolate:error': new Set(),
    'bus:publish': new Set(),
  };
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
    if (!slot.loaded) return;
    slot.loaded.worker.terminate();
    slot.loaded.busPort.close();
    slot.loaded = null;
    bus.remove(slot.manifest.id);
  };

  const run = (slot: Slot, effects: SupervisorEffect[]): void => {
    for (const fx of effects) {
      switch (fx.k) {
        case 'terminate':
          terminate(slot);
          break;
        case 'spawn':
          clearTimeout(slot.timer);
          slot.timer = setTimeout(() => {
            slot.timer = undefined;
            // A manual restart or stop while waiting wins (PoC: `if (slot.crashed)`).
            if (slot.sup.state === 'crashed' || slot.sup.state === 'restarting') start(slot);
          }, fx.afterMs);
          break;
        case 'reportError':
          emit('isolate:error', { id: slot.manifest.id, message: fx.message });
          break;
      }
    }
  };

  const feed = (slot: Slot, input: SupervisorInput): void => {
    const prev = slot.sup;
    const { s, effects } = step(prev, input, cfg);
    slot.sup = s;
    if (s.state === 'crashed' && prev.state !== 'crashed') {
      emit('isolate:crash', { id: slot.manifest.id, message: s.error ?? '', restarts: s.restarts });
    }
    if (s.state !== prev.state) {
      emit('isolate:state', { id: slot.manifest.id, state: s.state, prev: prev.state });
    }
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
          feed(slot, { k: 'error', fatal: msg.p.fatal, message: msg.p.message });
          return;
        case 'call':
          // Host calls arrive in M1.
          slot.dropped++;
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
    const loaded = load({
      bootstrapUrl: config.workers.isolateBootstrap,
      id: manifest.id,
      src: manifest.src,
      config: manifest.config ?? null,
      grants: manifest.grants ?? DEFAULT_GRANTS,
      renderFmt: manifest.surface ? LEGACY_VDOM : 'none',
      heartbeatMs: everyMs,
    });
    loaded.worker.addEventListener('message', (e: MessageEvent<unknown>) => {
      if (slot.loaded === loaded) onMessage(slot, e.data);
    });
    loaded.worker.addEventListener('error', (e) => {
      e.preventDefault();
      if (slot.loaded === loaded)
        feed(slot, { k: 'workerError', message: e.message || 'Unknown error' });
    });
    slot.loaded = loaded;
    feed(slot, { k: 'spawned', at: performance.now() });
  };

  const tick = setInterval(() => {
    const at = performance.now();
    for (const slot of slots.values()) feed(slot, { k: 'tick', at });
  }, everyMs);

  const get = (id: string): Slot => {
    const slot = slots.get(id);
    if (!slot) throw new Error(`No isolate "${id}"`);
    return slot;
  };

  const snapshot = (slot: Slot): IsolateSnapshot => {
    const { state, lastBeatAt, lagMs, restarts, error } = slot.sup;
    const surface = compositor.stats(slot.manifest.id);
    return {
      id: slot.manifest.id,
      state,
      lastBeatAt,
      lagMs,
      restarts,
      dropped: slot.dropped,
      ...(error === undefined ? {} : { error }),
      ...(surface === undefined ? {} : { surface }),
    };
  };

  const kernel: Kernel = {
    spawn(manifest) {
      if (slots.has(manifest.id)) throw new Error(`Isolate "${manifest.id}" already exists`);
      const slot: Slot = {
        manifest,
        sup: initialSupervision(performance.now()),
        loaded: null,
        timer: undefined,
        dropped: 0,
      };
      slots.set(manifest.id, slot);
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
      compositor.detach(id);
      slots.delete(id);
      return Promise.resolve();
    },

    restart(id) {
      feed(get(id), { k: 'restart' });
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
      await Promise.all([...slots.keys()].map((id) => kernel.stop(id)));
    },
  };
  return kernel;
}
