// #390's table on a synthetic clock: each row drives the machine as the
// kernel would, with a spawn, ready, a beat every 100 ms until the isolate
// hangs, and a tick every 100 ms. Every row reaches `failed`.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUPERVISOR_CONFIG,
  initialSupervision,
  step,
  type IsolateSupervision,
  type SupervisorConfig,
  type SupervisorInput,
} from './machine';

const BEAT_MS = 100;
/** From `new Worker` to `spawned`, and from `spawned` to `ready`. */
const START_MS = 50;

type Failure = { hangsAfterMs: number } | 'never ready';

function simulate(
  cfg: SupervisorConfig,
  failure: Failure,
  untilMs = 900_000,
): { crashes: number; failedAt: number | undefined; error: string | undefined } {
  let s: IsolateSupervision = initialSupervision(0);
  let crashes = 0;
  let spawnAt: number | undefined = 0;
  let readyAt: number | undefined;
  let hangAt = Infinity;
  const feed = (input: SupervisorInput, now: number): void => {
    const out = step(s, input, cfg);
    s = out.s;
    for (const e of out.effects) {
      if (e.k === 'spawn') spawnAt = now + e.afterMs;
      if (e.k === 'emit' && e.event === 'isolate:crash') crashes++;
    }
  };
  for (let now = 0; now <= untilMs; now += 10) {
    if (spawnAt !== undefined && now >= spawnAt + START_MS) {
      spawnAt = undefined;
      feed({ k: 'spawned', at: now }, now);
      readyAt = failure === 'never ready' ? undefined : now + START_MS;
      hangAt = failure === 'never ready' ? Infinity : now + START_MS + failure.hangsAfterMs;
    }
    if (readyAt !== undefined && now >= readyAt && s.state === 'loading') {
      readyAt = undefined;
      feed({ k: 'ready', at: now }, now);
    }
    if (now % BEAT_MS === 0) {
      if ((s.state === 'running' || s.state === 'blocked') && now < hangAt)
        feed({ k: 'beat', at: now, lagMs: 0 }, now);
      feed({ k: 'tick', at: now }, now);
    }
    if (s.state === 'failed') return { crashes, failedAt: now, error: s.error };
  }
  return { crashes, failedAt: undefined, error: s.error };
}

const guide: SupervisorConfig = {
  ...DEFAULT_SUPERVISOR_CONFIG,
  maxRestarts: 5,
  withinMs: 30_000,
  backoff: { initialMs: 500, factor: 2, maxMs: 8000 },
  killAfterMs: 5000,
};
const defaults = DEFAULT_SUPERVISOR_CONFIG;
const hangs = { hangsAfterMs: 300 };

describe("#390's table reaches failed", () => {
  it.each<[string, SupervisorConfig, Failure, number]>([
    ['defaults, hangs', defaults, hangs, 4],
    ['defaults, never ready', defaults, 'never ready', 4],
    ['defaults, hangs 10 s after each start', defaults, { hangsAfterMs: 10_000 }, 4],
    ['defaults + maxRestarts: 6, hangs', { ...defaults, maxRestarts: 6 }, hangs, 7],
    ['defaults + killAfterMs: 30000, hangs', { ...defaults, killAfterMs: 30_000 }, hangs, 4],
    ["the guide's example, hangs", guide, hangs, 6],
    ["the guide's example, never ready", guide, 'never ready', 6],
    [
      "the guide's example with withinMs: 120_000, hangs",
      { ...guide, withinMs: 120_000 },
      hangs,
      6,
    ],
    [
      "the guide's example with withinMs: 120_000, never ready",
      { ...guide, withinMs: 120_000 },
      'never ready',
      6,
    ],
    [
      'readyTimeoutMs: 20000, never ready',
      { ...defaults, readyTimeoutMs: 20_000 },
      'never ready',
      4,
    ],
    ['defaults, hangs 9.5 s after each start', defaults, { hangsAfterMs: 9500 }, 4],
  ])('%s: fails on crash %i', (_, cfg, failure, crashes) => {
    const result = simulate(cfg, failure);
    expect(result.failedAt).toBeDefined();
    expect(result.crashes).toBe(crashes);
  });

  it('fails a 10 s-per-start loop about 80 s after its first start, as the guide says', () => {
    // Each cycle: 10 s running, 10 s without a beat to the kill, then the backoff.
    const { failedAt } = simulate(defaults, { hangsAfterMs: 10_000 });
    expect(failedAt).toBeGreaterThan(80_000);
    expect(failedAt).toBeLessThan(85_000);
  });

  it('names the rule it failed on', () => {
    // Fast: both rules are met, and the window is named.
    expect(simulate(defaults, hangs).error).toBe(
      'No heartbeat for 10000 ms (3 restarts in 60000 ms)',
    );
    // Too slow for the window: only the short runs are.
    expect(simulate(defaults, { hangsAfterMs: 10_000 }).error).toBe(
      'No heartbeat for 10000 ms (4 crashes, each after less than 60000 ms of healthy running)',
    );
  });

  it('still restarts without end an isolate whose runs are each withinMs or longer', () => {
    const result = simulate(defaults, { hangsAfterMs: 61_000 }, 600_000);
    expect(result.failedAt).toBeUndefined();
    expect(result.crashes).toBeGreaterThan(4);
  });
});
