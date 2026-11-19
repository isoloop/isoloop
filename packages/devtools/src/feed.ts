/*
 * The panel's view of the inspection feed (ADR 0020): one snapshot, kept
 * current by the feed's messages. Beats, bus metrics and memory figures are
 * merged in as they come; an event is appended to the recent events and
 * fetches a fresh snapshot shortly after, for the isolate and pool states it
 * changed. Message types this build doesn't know are ignored (decision 7).
 */
import type {
  InspectMessage,
  InspectSnapshot,
  InspectIsolate,
  InspectEvent,
} from '@isoloop/protocol';
import type { IsolateInspector } from '@isoloop/runtime';
import { useEffect, useState } from 'preact/hooks';

const RING = 200;

/** How long after an event the panel asks for a fresh snapshot. */
export const REFRESH_MS = 100;

/** `snap` with one feed message applied. Pure. */
export function applyMessage(snap: InspectSnapshot, m: InspectMessage): InspectSnapshot {
  switch (m.t) {
    case 'snapshot':
      return m.p;
    case 'event': {
      const events: InspectEvent[] = [...snap.events, m.p].slice(-RING);
      return { ...snap, events };
    }
    case 'beats': {
      const byId = new Map(m.p.beats.map((b) => [b.id, b]));
      const isolates = snap.isolates.map((i): InspectIsolate => {
        const b = byId.get(i.id);
        if (!b) return i;
        const next: InspectIsolate = { ...i, lagMs: b.lagMs, lastBeatAt: b.at };
        if (b.busyMs !== undefined) next.busyMs = b.busyMs;
        return next;
      });
      return { ...snap, isolates };
    }
    case 'metrics':
      return { ...snap, bus: { ...snap.bus, metrics: m.p } };
    case 'memory': {
      const byId = new Map(m.p.isolates.map((x) => [x.id, x.memory]));
      const isolates = snap.isolates.map((i): InspectIsolate => {
        const memory = byId.get(i.id);
        return memory ? { ...i, memory } : i;
      });
      return { ...snap, isolates };
    }
    default:
      return snap;
  }
}

/**
 * The feed as state: `undefined` until the first snapshot arrives (and for
 * good without an inspector).
 */
export function useFeed(inspector: IsolateInspector | undefined): InspectSnapshot | undefined {
  const [snap, setSnap] = useState<InspectSnapshot | undefined>(undefined);
  useEffect(() => {
    if (!inspector) return undefined;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = (): void => {
      timer = undefined;
      inspector.snapshot().then(
        (s) => {
          if (alive) setSnap(s);
        },
        () => {
          // The port has ended: the isolate is shutting down.
        },
      );
    };
    const off = inspector.on((m) => {
      setSnap((s) => (s ? applyMessage(s, m) : s));
      if (m.t === 'event' && timer === undefined) timer = setTimeout(refresh, REFRESH_MS);
    });
    refresh();
    return () => {
      alive = false;
      off();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [inspector]);
  return snap;
}

/**
 * The closed button's dot ([M4b plan](../../../docs/plans/m4b-devtools.md),
 * devtools decision 8): red once an isolate has `failed`, amber while one is
 * `restarting`, `crashed` or `blocked`.
 */
export type Health = 'ok' | 'unwell' | 'failed';

const UNWELL = new Set(['restarting', 'crashed', 'blocked']);

export function healthOf(snap: InspectSnapshot | undefined): Health {
  if (!snap) return 'ok';
  if (snap.isolates.some((i) => i.state === 'failed')) return 'failed';
  return snap.isolates.some((i) => UNWELL.has(i.state)) ? 'unwell' : 'ok';
}
