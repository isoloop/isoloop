// SPIKE #389 (not for main): N workers on a synthetic clock, driven as the
// kernel drives them, under the four variants (none, a, b, a+b). Prints a
// table of kill times; the asserts are the must-haves.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUPERVISOR_CONFIG,
  initialSupervision,
  step,
  type IsolateSupervision,
  type SupervisorConfig,
} from './machine';
import { siblingHold } from './spike';

const TICK = 50;
const BEAT = 100;
const START = 50;
type Variant = { a: boolean; b: boolean };
const VARIANTS: Record<string, Variant> = {
  none: { a: false, b: false },
  a: { a: true, b: false },
  b: { a: false, b: true },
  ab: { a: true, b: true },
};
type Span = [number, number];
type Scenario = {
  workers: number;
  /** Per worker: spans with no beats (starved or hung); Infinity end = hung for good. */
  silent: (w: number, startedAt: number) => Span[];
  /** Spans where the host's main thread runs nothing. */
  hostStall?: Span[];
  untilMs: number;
};
type Out = { crashes: number[]; firstKill: number[]; failedAt: (number | undefined)[] };

const inSpan = (t: number, spans: Span[]): boolean => spans.some(([s, e]) => t >= s && t < e);

function simulate(cfg: SupervisorConfig, v: Variant, sc: Scenario): Out {
  const sup: IsolateSupervision[] = [];
  const spawnAt: (number | undefined)[] = [];
  const startedAt: number[] = [];
  const readyAt: (number | undefined)[] = [];
  const queued: number[][] = [];
  const out: Out = { crashes: [], firstKill: [], failedAt: [] };
  for (let w = 0; w < sc.workers; w++) {
    sup.push(initialSupervision(0));
    spawnAt.push(0);
    startedAt.push(0);
    readyAt.push(undefined);
    queued.push([]);
    out.crashes.push(0);
    out.firstKill.push(NaN);
    out.failedAt.push(undefined);
  }
  let stall = 0;
  let prevTick = 0;
  const clock = (now: number): number => (v.b ? now - stall : now);
  const feed = (w: number, input: Parameters<typeof step>[1], now: number): void => {
    const r = step(sup[w]!, input, cfg);
    sup[w] = r.s;
    for (const e of r.effects) {
      if (e.k === 'spawn') spawnAt[w] = now + e.afterMs;
      if (e.k === 'emit' && e.event === 'isolate:crash') {
        out.crashes[w]!++;
        if (Number.isNaN(out.firstKill[w])) out.firstKill[w] = now;
      }
    }
    if (r.s.state === 'failed' && out.failedAt[w] === undefined) out.failedAt[w] = now;
  };
  for (let now = 0; now <= sc.untilMs; now += 10) {
    const hostRuns = !inSpan(now, sc.hostStall ?? []);
    for (let w = 0; w < sc.workers; w++) {
      // Worker side: start, ready, beats (queued for the host).
      if (spawnAt[w] !== undefined && now >= spawnAt[w]! + START && hostRuns) {
        spawnAt[w] = undefined;
        startedAt[w] = now;
        feed(w, { k: 'spawned', at: clock(now) }, now);
        readyAt[w] = now + START;
      }
      const s = sup[w]!;
      const quiet = inSpan(now, sc.silent(w, startedAt[w]!));
      if (readyAt[w] !== undefined && now >= readyAt[w]! && !quiet && s.state === 'loading') {
        readyAt[w] = undefined;
        queued[w]!.push(-1);
      }
      if (now % BEAT === 0 && !quiet && (s.state === 'running' || s.state === 'blocked'))
        queued[w]!.push(now);
    }
    if (!hostRuns) continue;
    // Host side: the tick first if it's due (the worst order), then the queued messages.
    if (now - prevTick >= TICK) {
      stall += Math.max(0, now - prevTick - TICK);
      prevTick = now;
      const hold = v.a
        ? siblingHold(
            sup.map((s, w) => ({ worker: String(w), sup: s })),
            clock(now),
            cfg.blockedAfterMs,
            { share: 0.5, cap: 3 },
          )
        : undefined;
      for (let w = 0; w < sc.workers; w++) feed(w, { k: 'tick', at: clock(now), hold }, now);
    }
    for (let w = 0; w < sc.workers; w++) {
      for (const m of queued[w]!.splice(0))
        feed(w, m === -1 ? { k: 'ready', at: clock(now) } : { k: 'beat', at: clock(now), lagMs: 0 }, now);
    }
  }
  return out;
}

const cfgs: Record<string, SupervisorConfig> = {
  'killAfterMs 10000': DEFAULT_SUPERVISOR_CONFIG,
  'killAfterMs 2000': { ...DEFAULT_SUPERVISOR_CONFIG, killAfterMs: 2000 },
};
const none: Span[] = [];
const HANG = 5000;
const scenarios: Record<string, Scenario> = {
  'one worker hangs for good, 11 beat': {
    workers: 12,
    silent: (w) => (w === 0 ? [[HANG, Infinity]] : none),
    untilMs: 300_000,
  },
  'every worker hangs for good at once': {
    workers: 12,
    silent: () => [[HANG, Infinity]],
    untilMs: 300_000,
  },
  '6 of 12 hang for good at once': {
    workers: 12,
    silent: (w) => (w < 6 ? [[HANG, Infinity]] : none),
    untilMs: 300_000,
  },
  'all workers starved 15 s, host on time': {
    workers: 12,
    silent: () => [[HANG, HANG + 15_000]],
    untilMs: 300_000,
  },
  'host main thread stalled 15 s, workers fine': {
    workers: 12,
    silent: () => none,
    hostStall: [[HANG, HANG + 15_000]],
    untilMs: 300_000,
  },
  'host stalls 1.2 s of every 2 s, workers fine': {
    workers: 12,
    silent: () => none,
    hostStall: Array.from({ length: 30 }, (_, i): Span => [HANG + i * 2000, HANG + i * 2000 + 1200]),
    untilMs: 70_000,
  },
  'host late 75% (150 ms of every 200 ms), worker 0 hangs for good': {
    workers: 12,
    silent: (w) => (w === 0 ? [[HANG, Infinity]] : none),
    hostStall: Array.from({ length: 1500 }, (_, i): Span => [i * 200 + 50, i * 200 + 200]),
    untilMs: 300_000,
  },
  '#390: worker 0 hangs 10 s after each start, 11 beat': {
    workers: 12,
    silent: (w, started) => (w === 0 ? [[started + 10_000, Infinity]] : none),
    untilMs: 300_000,
  },
};

describe('SPIKE #389 simulation', () => {
  const rows: Record<string, string | number>[] = [];
  for (const [cn, cfg] of Object.entries(cfgs))
    for (const [sn, sc] of Object.entries(scenarios))
      for (const [vn, v] of Object.entries(VARIANTS)) {
        const o = simulate(cfg, v, sc);
        const killed = o.firstKill.filter((x) => !Number.isNaN(x));
        rows.push({
          cfg: cn,
          scenario: sn,
          variant: vn,
          'workers killed': killed.length,
          crashes: o.crashes.reduce((x, y) => x + y, 0),
          'w0 first kill, ms after its silence': Number.isNaN(o.firstKill[0]!)
            ? '-'
            : o.firstKill[0]! - (sn.startsWith('#390') ? 10_100 : sn.startsWith('host') ? HANG : HANG),
          'w0 failed at ms': o.failedAt[0] ?? '-',
          'workers failed': o.failedAt.filter((x) => x !== undefined).length,
        });
      }

  it('prints the table', () => {
    console.log(JSON.stringify(rows));
    expect(rows.length).toBeGreaterThan(0);
  });

  for (const [cn, cfg] of Object.entries(cfgs))
    for (const [vn, v] of Object.entries(VARIANTS)) {
      it(`${cn}, ${vn}: a single hung worker is killed within killAfterMs + a tick`, () => {
        const o = simulate(cfg, v, scenarios['one worker hangs for good, 11 beat']!);
        expect(o.firstKill[0]! - HANG).toBeLessThanOrEqual(cfg.killAfterMs + 2 * TICK + BEAT);
      });
      it(`${cn}, ${vn}: the #390 slow crash loop still fails`, () => {
        const o = simulate(cfg, v, scenarios['#390: worker 0 hangs 10 s after each start, 11 beat']!);
        expect(o.failedAt[0]).toBeDefined();
      });
    }
});
