/*
 * The inspection feed (ADR 0020): one feed underneath every `Inspector`. It
 * reads what the kernel already emits and keeps no second source of truth:
 * the kernel hands it each event, beat and bus metric, and it answers
 * `snapshot()` from the kernel's own getters.
 *
 * - Events go to readers at once and into a ring buffer of the last 200,
 *   kept from the kernel's start whether anything inspects or not
 *   (decision 5).
 * - Beats and bus metrics are coalesced: the latest of each per isolate, sent
 *   about once a second, and only while a reader listens (decision 2).
 */
import {
  INSPECT_COALESCE_MS,
  INSPECT_RING_SIZE,
  PROTOCOL,
  type BusMetrics,
  type InspectBeat,
  type InspectEvent,
  type InspectIsolate,
  type InspectMessage,
  type InspectPool,
  type InspectSnapshot,
} from '@isoloop/protocol';

/**
 * A reader of the inspection feed (ADR 0020, decision 1), from
 * `kernel.inspect()`. Every message is plain, structured-cloneable data, the
 * same as an isolate with the `inspect` grant gets over its port.
 * @experimental
 */
export interface Inspector {
  /** Isolates, pools, the bus, and the last 200 events. */
  snapshot(): InspectSnapshot;
  /**
   * Feed messages from now on: events at once, beats and bus metrics about
   * once a second. Returns the function that stops them.
   */
  on(fn: (m: InspectMessage) => void): () => void;
  /** Stops every listener of this inspector. Its `snapshot()` still works. */
  close(): void;
}

export type InspectSources = {
  isolates(): InspectIsolate[];
  pools(): InspectPool[];
  /** The bus supervisor's state, or `none` without contracts. */
  busState(): string;
};

/** Events with their own coalesced messages, not sent one by one nor kept. */
const COALESCED = new Set(['isolate:beat', 'bus:metrics']);

export type InspectFeed = {
  /** A kernel event, as the kernel emits it. */
  event(event: string, data: Record<string, unknown>): void;
  /** The bus's latest metrics; kept for the snapshot, sent coalesced while a reader listens. */
  metrics(m: BusMetrics): void;
  /** One isolate's beat; kept only while a reader listens. */
  beat(b: InspectBeat): void;
  /** True while a reader listens: the kernel then reports beats. */
  readonly live: boolean;
  open(): Inspector;
  destroy(): void;
};

const reportError = (e: unknown): void => {
  // A reader's bug mustn't stop the kernel's events.
  setTimeout(() => {
    throw e;
  });
};

export function createInspectFeed(src: InspectSources): InspectFeed {
  const ring: InspectEvent[] = [];
  let restarts = 0;
  let lastMetrics: BusMetrics | undefined;
  let pendingMetrics: BusMetrics | undefined;
  const pendingBeats = new Map<string, InspectBeat>();
  const readers = new Set<(m: InspectMessage) => void>();
  let timer: ReturnType<typeof setInterval> | undefined;

  const send = (m: InspectMessage): void => {
    for (const fn of readers) {
      try {
        fn(m);
      } catch (e) {
        reportError(e);
      }
    }
  };

  const flush = (): void => {
    const at = performance.now();
    if (pendingBeats.size > 0) {
      const beats = [...pendingBeats.values()];
      pendingBeats.clear();
      send({ v: PROTOCOL.v, t: 'beats', p: { at, beats } });
    }
    if (pendingMetrics) {
      const p = pendingMetrics;
      pendingMetrics = undefined;
      send({ v: PROTOCOL.v, t: 'metrics', p });
    }
  };

  const listen = (): void => {
    if (readers.size > 0 && timer === undefined) timer = setInterval(flush, INSPECT_COALESCE_MS);
    if (readers.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
      pendingBeats.clear();
      pendingMetrics = undefined;
    }
  };

  const snapshot = (): InspectSnapshot => ({
    at: performance.now(),
    isolates: src.isolates(),
    pools: src.pools(),
    bus: {
      state: src.busState(),
      restarts,
      ...(lastMetrics === undefined ? {} : { metrics: lastMetrics }),
    },
    events: [...ring],
  });

  return {
    event(event, data) {
      // Beats and metrics come through `beat` and `metrics` (the heap isn't in the event).
      if (COALESCED.has(event)) return;
      if (event === 'bus:restart') restarts++;
      const e: InspectEvent = { at: performance.now(), event, data };
      ring.push(e);
      if (ring.length > INSPECT_RING_SIZE) ring.shift();
      if (readers.size > 0) send({ v: PROTOCOL.v, t: 'event', p: e });
    },

    metrics(m) {
      lastMetrics = m;
      if (readers.size > 0) pendingMetrics = m;
    },

    beat(b) {
      if (readers.size > 0) pendingBeats.set(b.id, b);
    },

    get live() {
      return readers.size > 0;
    },

    open() {
      const mine = new Set<(m: InspectMessage) => void>();
      let closed = false;
      return {
        snapshot,
        on(fn) {
          if (closed) return () => {};
          // One entry per call, so the same function added twice gets two stops.
          const entry = (m: InspectMessage): void => fn(m);
          mine.add(entry);
          readers.add(entry);
          listen();
          return () => {
            mine.delete(entry);
            readers.delete(entry);
            listen();
          };
        },
        close() {
          closed = true;
          for (const entry of mine) readers.delete(entry);
          mine.clear();
          listen();
        },
      };
    },

    destroy() {
      readers.clear();
      listen();
    },
  };
}
