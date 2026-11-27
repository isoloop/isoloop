import type { BusRecord, BusToIsolate, CallResult, ViewValue, WatchKey } from '@isoloop/protocol';
import type { LogEngine } from '../engine/types';

/** Most values in one part of a snapshot (ADR 0023, point 18). */
export const VIEW_PART = 512;
/** How long a topic's snapshot map outlives its last watch (ADR 0023, point 19). */
export const SNAPSHOT_GRACE_MS = 5_000;
/** Keys an unfiltered watch may hold before dev mode warns (ADR 0023, point 12). */
export const WIDE_WATCH_KEYS = 1_000;
/** Records read from the log per step while a view is built. */
const SCAN_BATCH = 1_024;

/**
 * Who a watch belongs to: one isolate's (or the host's) bus connection.
 * The broker's connections fit this shape.
 *
 * @internal
 */
export type Watcher = {
  readonly isolateId: string;
  readonly port: { post(msg: BusToIsolate): void };
};

/**
 * A watched topic's figures for the metrics sample (ADR 0023, point 25).
 * `records` and `values` count since the bus worker started.
 *
 * @internal
 */
export type WatchStats = {
  topic: string;
  /** Watches on the topic now, from isolates and the host alike. */
  watches: number;
  /** Distinct keys the topic's watches hold now. */
  liveKeys: number;
  /** Records appended while each watch was on the topic, summed over the watches. */
  records: number;
  /** Values sent to watches in views after their snapshot. */
  values: number;
};

/** @internal */
export type WatchBookOptions = {
  engine: LogEngine;
  /** True while the topic seeds: views wait until it opens. */
  seeding: (topic: string) => boolean;
  /** Schedules the snapshot map's drop after the grace. */
  timers: { set(fn: () => void, ms: number): void };
  /** Warns about wide unfiltered watches (point 12). */
  dev: boolean;
};

/** One connection's watch on one topic. */
type Watch = {
  watcher: Watcher;
  topic: string;
  /** The watched keys; `undefined` watches every key. */
  keys: ReadonlySet<WatchKey> | undefined;
  /**
   * Per key, the version (record offset) last sent (point 16). Seeded from
   * `have` before the snapshot.
   */
  sent: Map<WatchKey, number>;
  /** The next offset a view reads from; `undefined` until the snapshot is sent. */
  cursor: number | undefined;
  /** The tail when clears were last looked for. */
  checkedTail: number;
  /** Views sent on this watch: the last one's `vseq`. */
  vseq: number;
  /** The `vseq` whose `seen` the next view waits for (point 17). */
  inFlight: number | undefined;
  /** Records landed, or retention moved, while a view was in flight. */
  news: boolean;
  scheduled: boolean;
  /** A view being built, kept while evicted records are read back from disk. */
  building: Build | undefined;
  paging: boolean;
  warned: boolean;
  /** The topic's head when the watch started: `records` counts from here (point 25). */
  startHead: number;
};

/** A view in progress: the newest record per key read so far. */
type Build = {
  /** The next offset to read. */
  at: number;
  newest: Map<WatchKey, BusRecord>;
  /** Snapshot map entries still to read, and how far that has got. */
  base: [WatchKey, number][] | undefined;
  i: number;
  /** Reads every key, to build the topic's snapshot map. */
  all: boolean;
};

/** The newest retained offset per key, read once on a topic's first watch (point 16). */
type Snapshot = { keys: Map<WatchKey, number>; upTo: number };

type TopicWatches = {
  watches: Set<Watch>;
  snap: Snapshot | undefined;
  /** Bumped when a watch comes or goes, so a stale grace timer does nothing. */
  gen: number;
  /** The tail at the last retention pass. */
  tail: number;
};

/**
 * Watches in the bus worker (ADR 0023, points 13 to 20): the current value
 * per key, sent as `view`s built from the log when they go out, one in
 * flight per watch. An append only notes news for idle watches.
 *
 * @internal
 */
export class WatchBook {
  readonly #engine: LogEngine;
  readonly #seeding: (topic: string) => boolean;
  readonly #timers: WatchBookOptions['timers'];
  readonly #dev: boolean;
  readonly #topics = new Map<string, TopicWatches>();
  readonly #byWatcher = new Map<Watcher, Map<string, Watch>>();
  /**
   * Per topic, kept after its last watch leaves: the counters behind
   * `WatchStats`. `records` holds only the watches that ended; a live watch's
   * share is read from the head at sample time, so an append counts nothing.
   */
  readonly #counts = new Map<string, { records: number; values: number }>();

  constructor(opts: WatchBookOptions) {
    this.#engine = opts.engine;
    this.#seeding = opts.seeding;
    this.#timers = opts.timers;
    this.#dev = opts.dev;
  }

  /**
   * Starts or replaces `watcher`'s watch on `topic`. With `staleHave`, the
   * versions in `have` came from a bus that lost the topic in a restart, so
   * every key the client holds is sent again or cleared.
   */
  watch(
    watcher: Watcher,
    topic: string,
    keys: readonly WatchKey[] | undefined,
    have: readonly (readonly [WatchKey, number])[] | undefined,
    staleHave: boolean,
  ): void {
    const old = this.#byWatcher.get(watcher)?.get(topic);
    if (old) this.#remove(old, false);
    this.#count(topic);
    let tw = this.#topics.get(topic);
    if (!tw) {
      tw = { watches: new Set(), snap: undefined, gen: 0, tail: this.#engine.tail(topic) };
      this.#topics.set(topic, tw);
    }
    const w: Watch = {
      watcher,
      topic,
      keys: keys ? new Set(keys) : undefined,
      sent: new Map((have ?? []).map(([k, v]) => [k, staleHave ? -1 : v])),
      cursor: undefined,
      checkedTail: -1,
      vseq: 0,
      inFlight: undefined,
      news: false,
      scheduled: false,
      building: undefined,
      paging: false,
      warned: false,
      startHead: this.#engine.head(topic),
    };
    tw.watches.add(w);
    tw.gen++;
    let mine = this.#byWatcher.get(watcher);
    if (!mine) this.#byWatcher.set(watcher, (mine = new Map<string, Watch>()));
    mine.set(topic, w);
    this.#schedule(w);
  }

  /** Ends `watcher`'s watch on `topic`, if it has one. */
  unwatch(watcher: Watcher, topic: string): void {
    const w = this.#byWatcher.get(watcher)?.get(topic);
    if (w) this.#remove(w, true);
  }

  /** Ends every watch of a connection going away, and returns their topics. */
  drop(watcher: Watcher): string[] {
    const mine = this.#byWatcher.get(watcher);
    if (!mine) return [];
    const topics = [...mine.keys()];
    for (const w of mine.values()) this.#remove(w, true);
    this.#byWatcher.delete(watcher);
    return topics;
  }

  /**
   * A `seen` from the client's `commits` (point 21): the view numbered
   * `vseq` is settled, so the next one may go out. A `seen` for a watch that
   * has ended, or for a view not sent on this watch, is a race with an
   * `unwatch` or a new `watch`, and is ignored.
   */
  seen(watcher: Watcher, topic: string, vseq: unknown): CallResult {
    if (typeof vseq !== 'number' || !Number.isInteger(vseq) || vseq < 1) {
      return { ok: false, error: { code: 'invalid', message: 'vseq must be a positive integer' } };
    }
    const w = this.#byWatcher.get(watcher)?.get(topic);
    if (!w || vseq > w.vseq || w.inFlight === undefined || vseq < w.inFlight) {
      return { ok: true, value: null };
    }
    w.inFlight = undefined;
    if (w.news) this.#schedule(w);
    return { ok: true, value: null };
  }

  /** A record landed on `topic`: idle watches build a view, busy ones note news (point 14). */
  appended(topic: string): void {
    const tw = this.#topics.get(topic);
    if (!tw) return;
    for (const w of tw.watches) this.#note(w);
  }

  /** The figures of every topic watched now or since the bus worker started. */
  stats(): WatchStats[] {
    const out: WatchStats[] = [];
    for (const [topic, c] of this.#counts) {
      const keys = new Set<WatchKey>();
      let watches = 0;
      let records = c.records;
      const head = this.#engine.head(topic);
      for (const w of this.#topics.get(topic)?.watches ?? []) {
        watches++;
        records += head - w.startHead;
        for (const k of w.sent.keys()) keys.add(k);
      }
      out.push({ topic, watches, liveKeys: keys.size, records, values: c.values });
    }
    return out;
  }

  #count(topic: string): { records: number; values: number } {
    let c = this.#counts.get(topic);
    if (!c) {
      c = { records: 0, values: 0 };
      this.#counts.set(topic, c);
    }
    return c;
  }

  /**
   * The retention pass ran on `topic`. When it moved the tail, each watch
   * looks for keys that fell out, so a clear goes out with no new record
   * (point 16).
   */
  retained(topic: string): void {
    const tw = this.#topics.get(topic);
    if (!tw) return;
    const tail = this.#engine.tail(topic);
    if (tail === tw.tail) return;
    tw.tail = tail;
    for (const w of tw.watches) this.#note(w);
  }

  /** A seed ended: the topic's watches send their snapshots. */
  opened(topic: string): void {
    const tw = this.#topics.get(topic);
    if (!tw) return;
    for (const w of tw.watches) this.#schedule(w);
  }

  #note(w: Watch): void {
    if (w.inFlight !== undefined || w.building) w.news = true;
    else this.#schedule(w);
  }

  #remove(w: Watch, graceful: boolean): void {
    const mine = this.#byWatcher.get(w.watcher);
    if (mine?.get(w.topic) === w) mine.delete(w.topic);
    const tw = this.#topics.get(w.topic);
    if (!tw) return;
    if (tw.watches.delete(w))
      this.#count(w.topic).records += this.#engine.head(w.topic) - w.startHead;
    if (!graceful || tw.watches.size > 0) return;
    const gen = ++tw.gen;
    this.#timers.set(() => {
      if (tw.gen === gen && tw.watches.size === 0) this.#topics.delete(w.topic);
    }, SNAPSHOT_GRACE_MS);
  }

  #current(w: Watch): boolean {
    return this.#byWatcher.get(w.watcher)?.get(w.topic) === w;
  }

  /** Queues one view build per watch per microtask, so records of one task go out together. */
  #schedule(w: Watch): void {
    if (w.scheduled) return;
    w.scheduled = true;
    queueMicrotask(() => {
      w.scheduled = false;
      if (this.#current(w)) this.#run(w);
    });
  }

  /** Reads evicted records back from disk, then goes on with the view. */
  #pageIn(w: Watch, offset: number): void {
    w.paging = true;
    this.#engine.page(w.topic, offset).then(
      () => {
        w.paging = false;
        this.#schedule(w);
      },
      (e: unknown) => {
        // Retried by the next record or retention pass on the topic.
        w.paging = false;
        console.warn(`[isoloop] reading ${w.topic}@${offset} back from disk failed`, e);
      },
    );
  }

  #run(w: Watch): void {
    if (w.inFlight !== undefined) {
      w.news = true;
      return;
    }
    if (w.paging) return;
    if (this.#seeding(w.topic)) return; // `opened` schedules it
    const tw = this.#topics.get(w.topic);
    if (!tw) return;
    const engine = this.#engine;
    const tail = engine.tail(w.topic);
    let b = w.building;
    if (!b) {
      if (w.cursor !== undefined) {
        b = { at: Math.max(w.cursor, tail), newest: new Map(), base: undefined, i: 0, all: false };
      } else if (tw.snap) {
        const base: [WatchKey, number][] = [];
        for (const [k, offset] of tw.snap.keys) {
          if (offset >= tail && (!w.keys || w.keys.has(k))) base.push([k, offset]);
        }
        b = { at: Math.max(tw.snap.upTo, tail), newest: new Map(), base, i: 0, all: false };
      } else {
        b = { at: tail, newest: new Map(), base: undefined, i: 0, all: true };
      }
      w.building = b;
    }
    w.news = false;

    // The snapshot map's entries: read each record back by its offset.
    if (b.base) {
      for (; b.i < b.base.length; b.i++) {
        const entry = b.base[b.i];
        if (!entry) continue;
        const [k, offset] = entry;
        if (!engine.readable(w.topic, offset)) return this.#pageIn(w, offset);
        const rec = engine.read(w.topic, offset, 1)[0];
        // Gone since the map was read, by retention or compaction: a newer
        // record for the key, if any, is in the range read next.
        if (rec?.offset === offset) b.newest.set(k, rec);
      }
    }

    // The log from where the last view read to the tail, newest per key (point 15).
    const head = engine.head(w.topic);
    while (b.at < head) {
      if (!engine.readable(w.topic, b.at)) return this.#pageIn(w, b.at);
      const records = engine.read(w.topic, b.at, SCAN_BATCH);
      const last = records.at(-1);
      if (!last) {
        b.at = head;
        break;
      }
      for (const r of records) {
        const k = r.key ?? null;
        if (b.all || !w.keys || w.keys.has(k)) b.newest.set(k, r);
      }
      b.at = last.offset + 1;
    }
    w.building = undefined;
    if (b.all) {
      const keys = new Map<WatchKey, number>();
      for (const [k, r] of b.newest) keys.set(k, r.offset);
      tw.snap = { keys, upTo: b.at };
    }
    this.#send(w, b, engine.tail(w.topic));
  }

  /** Sends what changed since the last view: values that differ from `sent`, and clears. */
  #send(w: Watch, b: Build, tail: number): void {
    const snapshot = w.cursor === undefined;
    const values: ViewValue[] = [];
    for (const [k, r] of b.newest) {
      if (w.keys && !w.keys.has(k)) continue;
      if (w.sent.get(k) !== r.offset) values.push({ key: k, version: r.offset, value: r.value });
    }
    const cleared: WatchKey[] = [];
    if (snapshot) {
      // `have` lists what the client holds: what the log no longer has is cleared.
      for (const k of w.sent.keys()) {
        if (w.keys && !w.keys.has(k)) w.sent.delete(k);
        else if (!b.newest.has(k)) cleared.push(k);
      }
    } else if (tail !== w.checkedTail) {
      // A key clears when retention removed its newest record (point 4).
      for (const [k, v] of w.sent) if (v < tail && !b.newest.has(k)) cleared.push(k);
    }
    w.checkedTail = tail;
    w.cursor = b.at;
    for (const k of cleared) w.sent.delete(k);
    for (const v of values) w.sent.set(v.key, v.version);
    if (this.#dev && !w.keys && !w.warned && w.sent.size > WIDE_WATCH_KEYS) {
      w.warned = true;
      console.warn(
        `[isoloop] isolate "${w.watcher.isolateId}" watches every key of "${w.topic}" and holds ${w.sent.size} of them, over ${WIDE_WATCH_KEYS}; pass keys to watch only the ones it shows.`,
      );
    }
    if (!snapshot && values.length === 0 && cleared.length === 0) return;
    // The ratio compares records with values that followed them: a snapshot's
    // values were appended before the watch, so they aren't counted.
    if (!snapshot) this.#count(w.topic).values += values.length;
    // The snapshot goes out in parts, back to back; every part but the last
    // has `more`, and only the last waits for `seen` (points 13 and 18). A
    // later view is one message.
    const size = snapshot ? VIEW_PART : Math.max(values.length, 1);
    let i = 0;
    do {
      const part = values.slice(i, i + size);
      const p: Extract<BusToIsolate, { t: 'view' }>['p'] = {
        topic: w.topic,
        vseq: ++w.vseq,
        values: part,
      };
      if (i === 0 && cleared.length > 0) p.cleared = cleared;
      if (i + size < values.length) p.more = true;
      w.watcher.port.post({ v: 1, t: 'view', p });
      i += size;
    } while (i < values.length);
    w.inFlight = w.vseq;
  }
}
