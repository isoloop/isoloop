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
 * sees them: `ctx.inspector`, on a port of its own to the host. It's
 * `undefined` without the grant.
 * @experimental
 */
export type IsolateInspector = {
  /**
   * The feed's state now.
   * @returns Isolates, pools, the bus, and the last 200 events. Once the port
   *   has ended, the last snapshot it got, if any.
   */
  snapshot(): Promise<InspectSnapshot>;
  /**
   * The host's feed messages from now on: events at once, beats and bus
   * metrics about once a second.
   * @param fn Called with each message.
   * @returns The function that stops them.
   */
  on(fn: (m: InspectMessage) => void): () => void;
  /**
   * The last records of a topic still retained, oldest first, as previews.
   * @param topic The topic's name.
   * @param o `last`: how many, at most 100.
   * @returns The records.
   * @throws Rejects with a `BusError` from the bus.
   */
  records(topic: string, o: { last: number }): Promise<InspectRecord[]>;
  /**
   * Records appended to matching topics, as previews. Not a consumer: it
   * isn't in the bus figures.
   * @param o `topics`: names or patterns. `maxPerSec`: at most this many a
   *   second, default 50. `onSkipped`: gets each count of records left out
   *   over the cap, at most once a second.
   * @param fn Called with each record.
   * @returns The function that ends it.
   */
  tap(
    o: { topics: string[]; maxPerSec?: number; onSkipped?: (count: number) => void },
    fn: (r: InspectRecord) => void,
  ): () => void;
  /**
   * Restarts an isolate, as `kernel.restart(id)` does.
   * @param id The isolate's id.
   * @returns Resolves once the restart has started.
   * @throws Rejects for an unknown id, and once the port has ended.
   */
  restart(id: string): Promise<void>;
  /**
   * Ends an isolate's worker as a crash (`worker_error`), so the supervisor
   * restarts it. For a pooled isolate that ends the pool's worker: every
   * member crashes and restarts, and the feed shows each one.
   * @param id The isolate's id.
   * @returns Resolves once the kill is sent, not when the isolate is back.
   * @throws Rejects for an unknown id, and once the port has ended.
   */
  kill(id: string): Promise<void>;
  /**
   * Busy-loops an isolate's worker.
   * @param id The isolate's id.
   * @param ms How long, at most 10 000 (10 s).
   * @returns Resolves once the block is sent.
   * @throws Rejects for an unknown id, and once the port has ended.
   */
  block(id: string, ms: number): Promise<void>;
};

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

const failure = (r: CallResult): BusError | undefined => (r.ok ? undefined : new BusError(r.error));

/** What a control gives once the port has ended (ADR 0020, decision 6). */
const endedError = (): Error => new Error('inspector: its port has ended; controls no longer act');

export function createInspectorClient(): {
  inspector: IsolateInspector;
  /** The port from the host's `inspect` message. */
  attach(port: MessagePort): void;
  /** The port has ended (the isolate is shutting down): controls reject from now on. */
  end(): void;
} {
  let port: MessagePort | null = null;
  let ended = false;
  let lastSnapshot: InspectSnapshot | undefined;
  /** What was asked before the port arrived. */
  const queue: IsolateToInspect[] = [];
  const pending = new Map<string, Pending>();
  const taps = new Map<
    string,
    { fn: (r: InspectRecord) => void; onSkipped: ((count: number) => void) | undefined }
  >();
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
      if (msg.re !== undefined) taps.get(msg.re)?.fn(msg.p);
      return;
    }
    if (msg.t === 'skipped') {
      if (msg.re !== undefined) taps.get(msg.re)?.onSkipped?.(msg.p.count);
      return;
    }
    if (msg.re !== undefined) {
      const p = pending.get(msg.re);
      if (!p) return;
      pending.delete(msg.re);
      if (msg.t === 'snapshot') {
        lastSnapshot = msg.p;
        p.resolve(msg.p);
      } else if (msg.t === 'result') {
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
    if (ended) throw endedError();
    await ask({ t: 'control', p: ms === undefined ? { action, id } : { action, id, ms } }).done;
  };

  const inspector: IsolateInspector = {
    async snapshot() {
      if (ended) {
        if (lastSnapshot) return lastSnapshot;
        throw endedError();
      }
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
      taps.set(id, { fn, onSkipped: o.onSkipped });
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

  const client = {
    inspector,
    attach(p: MessagePort) {
      if (port) return;
      port = p;
      p.addEventListener('message', onMessage);
      // Where the engine reports it (Chromium), the host closing the port ends it too.
      p.addEventListener('close', () => {
        client.end();
      });
      p.start();
      for (const m of queue.splice(0)) p.postMessage(m);
    },
    end() {
      if (ended) return;
      ended = true;
      queue.length = 0;
      for (const p of pending.values()) p.reject(endedError());
      pending.clear();
      taps.clear();
      listeners.clear();
      port?.removeEventListener('message', onMessage);
      port?.close();
    },
  };
  return client;
}
