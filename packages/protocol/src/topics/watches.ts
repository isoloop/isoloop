/*
 * Watches (ADR 0023): `ctx.bus.watch` and `kernel.watch`, the current value
 * per key rather than the stream. Shared by the isolate's bus client and the
 * host's own bus connection (point 31), as the committer is, so both sides
 * follow the same rules.
 *
 * - Every local watch on a topic shares one bus watch per port, on the union
 *   of their keys, or every key when any of them is unfiltered (point 11).
 *   Each `onView` gets only its own keys.
 * - A view is applied when it arrives. A snapshot comes in parts; the parts
 *   with `more` are applied and wait, and `onView` runs once, after the part
 *   without it (points 13 and 18).
 * - Once every local `onView` has settled, the view's `seen` goes out: at once
 *   when the view came less than one commit interval after the one before (a
 *   burst), otherwise in the next `commits` (points 21 and 22).
 * - A change in the union of keys sends a new `watch`, with `have`. The bus
 *   numbers the new watch's views from 1 again, so the topic's `seen` not yet
 *   sent is dropped first, and views of the replaced watch still on their
 *   way are applied but never confirmed (point 13, amended 2026-11-27).
 * - After a bus restart every topic is watched again with `have`. A memory
 *   topic the restart lost comes back as a full snapshot, which clears what
 *   it no longer has (point 23).
 */
import { BusError } from '../errors/bus-error';
import type { CallResult } from '../errors/errors';
import type { BusToIsolate, IsolateToBus, WatchKey } from '../messages/bus';

/** `bus.watch`'s options. @experimental */
export type WatchOptions = {
  /**
   * Watch only these keys; `null` is the key of records with no key. Default:
   * every key the topic retains.
   */
  keys?: readonly (string | null)[];
};

/**
 * Called with each view of a watched topic: `view` holds the current value
 * per key the watch reads, `changed` the keys added, updated or cleared since
 * the last call. Treat both as read-only. The next view waits until this
 * returns, or until its promise settles. @experimental
 */
export type OnView<Out> = (
  view: ReadonlyMap<string | null, Out>,
  changed: ReadonlySet<string | null>,
) => void | Promise<void>;

type Local = {
  keys: ReadonlySet<WatchKey> | undefined;
  onView: OnView<unknown>;
  /** Called once already: later calls carry only changed keys. */
  primed: boolean;
};

/** A view to hand to the local watches, in order. */
type Item = {
  changed: Set<WatchKey>;
  /** The `vseq` to confirm once it's settled; `undefined` for none. */
  vseq: number | undefined;
  burst: boolean;
  /** The watch it belongs to: a `seen` for a replaced one is never sent. */
  gen: number;
};

type Watched = {
  topic: string;
  locals: Set<Local>;
  /** The values held, per key, with the version the bus sent. */
  values: Map<WatchKey, { version: number; value: unknown }>;
  /** The keys of the last `watch` sent; `undefined` for every key. */
  wire: ReadonlySet<WatchKey> | undefined;
  /** Counts the `watch` messages sent on this topic and port. */
  gen: number;
  /** `watch` messages sent whose first view hasn't come: views before it belong to the one replaced. */
  owed: number;
  /** The first snapshot has been handed over: a new local watch can be primed at once. */
  snapped: boolean;
  /** Keys changed by the parts of a snapshot so far. */
  parts: Set<WatchKey> | undefined;
  queue: Item[];
  running: boolean;
  lastViewAt: number | undefined;
  rewatchQueued: boolean;
};

/** What a watch book needs from its connection. @internal */
export type WatchesOptions = {
  send: (msg: IsolateToBus) => void;
  call: (msg: IsolateToBus) => Promise<CallResult>;
  now: () => number;
  onError: (err: unknown) => void;
  /** `KernelConfig.bus.commitIntervalMs`: a view less than this after the one before is a burst. */
  intervalMs: number;
  /** Sends pending commits and `seen` now: the burst rule. */
  flushNow: () => void;
  /** Sends pending `seen` with the next `commits`, within one interval. */
  flushSoon: () => void;
  /** A view came: counts as a delivery for the idle report. */
  delivered: () => void;
};

/** One connection's watches: `bus.watch` on an isolate, `kernel.watch` on the host. @internal */
export type Watches = {
  watch<Out>(topic: string, onView: OnView<Out>, opts?: WatchOptions): () => void;
  receive(msg: Extract<BusToIsolate, { t: 'view' }>): void;
  /** A bus restart: every topic is watched again on the new port, with `have`. */
  reattach(): void;
  /** `seen` not yet sent, cleared: for the next `commits`. */
  takeSeen(): { topic: string; vseq: number }[];
};

/** Makes the watches of one bus connection. @internal */
export function createWatches(o: WatchesOptions): Watches {
  const topics = new Map<string, Watched>();
  /** The highest settled view per topic, not yet sent. */
  const seen = new Map<string, number>();

  const unionOf = (w: Watched): ReadonlySet<WatchKey> | undefined => {
    const union = new Set<WatchKey>();
    for (const l of w.locals) {
      if (!l.keys) return undefined;
      for (const k of l.keys) union.add(k);
    }
    return union;
  };

  const sendWatch = (w: Watched): void => {
    const union = unionOf(w);
    w.wire = union;
    // Keys no longer watched won't be updated: they leave the view.
    if (union) for (const k of w.values.keys()) if (!union.has(k)) w.values.delete(k);
    const gen = ++w.gen;
    w.owed++;
    // The new watch numbers its views from 1 again: a `seen` still pending
    // could confirm the wrong one.
    seen.delete(w.topic);
    const p: Extract<IsolateToBus, { t: 'watch' }>['p'] = { topic: w.topic };
    if (union) p.keys = [...union];
    if (w.values.size > 0) p.have = [...w.values].map(([k, v]) => [k, v.version]);
    void o.call({ v: 1, t: 'watch', p }).then((r) => {
      if (r.ok) return;
      // Refused: the bus kept the watch it had, if any, and sends no view for this one.
      if (topics.get(w.topic) === w && w.gen === gen) w.owed = Math.max(0, w.owed - 1);
      o.onError(new BusError(r.error));
    });
  };

  /** Sends one `watch` for the changes of this task: mounts and unmounts come in groups. */
  const rewatchSoon = (w: Watched): void => {
    if (w.rewatchQueued) return;
    w.rewatchQueued = true;
    queueMicrotask(() => {
      w.rewatchQueued = false;
      if (topics.get(w.topic) !== w || w.locals.size === 0) return;
      if (w.gen === 0 || !sameKeys(unionOf(w), w.wire)) sendWatch(w);
    });
  };

  const viewFor = (w: Watched, l: Local): Map<WatchKey, unknown> => {
    const view = new Map<WatchKey, unknown>();
    if (l.keys) {
      for (const k of l.keys) {
        const v = w.values.get(k);
        if (v) view.set(k, v.value);
      }
    } else {
      for (const [k, v] of w.values) view.set(k, v.value);
    }
    return view;
  };

  const settle = (w: Watched, item: Item): void => {
    if (item.vseq === undefined || topics.get(w.topic) !== w || item.gen !== w.gen) return;
    seen.set(w.topic, Math.max(seen.get(w.topic) ?? 0, item.vseq));
    if (item.burst) o.flushNow();
    else o.flushSoon();
  };

  const drain = async (w: Watched): Promise<void> => {
    if (w.running) return;
    w.running = true;
    while (w.queue.length > 0 && topics.get(w.topic) === w) {
      const item = w.queue.shift();
      if (!item) break;
      const waits: PromiseLike<unknown>[] = [];
      for (const l of w.locals) {
        let changed: Set<WatchKey>;
        if (l.keys) {
          changed = new Set();
          for (const k of item.changed) if (l.keys.has(k)) changed.add(k);
        } else {
          changed = item.changed;
        }
        if (!l.primed) {
          l.primed = true;
          // The first call has every key it holds.
          const view = viewFor(w, l);
          changed = new Set([...changed, ...view.keys()]);
          waits.push(...run(l, view, changed));
        } else if (changed.size > 0) {
          waits.push(...run(l, viewFor(w, l), changed));
        }
      }
      // A view several local watches share is settled when all of them are (point 21).
      // oxlint-disable-next-line no-await-in-loop -- one view at a time, in order, by design
      if (waits.length > 0) await Promise.allSettled(waits);
      settle(w, item);
    }
    w.running = false;
  };

  const run = (
    l: Local,
    view: Map<WatchKey, unknown>,
    changed: Set<WatchKey>,
  ): PromiseLike<unknown>[] => {
    try {
      const done = l.onView(view, changed);
      if (isThenable(done)) {
        return [
          done.then(undefined, (err: unknown) => {
            o.onError(err);
          }),
        ];
      }
    } catch (err) {
      o.onError(err);
    }
    return [];
  };

  return {
    watch(topic, onView, opts = {}) {
      let w = topics.get(topic);
      if (!w) {
        w = {
          topic,
          locals: new Set(),
          values: new Map(),
          wire: undefined,
          gen: 0,
          owed: 0,
          snapped: false,
          parts: undefined,
          queue: [],
          running: false,
          lastViewAt: undefined,
          rewatchQueued: false,
        };
        topics.set(topic, w);
      }
      const local: Local = {
        keys: opts.keys ? new Set(opts.keys) : undefined,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the broker validated every value against the topic's schema
        onView: onView as OnView<unknown>,
        primed: false,
      };
      const before = w.gen === 0 ? undefined : w.wire;
      w.locals.add(local);
      const ready = w.gen > 0 && w.snapped && sameKeys(unionOf(w), before);
      if (ready) {
        // The bus watch already covers its keys: it starts from the values held.
        w.queue.push({ changed: new Set(), vseq: undefined, burst: false, gen: w.gen });
        void drain(w);
      } else {
        rewatchSoon(w);
      }
      const mine = w;
      return () => {
        if (!mine.locals.delete(local) || topics.get(topic) !== mine) return;
        if (mine.locals.size > 0) {
          rewatchSoon(mine);
          return;
        }
        topics.delete(topic);
        seen.delete(topic);
        if (mine.gen > 0) o.send({ v: 1, t: 'unwatch', p: { topic } });
      };
    },

    receive(msg) {
      const w = topics.get(msg.p.topic);
      if (!w) return;
      o.delivered();
      const t = o.now();
      if (msg.p.vseq === 1 && w.owed > 0) w.owed--;
      const current = w.owed === 0;
      const changed = w.parts ?? new Set<WatchKey>();
      for (const k of msg.p.cleared ?? []) if (w.values.delete(k)) changed.add(k);
      for (const v of msg.p.values) {
        if (w.wire && !w.wire.has(v.key)) continue;
        w.values.set(v.key, { version: v.version, value: v.value });
        changed.add(v.key);
      }
      if (msg.p.more) {
        w.parts = changed;
        return;
      }
      w.parts = undefined;
      const burst =
        o.intervalMs === 0 || (w.lastViewAt !== undefined && t - w.lastViewAt < o.intervalMs);
      w.lastViewAt = t;
      if (current) w.snapped = true;
      w.queue.push({ changed, vseq: current ? msg.p.vseq : undefined, burst, gen: w.gen });
      void drain(w);
    },

    reattach() {
      seen.clear();
      for (const w of topics.values()) {
        // The old port's views are gone with it.
        w.owed = 0;
        w.parts = undefined;
        w.lastViewAt = undefined;
        if (w.locals.size > 0) sendWatch(w);
      }
    },

    takeSeen() {
      const out = [...seen].map(([topic, vseq]) => ({ topic, vseq }));
      seen.clear();
      return out;
    },
  };
}

/** Two key sets with the same keys; `undefined` is every key. */
function sameKeys(
  a: ReadonlySet<WatchKey> | undefined,
  b: ReadonlySet<WatchKey> | undefined,
): boolean {
  if (!a || !b) return a === b;
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

/** True for anything with a `then` method. @internal */
export function isThenable(x: unknown): x is PromiseLike<unknown> {
  return (
    (typeof x === 'object' || typeof x === 'function') &&
    x !== null &&
    typeof (x as { then?: unknown }).then === 'function'
  );
}
