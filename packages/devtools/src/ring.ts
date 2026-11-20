/*
 * The ring around the closed button: a fixed number of checks, each one arc,
 * so it always has the same shape and only a colour changes when something
 * does. The thresholds are a first guess to tune on real pages.
 */
import type { InspectSnapshot } from '@isoloop/protocol';

export type Level = 'ok' | 'unwell' | 'failed' | 'unknown';

export type Check = { id: string; label: string; level: Level };

/** How many arcs the ring has. */
export const RING_SLOTS = 12;

const UNWELL_STATES = new Set(['restarting', 'crashed', 'blocked']);

/** `ok` below `warn`, `unwell` below `bad`, `failed` from `bad` up. */
const by = (value: number, warn: number, bad: number): Level =>
  value < warn ? 'ok' : value < bad ? 'unwell' : 'failed';

const max = (xs: readonly number[]): number => xs.reduce((a, b) => Math.max(a, b), 0);

const unknown = (id: string, label: string): Check => ({ id, label, level: 'unknown' });

/** The ring's checks, always `RING_SLOTS` of them: grey ones while there's no data. */
export function checksOf(snap: InspectSnapshot | undefined): Check[] {
  if (!snap) {
    return Array.from({ length: RING_SLOTS }, (_, i) => unknown(`c${i}`, 'No data yet'));
  }
  const { isolates, pools, bus } = snap;
  const m = bus.metrics;
  const surfaces = isolates.flatMap((i) => (i.surface ? [i.surface] : []));
  const memory = isolates.flatMap((i) => (i.memory ? [i.memory.bytes] : []));
  const rejected = m ? Object.values(m.rejected).reduce<number>((n, v) => n + (v ?? 0), 0) : 0;
  const storage = m?.storage;
  const checks: Check[] = [
    {
      id: 'isolates',
      label: 'Isolates',
      level: isolates.some((i) => i.state === 'failed')
        ? 'failed'
        : isolates.some((i) => UNWELL_STATES.has(i.state))
          ? 'unwell'
          : 'ok',
    },
    { id: 'restarts', label: 'Restarts', level: by(max(isolates.map((i) => i.restarts)), 1, 3) },
    { id: 'lag', label: 'Heartbeat lag', level: by(max(isolates.map((i) => i.lagMs)), 100, 500) },
    {
      id: 'holds',
      label: 'Held isolates',
      level: by(max(isolates.flatMap((i) => (i.holds ?? []).map((h) => h.ageMs))), 1, 1_000),
    },
    {
      id: 'errors',
      label: 'Isolate errors',
      level: isolates.some((i) => i.error !== undefined) ? 'unwell' : 'ok',
    },
    {
      id: 'frames',
      label: 'Dropped or rejected updates',
      level: surfaces.some((s) => s.dropped + s.rejected > 0) ? 'unwell' : 'ok',
    },
    {
      id: 'bus',
      label: 'Bus',
      level:
        bus.state === 'running'
          ? 'ok'
          : bus.state === 'failed'
            ? 'failed'
            : bus.state === 'starting' || bus.state === 'loading'
              ? 'unknown'
              : 'unwell',
    },
    m
      ? { id: 'rejected', label: 'Rejected publishes', level: by(rejected, 1, 100) }
      : unknown('rejected', 'Rejected publishes'),
    m
      ? {
          id: 'consumers',
          label: 'Consumer lag',
          level: by(max(m.subscriptions.map((s) => s.lag)), 100, 1_000),
        }
      : unknown('consumers', 'Consumer lag'),
    storage
      ? {
          id: 'storage',
          label: 'Storage',
          level: by(storage.usage / Math.max(1, storage.quota), 0.7, 0.9),
        }
      : unknown('storage', 'Storage'),
    { id: 'pools', label: 'Pools', level: pools.some((p) => !p.running) ? 'unwell' : 'ok' },
    memory.length > 0
      ? { id: 'memory', label: 'Memory', level: 'ok' }
      : unknown('memory', 'Memory'),
  ];
  return checks;
}

/** One arc: a stretch of isolates, coloured by the worst of them. */
export type Arc = { id: string; label: string; level: Level };

const levelOf = (state: string): Level =>
  state === 'failed'
    ? 'failed'
    : UNWELL_STATES.has(state)
      ? 'unwell'
      : state === 'loading' || state === 'starting'
        ? 'unknown'
        : 'ok';

const RANK: Record<Level, number> = { failed: 3, unwell: 2, ok: 1, unknown: 0 };

/**
 * The ring: the isolates in the order they were spawned, shared out over
 * `RING_SLOTS` arcs (a few to an arc when there are many, one isolate over
 * several arcs when there are few), each arc the worst state among its own.
 * A crash lights the arc its isolate is in, so where on the ring tells you
 * roughly which one.
 */
export function arcsOf(snap: InspectSnapshot | undefined): Arc[] {
  const list = snap?.isolates ?? [];
  const n = list.length;
  return Array.from({ length: RING_SLOTS }, (_, i) => {
    if (n === 0) return { id: `a${i}`, label: 'No isolates yet', level: 'unknown' as const };
    const from = Math.floor((i * n) / RING_SLOTS);
    const to = Math.max(from + 1, Math.floor(((i + 1) * n) / RING_SLOTS));
    const members = list.slice(from, to);
    let level: Level = 'unknown';
    const bad: string[] = [];
    for (const m of members) {
      const l = levelOf(m.state);
      if (RANK[l] > RANK[level]) level = l;
      if (l === 'failed' || l === 'unwell') bad.push(`${m.id} ${m.state}`);
    }
    const first = members[0]?.id ?? '';
    const last = members.at(-1)?.id ?? '';
    const range = first === last ? first : `${first} … ${last}`;
    return { id: `a${i}`, label: bad.length > 0 ? `${range}: ${bad.join(', ')}` : range, level };
  });
}

/** A line for the button's label: how many isolates need attention, and which other checks do. */
export function summaryOf(arcs: readonly Arc[], checks: readonly Check[]): string {
  const bad = arcs.filter((a) => a.level === 'failed').length;
  const warn = arcs.filter((a) => a.level === 'unwell').length;
  const other = checks.filter(
    (c) => c.id !== 'isolates' && (c.level === 'failed' || c.level === 'unwell'),
  );
  const parts = [
    bad > 0 ? `${bad} of ${RING_SLOTS} ring sections failed` : '',
    warn > 0 ? `${warn} of ${RING_SLOTS} ring sections need attention` : '',
    other.length > 0 ? `Also: ${other.map((c) => c.label).join(', ')}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('. ') : 'All checks pass';
}

/** The SVG path of arc `i` of `RING_SLOTS` on a circle. Neighbours overlap a hair so no seam shows. */
export function arcPath(i: number, cx: number, cy: number, r: number): string {
  const step = 360 / RING_SLOTS;
  const gap = -0.8;
  const a0 = ((-90 + i * step + gap / 2) * Math.PI) / 180;
  const a1 = ((-90 + (i + 1) * step - gap / 2) * Math.PI) / 180;
  const p = (a: number): string =>
    `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return `M${p(a0)}A${r} ${r} 0 0 1 ${p(a1)}`;
}
