/*
 * `ctx.inspector` (ADR 0020, decision 6): the inspection feed for an isolate
 * holding the `inspect` grant, on a port of its own to the host. It mirrors
 * the host's `Inspector`, except that everything crossing the port is
 * asynchronous. The port arrives in an `inspect` message just after `init`;
 * what the isolate asks before then waits for it.
 */
import {
  BusError,
  isInspectToIsolate,
  type CallResult,
  type InspectMessage,
  type InspectRecord,
  type InspectSnapshot,
  type IsolateToInspect,
} from '@isoloop/protocol';

/**
 * The inspection feed and its controls, as an isolate with `inspect: true`
 * sees them (ADR 0020, decision 6). `ctx.inspector` is `undefined` without
 * the grant.
 * @experimental
 */
export type IsolateInspector = {
  /** Isolates, pools, the bus, and the last 200 events. */
  snapshot(): Promise<InspectSnapshot>;
  /**
   * The host's feed messages from now on: events at once, beats and bus
   * metrics about once a second. Returns the function that stops them.
   */
  on(fn: (m: InspectMessage) => void): () => void;
  /** The last `last` retained records of `topic` (at most 100), oldest first, as previews. */
  records(topic: string, o: { last: number }): Promise<InspectRecord[]>;
  /**
   * Records appended to matching topics, at most `maxPerSec` a second
   * (default 50), as previews. Not a consumer: it isn't in the bus figures.
   * Returns the function that ends it.
   */
  tap(o: { topics: string[]; maxPerSec?: number }, fn: (r: InspectRecord) => void): () => void;
  /** Restarts an isolate, as `kernel.restart(id)`. */
  restart(id: string): Promise<void>;
  /** Ends an isolate's worker as a crash; the supervisor restarts it. */
  kill(id: string): Promise<void>;
  /** Busy-loops an isolate's worker for `ms`, at most 10 s. */
  block(id: string, ms: number): Promise<void>;
};

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

const failure = (r: CallResult): BusError | undefined => (r.ok ? undefined : new BusError(r.error));

export function createInspectorClient(): {
  inspector: IsolateInspector;
  /** The port from the host's `inspect` message. */
  attach(port: MessagePort): void;
} {
  let port: MessagePort | null = null;
  /** What was asked before the port arrived. */
  const queue: IsolateToInspect[] = [];
  const pending = new Map<string, Pending>();
  const taps = new Map<string, (r: InspectRecord) => void>();
  const listeners = new Set<(m: InspectMessage) => void>();
  let next = 0;

  const send = (m: IsolateToInspect): void => {
    if (port) port.postMessage(m);
    else queue.push(m);
  };
  const ask = (
    m: Omit<IsolateToInspect, 'id' | 'v'> & { t: IsolateToInspect['t'] },
  ): {
    id: string;
    done: Promise<unknown>;
  } => {
    const id = `i${++next}`;
    const done = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `t` and `p` come from the caller's union member
    send({ v: 1, id, ...m } as IsolateToInspect);
    return { id, done };
  };

  const onMessage = (e: MessageEvent<unknown>): void => {
    const msg = e.data;
    if (!isInspectToIsolate(msg)) return;
    if (msg.t === 'record') {
      if (msg.re !== undefined) taps.get(msg.re)?.(msg.p);
      return;
    }
    if (msg.t === 'skipped') return;
    if (msg.re !== undefined) {
      const p = pending.get(msg.re);
      if (!p) return;
      pending.delete(msg.re);
      if (msg.t === 'snapshot') p.resolve(msg.p);
      else if (msg.t === 'result') {
        const err = failure(msg.p);
        if (err) p.reject(err);
        else p.resolve(msg.p.ok ? msg.p.value : undefined);
      }
      return;
    }
    if (msg.t === 'result') return;
    for (const fn of listeners) {
      try {
        fn(msg);
      } catch (err) {
        setTimeout(() => {
          throw err;
        });
      }
    }
  };

  const control = async (action: 'restart' | 'kill' | 'block', id: string, ms?: number) => {
    await ask({ t: 'control', p: ms === undefined ? { action, id } : { action, id, ms } }).done;
  };

  const inspector: IsolateInspector = {
    async snapshot() {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the host answers `snapshot` with one
      return (await ask({ t: 'snapshot', p: {} }).done) as InspectSnapshot;
    },
    on(fn) {
      // One entry per call, so the same function added twice gets two stops.
      const entry = (m: InspectMessage): void => fn(m);
      listeners.add(entry);
      if (listeners.size === 1) send({ v: 1, t: 'listen', p: {} });
      return () => {
        if (!listeners.delete(entry)) return;
        if (listeners.size === 0) send({ v: 1, t: 'unlisten', p: {} });
      };
    },
    async records(topic, o) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the host answers `records` with previews
      return (await ask({ t: 'records', p: { topic, last: o.last } }).done) as InspectRecord[];
    },
    tap(o, fn) {
      const p =
        o.maxPerSec === undefined
          ? { topics: [...o.topics] }
          : { topics: [...o.topics], maxPerSec: o.maxPerSec };
      const { id, done } = ask({ t: 'tap', p });
      taps.set(id, fn);
      let open = true;
      done.catch(() => {
        taps.delete(id);
      });
      return () => {
        if (!open) return;
        open = false;
        taps.delete(id);
        send({ v: 1, t: 'untap', re: id, p: {} });
      };
    },
    restart: (id) => control('restart', id),
    kill: (id) => control('kill', id),
    block: (id, ms) => control('block', id, ms),
  };

  return {
    inspector,
    attach(p) {
      if (port) return;
      port = p;
      p.addEventListener('message', onMessage);
      p.start();
      for (const m of queue.splice(0)) p.postMessage(m);
    },
  };
}
