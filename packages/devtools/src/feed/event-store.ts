/*
 * The kernel's events for this page session (up to `PER_SESSION`), and for the last few before
 * it. The inspection feed keeps only its last 200 events, and start-up alone
 * can use them; the panel's worker is subscribed from the first moment, so it
 * keeps them: in memory for this session (what the Events tab reads), and
 * in IndexedDB for the next sessions to look back at (a crash that ended in a
 * reload, say). Storage is best-effort like the panel's settings: without it
 * the tab shows this session from memory and nothing else.
 *
 * Limits: this session and the last `KEEP_SESSIONS` before it, `PER_SESSION`
 * events each (the oldest go first), so at most
 * `(KEEP_SESSIONS + 1) * PER_SESSION` events are stored.
 */
import type { InspectEvent } from '@isoloop/protocol';
import type { IsolateInspector } from '@isoloop/runtime';
import { levelOfEvent } from './event-level';
import { database, EVENTS_STORE, SESSIONS_STORE, settle } from '../panel/persist';

/** How many earlier sessions are kept besides the current one. */
export const KEEP_SESSIONS = 3;
export const PER_SESSION = 6_000;

/** How long events wait to be written together. Problems are written at once. */
const FLUSH_MS = 250;

/**
 * An event as stored: `wall` is the wall-clock time it was recorded; `n` counts
 * the events of its session in the order they were recorded (what
 * acknowledging marks).
 */
export type StoredEvent = InspectEvent & { wall: number; n?: number };

export type SessionInfo = { id: string; started: number; count: number };

type Row = StoredEvent & { id?: number; session: string };

type SessionRow = { id: string; started: number };

const isSession = (v: unknown): v is SessionRow =>
  typeof v === 'object' &&
  v !== null &&
  typeof Reflect.get(v, 'id') === 'string' &&
  typeof Reflect.get(v, 'started') === 'number';

const isRow = (v: unknown): v is Row =>
  typeof v === 'object' &&
  v !== null &&
  typeof Reflect.get(v, 'at') === 'number' &&
  typeof Reflect.get(v, 'event') === 'string' &&
  typeof Reflect.get(v, 'wall') === 'number' &&
  ['number', 'undefined'].includes(typeof Reflect.get(v, 'n')) &&
  typeof Reflect.get(v, 'data') === 'object';

/** The recorder: see `createRecorder`. */
export type Recorder = {
  session: string;
  started: number;
  add(events: readonly InspectEvent[], wall?: number): void;
  /** This session's events, oldest first. */
  events(): readonly StoredEvent[];
  /** Problem events not yet acknowledged. */
  unacknowledged(): number;
  /** Whether this event came after the last acknowledgement. */
  isNew(e: StoredEvent): boolean;
  /** Marks every event so far as seen. */
  acknowledge(): void;
  /**
   * Starts recording from `inspector`: every event as it comes, and the ring it
   * already holds (what happened before the panel connected). Returns a stop.
   */
  start(inspector: IsolateInspector): () => void;
  /** This and the earlier sessions kept in storage, newest first. */
  sessions(): Promise<SessionInfo[]>;
  /** One stored session's events, oldest first. */
  load(id: string): Promise<StoredEvent[]>;
  /** Forgets everything stored, this session's and the earlier ones. */
  clear(): Promise<void>;
};

const keyOf = (e: InspectEvent): string => `${e.at} ${e.event} ${JSON.stringify(e.data)}`;

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve) => {
    for (const type of ['complete', 'error', 'abort']) {
      tx.addEventListener(type, () => {
        resolve();
      });
    }
  });

export function createRecorder(): Recorder {
  const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const started = Date.now();
  /** This session's events, oldest first. */
  let mem: StoredEvent[] = [];
  const seen = new Set<string>();
  let pending: StoredEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let written = 0;
  let seq = 0;
  let acked = 0;
  let ready: Promise<boolean> | undefined;

  /** Opens storage, notes this session and drops the sessions beyond the last few before it. */
  const open = (): Promise<boolean> => {
    ready ??= (async () => {
      try {
        const d = await database();
        const tx = d.transaction([SESSIONS_STORE, EVENTS_STORE], 'readwrite');
        const sessions = tx.objectStore(SESSIONS_STORE);
        sessions.put({ id: session, started });
        const all = (await settle(sessions.getAll())).filter(isSession);
        const old = all.toSorted((a, b) => b.started - a.started).slice(KEEP_SESSIONS + 1);
        const events = tx.objectStore(EVENTS_STORE).index('session');
        for (const s of old) {
          sessions.delete(s.id);
          const cursor = events.openKeyCursor(IDBKeyRange.only(s.id));
          cursor.addEventListener('success', () => {
            const c = cursor.result;
            if (!c) return;
            tx.objectStore(EVENTS_STORE).delete(c.primaryKey);
            c.continue();
          });
        }
        await done(tx);
        return true;
      } catch {
        return false;
      }
    })();
    return ready;
  };

  const flush = async (): Promise<void> => {
    timer = undefined;
    const batch = pending;
    pending = [];
    if (batch.length === 0 || !(await open())) return;
    try {
      const d = await database();
      const tx = d.transaction(EVENTS_STORE, 'readwrite');
      const store = tx.objectStore(EVENTS_STORE);
      for (const e of batch) store.add({ ...e, session } satisfies Row);
      written += batch.length;
      if (written > PER_SESSION) {
        // Past the cap: the oldest of this session go, so no more than `PER_SESSION` stay.
        let drop = written - PER_SESSION;
        written = PER_SESSION;
        const cursor = store.index('session').openKeyCursor(IDBKeyRange.only(session));
        cursor.addEventListener('success', () => {
          const c = cursor.result;
          if (!c || drop <= 0) return;
          drop -= 1;
          store.delete(c.primaryKey);
          c.continue();
        });
      }
      await done(tx);
    } catch {
      // Storage unavailable or full: this session stays in memory.
    }
  };

  const schedule = (urgent: boolean): void => {
    if (urgent) {
      if (timer !== undefined) clearTimeout(timer);
      void flush();
    } else timer ??= setTimeout(() => void flush(), FLUSH_MS);
  };

  /** Records events not seen yet; the same event arriving twice (live and in a snapshot) counts once. */
  const add = (events: readonly InspectEvent[], wall = Date.now()): void => {
    let urgent = false;
    let changed = false;
    for (const e of events) {
      const k = keyOf(e);
      if (seen.has(k)) continue;
      seen.add(k);
      const stored: StoredEvent = { ...e, wall, n: ++seq };
      mem.push(stored);
      pending.push(stored);
      changed = true;
      const l = levelOfEvent(e);
      if (l === 'bad' || l === 'warn') urgent = true;
    }
    if (!changed) return;
    // Events can arrive out of order (the ring after a live one): keep them by host time.
    mem = mem.toSorted((a, b) => a.at - b.at);
    if (mem.length > PER_SESSION) mem = mem.slice(mem.length - PER_SESSION);
    schedule(urgent);
  };

  return {
    session,
    started,
    add,
    /** This session's events, oldest first. */
    events: (): readonly StoredEvent[] => mem,
    isNew: (e) => (e.n ?? 0) > acked,
    unacknowledged: () =>
      mem.filter((e) => {
        const l = levelOfEvent(e);
        return (l === 'bad' || l === 'warn') && (e.n ?? 0) > acked;
      }).length,
    acknowledge() {
      acked = seq;
    },
    /**
     * Starts recording from `inspector`: every event as it comes, and the ring
     * it already holds (what happened before the panel connected).
     */
    start(inspector: IsolateInspector): () => void {
      const off = inspector.on((m) => {
        if (m.t === 'event') add([m.p]);
      });
      void inspector.snapshot().then(
        (s) => {
          // Events from before now are stamped by their age.
          const now = Date.now();
          for (const e of s.events) add([e], now - Math.max(0, s.at - e.at));
        },
        () => undefined,
      );
      return off;
    },
    /** This and the earlier sessions kept in storage, newest first. */
    async sessions(): Promise<SessionInfo[]> {
      if (!(await open())) return [];
      try {
        const d = await database();
        const tx = d.transaction([SESSIONS_STORE, EVENTS_STORE], 'readonly');
        const all = (await settle(tx.objectStore(SESSIONS_STORE).getAll())).filter(isSession);
        const index = tx.objectStore(EVENTS_STORE).index('session');
        return await Promise.all(
          all
            .toSorted((a, b) => b.started - a.started)
            .map(async (s): Promise<SessionInfo> => ({
              id: s.id,
              started: s.started,
              count: await settle(index.count(IDBKeyRange.only(s.id))),
            })),
        );
      } catch {
        return [];
      }
    },
    /** One stored session's events, oldest first. */
    async load(id: string): Promise<StoredEvent[]> {
      try {
        const d = await database();
        const rows = await settle(
          d
            .transaction(EVENTS_STORE, 'readonly')
            .objectStore(EVENTS_STORE)
            .index('session')
            .getAll(IDBKeyRange.only(id)),
        );
        return rows.filter(isRow).map(({ session: _s, id: _i, ...e }) => e);
      } catch {
        return [];
      }
    },
    /** Forgets everything stored, this session's and the earlier ones. */
    async clear(): Promise<void> {
      mem = [];
      pending = [];
      seen.clear();
      written = 0;
      acked = seq;
      try {
        const d = await database();
        const tx = d.transaction([SESSIONS_STORE, EVENTS_STORE], 'readwrite');
        tx.objectStore(EVENTS_STORE).clear();
        tx.objectStore(SESSIONS_STORE).clear();
        tx.objectStore(SESSIONS_STORE).put({ id: session, started });
        await done(tx);
      } catch {
        // Nothing stored to clear.
      }
    },
  };
}
