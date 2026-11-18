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
  BusError,
  INSPECT_COALESCE_MS,
  INSPECT_RING_SIZE,
  MAX_BLOCK_MS,
  MAX_READ,
  PROTOCOL,
  isIsolateToInspect,
  type BusMetrics,
  type BusToTap,
  type CallResult,
  type InspectControl,
  type InspectRecord,
  type InspectToIsolate,
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
  /**
   * Copies records appended to matching topics to `fn` as they arrive, at most
   * `maxPerSec` a second (default 50), each value cut to a 2 KB preview. A tap
   * isn't a consumer: it isn't in the bus figures. It's opened again after a
   * bus restart; records appended while no bus runs aren't seen. Returns the
   * function that ends it. Throws `bus_unavailable` without contracts.
   */
  tap(o: { topics: string[]; maxPerSec?: number }, fn: (r: InspectRecord) => void): () => void;
  /**
   * The last `last` records of `topic` still retained (at most 100), oldest
   * first, as previews. Rejects with a `BusError`.
   */
  records(topic: string, o: { last: number }): Promise<InspectRecord[]>;
  /**
   * Restarts an isolate: calls `kernel.restart(id)`. Like `kill` and `block`,
   * it rejects for an unknown id, and after `close()`.
   */
  restart(id: string): Promise<void>;
  /**
   * Ends an isolate's worker as a crash (`worker-error`), so the supervisor
   * restarts it like any other. For a pooled isolate that ends the pool's
   * worker: every member crashes and restarts, and the feed shows each one.
   * Resolves once the kill is sent, not when the isolate is back.
   */
  kill(id: string): Promise<void>;
  /**
   * Busy-loops an isolate's worker for `ms` (at most 10 s), so you can watch
   * containment work. For a pooled isolate it blocks the whole worker.
   */
  block(id: string, ms: number): Promise<void>;
  /**
   * Stops every listener and tap of this inspector, and makes its controls
   * reject. Its `snapshot()` still works.
   */
  close(): void;
}

export type InspectSources = {
  isolates(): InspectIsolate[];
  pools(): InspectPool[];
  /** The bus supervisor's state, or `none` without contracts. */
  busState(): string;
  tap(spec: { topics: string[]; maxPerSec?: number }, fn: (m: BusToTap) => void): () => void;
  read(topic: string, last: number): Promise<CallResult>;
  /** Restart, kill or block an isolate; throws for an unknown id. */
  control(action: InspectControl, id: string, ms?: number): void;
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

/** What a control gives after `close()` (ADR 0020, decision 6). */
const closedControl = (): Promise<void> =>
  Promise.reject(new Error('inspector: closed; its controls no longer act'));

function controlOf(
  src: InspectSources,
  action: InspectControl,
  id: string,
  ms?: number,
): Promise<void> {
  try {
    src.control(action, id, ms);
    return Promise.resolve();
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }
}

export function createInspectFeed(src: InspectSources): InspectFeed {
  const ring: InspectEvent[] = [];
  let restarts = 0;
  let lastMetrics: BusMetrics | undefined;
  let pendingMetrics: BusMetrics | undefined;
  const pendingBeats = new Map<string, InspectBeat>();
  const readers = new Set<(m: InspectMessage) => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  /** Set by `destroy`: the kernel is gone, so no inspector listens again. */
  let destroyed = false;

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
      const taps = new Set<() => void>();
      let closed = false;
      return {
        snapshot,
        tap(o, fn) {
          if (closed || destroyed) return () => {};
          const stop = src.tap(
            o.maxPerSec === undefined
              ? { topics: [...o.topics] }
              : { topics: [...o.topics], maxPerSec: o.maxPerSec },
            (m) => {
              if (m.t !== 'record') return;
              try {
                fn(m.p);
              } catch (e) {
                reportError(e);
              }
            },
          );
          const off = (): void => {
            if (taps.delete(off)) stop();
          };
          taps.add(off);
          return off;
        },
        async records(topic, o) {
          const last = Math.min(Math.max(0, Math.floor(o.last)), MAX_READ);
          const r = await src.read(topic, last);
          if (!r.ok) throw new BusError(r.error);
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the bus answers a read with RecordPreview[]
          return r.value as InspectRecord[];
        },
        restart: (id) => (closed || destroyed ? closedControl() : controlOf(src, 'restart', id)),
        kill: (id) => (closed || destroyed ? closedControl() : controlOf(src, 'kill', id)),
        block: (id, ms) =>
          closed || destroyed
            ? closedControl()
            : controlOf(src, 'block', id, Math.min(Math.max(0, ms), MAX_BLOCK_MS)),
        on(fn) {
          if (closed || destroyed) return () => {};
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
          // Each `off` removes itself, so walk a copy.
          for (const off of Array.from(taps)) off();
          for (const entry of mine) readers.delete(entry);
          mine.clear();
          listen();
        },
      };
    },

    destroy() {
      destroyed = true;
      readers.clear();
      listen();
    },
  };
}

/**
 * Serves one isolate's `inspect` port (ADR 0020, decision 6) from an
 * `Inspector`. The port carries the feed only while the isolate listens, so
 * an idle panel costs the feed nothing. Returns the function that ends it.
 */
export function serveInspectPort(port: MessagePort, inspector: Inspector): () => void {
  let off: (() => void) | undefined;
  const taps = new Map<string, () => void>();
  const send = (m: InspectToIsolate): void => {
    port.postMessage(m);
  };
  const reply = (re: string, p: CallResult): void => {
    send({ v: PROTOCOL.v, t: 'result', re, p });
  };
  const fail = (re: string, e: unknown): void => {
    if (e instanceof BusError)
      reply(re, { ok: false, error: { code: e.code, message: e.message } });
    else
      reply(re, {
        ok: false,
        error: { code: 'invalid', message: e instanceof Error ? e.message : String(e) },
      });
  };
  const onMessage = (e: MessageEvent<unknown>): void => {
    const msg = e.data;
    if (!isIsolateToInspect(msg)) return;
    const id = msg.id;
    switch (msg.t) {
      case 'listen':
        off ??= inspector.on(send);
        return;
      case 'unlisten':
        off?.();
        off = undefined;
        return;
      case 'snapshot':
        if (id !== undefined)
          send({ v: PROTOCOL.v, t: 'snapshot', re: id, p: inspector.snapshot() });
        return;
      case 'records':
        if (id === undefined) return;
        inspector.records(msg.p.topic, { last: msg.p.last }).then(
          (value) => reply(id, { ok: true, value }),
          (err: unknown) => fail(id, err),
        );
        return;
      case 'tap': {
        if (id === undefined || taps.has(id)) return;
        try {
          const o = msg.p.maxPerSec === undefined ? { topics: msg.p.topics } : msg.p;
          taps.set(
            id,
            inspector.tap(o, (r) => send({ v: PROTOCOL.v, t: 'record', re: id, p: r })),
          );
          reply(id, { ok: true, value: null });
        } catch (err) {
          fail(id, err);
        }
        return;
      }
      case 'untap':
        if (msg.re !== undefined) {
          taps.get(msg.re)?.();
          taps.delete(msg.re);
        }
        return;
      case 'control': {
        if (id === undefined) return;
        const { action, id: target, ms } = msg.p;
        if (
          typeof target !== 'string' ||
          (action !== 'restart' && action !== 'kill' && action !== 'block')
        ) {
          reply(id, {
            ok: false,
            error: { code: 'invalid', message: 'control: needs an action and an isolate id' },
          });
          return;
        }
        const done =
          action === 'block'
            ? inspector.block(target, typeof ms === 'number' ? ms : 0)
            : action === 'kill'
              ? inspector.kill(target)
              : inspector.restart(target);
        done.then(
          () => reply(id, { ok: true, value: null }),
          (err: unknown) => fail(id, err),
        );
        return;
      }
    }
  };
  port.addEventListener('message', onMessage);
  port.start();
  return () => {
    port.removeEventListener('message', onMessage);
    off?.();
    for (const stop of taps.values()) stop();
    taps.clear();
    port.close();
  };
}
