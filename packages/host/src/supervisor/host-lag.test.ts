// The heartbeat clock (ADR 0001, *Heartbeat clock: the host's lag*) on a
// synthetic clock. Workers are driven as the kernel drives them: a tick every
// 50 ms while the host's main thread runs, beats queued while it doesn't and
// heard after the next tick, and the host's lateness from `createHostLag`.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUPERVISOR_CONFIG,
  initialSupervision,
  step,
  WALL_CAP,
  type IsolateSupervision,
  type SupervisorConfig,
  type SupervisorInput,
} from './machine';
import { createHostLag } from './timers';

const TICK_MS = 50;
const BEAT_MS = 100;
/** From a spawn to `spawned`, and from `spawned` to `ready`. */
const START_MS = 50;

type Span = [number, number];
const inSpan = (t: number, spans: readonly Span[]): boolean =>
  spans.some(([s, e]) => t >= s && t < e);

type Page = {
  workers: number;
  /** When worker `w`, started at `startedAt`, beats: `true` to beat on this 100 ms slot. */
  beats: (w: number, now: number, startedAt: number) => boolean;
  /** Whether worker `w` ever sends `ready`. Default yes. */
  ready?: (w: number) => boolean;
  /** Spans where the host's main thread runs nothing. */
  hostStalls?: readonly Span[];
  /** `false` feeds a host lag of 0: wall-clock time, as before the lag clock. */
  lagClock?: boolean;
  untilMs: number;
};

type Result = {
  crashes: { w: number; at: number; reason: string; message: string }[];
  failedAt: (number | undefined)[];
};

function simulate(cfg: SupervisorConfig, page: Page): Result {
  const lag = createHostLag(TICK_MS, 0);
  const sup: IsolateSupervision[] = [];
  const spawnAt: (number | undefined)[] = [];
  const startedAt: number[] = [];
  const readyDue: (number | undefined)[] = [];
  const queued: SupervisorInput['k'][][] = [];
  const result: Result = { crashes: [], failedAt: [] };
  for (let w = 0; w < page.workers; w++) {
    sup.push(initialSupervision(0));
    spawnAt.push(0);
    startedAt.push(0);
    readyDue.push(undefined);
    queued.push([]);
    result.failedAt.push(undefined);
  }
  const hostLag = (): number => (page.lagClock === false ? 0 : lag.total());
  const feed = (w: number, input: SupervisorInput, now: number): void => {
    const out = step(sup[w]!, input, cfg, hostLag());
    sup[w] = out.s;
    for (const e of out.effects) {
      if (e.k === 'spawn') spawnAt[w] = now + e.afterMs;
      if (e.k === 'emit' && e.event === 'isolate:crash')
        result.crashes.push({ w, at: now, reason: e.data.reason, message: e.data.message });
    }
    if (out.s.state === 'failed' && result.failedAt[w] === undefined) result.failedAt[w] = now;
  };
  let lastTick = 0;
  for (let now = 0; now <= page.untilMs; now += 10) {
    const hostRuns = !inSpan(now, page.hostStalls ?? []);
    for (let w = 0; w < page.workers; w++) {
      if (hostRuns && spawnAt[w] !== undefined && now >= spawnAt[w]! + START_MS) {
        spawnAt[w] = undefined;
        startedAt[w] = now;
        feed(w, { k: 'spawned', at: now }, now);
        readyDue[w] = page.ready?.(w) === false ? undefined : now + START_MS;
      }
      const s = sup[w]!;
      if (readyDue[w] !== undefined && now >= readyDue[w]! && s.state === 'loading') {
        readyDue[w] = undefined;
        queued[w]!.push('ready');
      }
      if (
        now % BEAT_MS === 0 &&
        (s.state === 'running' || s.state === 'blocked') &&
        page.beats(w, now, startedAt[w]!)
      )
        queued[w]!.push('beat');
    }
    if (!hostRuns) continue;
    // The tick first when it's due, then the messages that waited: the order
    // that judges a silence longest.
    if (now - lastTick >= TICK_MS) {
      lastTick = now;
      lag.tick(now);
      for (let w = 0; w < page.workers; w++) feed(w, { k: 'tick', at: now }, now);
    }
    for (let w = 0; w < page.workers; w++)
      for (const m of queued[w]!.splice(0))
        feed(w, m === 'ready' ? { k: 'ready', at: now } : { k: 'beat', at: now, lagMs: 0 }, now);
  }
  return result;
}

const kill2s: SupervisorConfig = { ...DEFAULT_SUPERVISOR_CONFIG, killAfterMs: 2000 };
/** The host's main thread runs 100 ms of every 500 ms: late 80 % of the time. */
const starvedHost = (fromMs: number, untilMs: number): Span[] =>
  Array.from({ length: Math.ceil((untilMs - fromMs) / 500) }, (_, i): Span => [
    fromMs + i * 500 + 100,
    fromMs + i * 500 + 500,
  ]);
const always = (): boolean => true;
const HANG_AT = 5000;
/** The hung worker's last beat: the slot before `HANG_AT`. */
const LAST_BEAT = HANG_AT - BEAT_MS;
/** Tolerance on a kill time: two ticks and a beat, plus the stall the host may be in. */
const SLACK = 2 * TICK_MS + BEAT_MS + 400;

describe('createHostLag', () => {
  it('sums how late each tick fired past its interval', () => {
    const lag = createHostLag(50, 0);
    lag.tick(50);
    lag.tick(100);
    expect(lag.total()).toBe(0);
    lag.tick(400); // 250 ms late
    lag.tick(450);
    lag.tick(520); // 20 ms late
    expect(lag.total()).toBe(270);
  });

  it('never counts an early tick against the total', () => {
    const lag = createHostLag(50, 0);
    lag.tick(30);
    lag.tick(60);
    expect(lag.total()).toBe(0);
  });
});

describe('the heartbeat clock leaves out the host lag', () => {
  // Every worker beats only every 4 s of wall-clock time while the host runs
  // 100 ms of every 500 ms: each silence is 4 s on the wall but under 1 s heard.
  const starvedPage: Page = {
    workers: 12,
    beats: (_, now) => now < HANG_AT || now % 4000 === 0,
    hostStalls: starvedHost(HANG_AT, 60_000),
    untilMs: 60_000,
  };

  it('a page starved as a whole kills nothing', () => {
    expect(simulate(kill2s, starvedPage).crashes).toEqual([]);
  });

  it('the same page on wall-clock time kills every worker (the 0.1 behaviour)', () => {
    const r = simulate(kill2s, { ...starvedPage, lagClock: false });
    expect(new Set(r.crashes.map((c) => c.w)).size).toBe(12);
    expect(r.crashes.every((c) => c.reason === 'unresponsive')).toBe(true);
  });

  it.each([
    ['defaults', DEFAULT_SUPERVISOR_CONFIG],
    ['killAfterMs 2000', kill2s],
  ])(
    '%s: a single hung worker on a page that is not starved is killed at killAfterMs',
    (_, cfg) => {
      const r = simulate(cfg, {
        workers: 12,
        beats: (w, now) => w !== 0 || now < HANG_AT,
        untilMs: HANG_AT + cfg.killAfterMs + 1000,
      });
      expect(r.crashes).toHaveLength(1);
      expect(r.crashes[0]).toMatchObject({ w: 0, reason: 'unresponsive' });
      expect(r.crashes[0]!.message).toBe(`No heartbeat for ${cfg.killAfterMs} ms`);
      expect(r.crashes[0]!.at - LAST_BEAT).toBeGreaterThan(cfg.killAfterMs);
      expect(r.crashes[0]!.at - LAST_BEAT).toBeLessThanOrEqual(cfg.killAfterMs + 2 * TICK_MS);
    },
  );

  it.each([
    ['defaults', DEFAULT_SUPERVISOR_CONFIG],
    ['killAfterMs 2000', kill2s],
  ])('%s: a hung worker on a starved page is killed by the wall-clock cap', (_, cfg) => {
    const cap = cfg.killAfterMs * WALL_CAP;
    const r = simulate(cfg, {
      workers: 12,
      beats: (w, now) => w !== 0 || now < HANG_AT,
      hostStalls: starvedHost(HANG_AT, HANG_AT + cap + 5000),
      untilMs: HANG_AT + cap + 2000,
    });
    expect(r.crashes).toHaveLength(1);
    expect(r.crashes[0]).toMatchObject({ w: 0, reason: 'unresponsive' });
    expect(r.crashes[0]!.message).toBe(`No heartbeat for ${cap} ms`);
    expect(r.crashes[0]!.at - LAST_BEAT).toBeGreaterThan(cap);
    expect(r.crashes[0]!.at - LAST_BEAT).toBeLessThanOrEqual(cap + SLACK);
  });

  it('a worker that never sends ready times out at readyTimeoutMs on a page that is not starved', () => {
    const cfg = DEFAULT_SUPERVISOR_CONFIG;
    const r = simulate(cfg, {
      workers: 2,
      beats: always,
      ready: (w) => w !== 0,
      untilMs: cfg.readyTimeoutMs + 1000,
    });
    expect(r.crashes).toHaveLength(1);
    expect(r.crashes[0]).toMatchObject({ w: 0, reason: 'ready_timeout' });
    expect(r.crashes[0]!.message).toBe(`No ready within ${cfg.readyTimeoutMs} ms`);
  });

  it('a worker that never sends ready on a starved page times out at the cap, 3 × readyTimeoutMs', () => {
    const cfg = DEFAULT_SUPERVISOR_CONFIG;
    const cap = cfg.readyTimeoutMs * WALL_CAP;
    const r = simulate(cfg, {
      workers: 2,
      beats: always,
      ready: (w) => w !== 0,
      hostStalls: starvedHost(0, cap + 5000),
      untilMs: cap + 2000,
    });
    expect(r.crashes).toHaveLength(1);
    expect(r.crashes[0]).toMatchObject({ w: 0, reason: 'ready_timeout' });
    expect(r.crashes[0]!.message).toBe(`No ready within ${cap} ms`);
    expect(r.crashes[0]!.at).toBeGreaterThan(cap);
    expect(r.crashes[0]!.at).toBeLessThanOrEqual(cap + START_MS + SLACK);
  });

  it('the busy overlay still follows wall-clock time', () => {
    const s0: IsolateSupervision = {
      ...initialSupervision(0),
      state: 'running',
      lastBeatAt: 0,
      hostLagAtBeat: 0,
    };
    // 500 ms of silence, all of it host lag: blocked on the wall clock, not killed.
    const out = step(s0, { k: 'tick', at: 500 }, DEFAULT_SUPERVISOR_CONFIG, 500);
    expect(out.s.state).toBe('blocked');
  });

  it('coming back from a hidden tab starts the lag over', () => {
    const cfg = kill2s;
    const hidden: IsolateSupervision = {
      ...initialSupervision(0),
      state: 'blocked',
      lastBeatAt: 0,
      hostLagAtBeat: 0,
      hidden: true,
    };
    // Hidden for 60 s with throttled timers: 55 s of lag. Back at 60 s.
    const back = step(hidden, { k: 'visible', at: 60_000 }, cfg, 55_000).s;
    expect(back.hostLagAtBeat).toBe(55_000);
    // 2.5 s later, no beat and no new lag: killed on the normal limit.
    const out = step(back, { k: 'tick', at: 62_500 }, cfg, 55_000);
    expect(out.s.state).not.toBe('blocked');
    const crash = out.effects.find((e) => e.k === 'emit' && e.event === 'isolate:crash');
    expect(crash).toMatchObject({ data: { reason: 'unresponsive' } });
  });
});

// #390's slow crash loop: worker 0 hangs 10 s after each start.
const loop = (hostStalls?: Span[]): Page => ({
  workers: 12,
  beats: (w, now, startedAt) => w !== 0 || now < startedAt + START_MS + 10_000,
  ...(hostStalls === undefined ? {} : { hostStalls }),
  untilMs: 400_000,
});

describe('the restart limit stays on wall-clock time', () => {
  it('the #390 slow crash loop fails on a page that is not starved, as before', () => {
    const r = simulate(DEFAULT_SUPERVISOR_CONFIG, loop());
    expect(r.failedAt[0]).toBeGreaterThan(80_000);
    expect(r.failedAt[0]).toBeLessThan(85_000);
    expect(r.crashes.filter((c) => c.w === 0)).toHaveLength(4);
    expect(r.failedAt.slice(1).every((f) => f === undefined)).toBe(true);
  });

  it('the #390 slow crash loop still fails on a starved page', () => {
    const r = simulate(DEFAULT_SUPERVISOR_CONFIG, loop(starvedHost(0, 400_000)));
    expect(r.failedAt[0]).toBeDefined();
    expect(r.crashes.filter((c) => c.w === 0)).toHaveLength(4);
  });

  it('a raised readyTimeoutMs does not slow a kill after ready (#384)', () => {
    const cfg: SupervisorConfig = { ...DEFAULT_SUPERVISOR_CONFIG, readyTimeoutMs: 20_000 };
    // Hangs 300 ms after each start: each kill comes killAfterMs after the last beat.
    const r = simulate(cfg, {
      workers: 1,
      beats: (_, now, startedAt) => now < startedAt + START_MS + 300,
      untilMs: 150_000,
    });
    const kills = r.crashes.filter((c) => c.reason === 'unresponsive');
    expect(kills.length).toBeGreaterThan(0);
    expect(r.failedAt[0]).toBeDefined();
    expect(r.failedAt[0]).toBeLessThan(50_000);
  });
});
