import { describe, expect, it } from 'vitest';
import {
  type CrashReason,
  DEFAULT_SUPERVISOR_CONFIG,
  initialSupervision,
  step,
  type IsolateState,
  type IsolateSupervision,
  type SupervisorConfig,
  type SupervisorEffect,
  type SupervisorInput,
} from './machine';

const cfg: SupervisorConfig = DEFAULT_SUPERVISOR_CONFIG;

const at = (state: IsolateState, extra: Partial<IsolateSupervision> = {}): IsolateSupervision => ({
  ...initialSupervision(0),
  state,
  ...extra,
});

const moved = (prev: IsolateState, state: IsolateState): SupervisorEffect => ({
  k: 'emit',
  event: 'isolate:state',
  data: { state, prev },
});
const crashed = (reason: CrashReason, message: string): SupervisorEffect => ({
  k: 'emit',
  event: 'isolate:crash',
  data: { reason, message },
});

/** Feeds inputs in order, collecting every effect. */
function run(
  s: IsolateSupervision,
  inputs: SupervisorInput[],
  c: SupervisorConfig = cfg,
): { s: IsolateSupervision; effects: SupervisorEffect[] } {
  const effects: SupervisorEffect[] = [];
  for (const input of inputs) {
    const out = step(s, input, c);
    s = out.s;
    effects.push(...out.effects);
  }
  return { s, effects };
}

// One case per row of the transition table (design §4.3), suspension aside (M2).
describe('supervisor transition table', () => {
  it.each<[string, IsolateSupervision, SupervisorInput, Partial<IsolateSupervision>, unknown[]]>([
    [
      'loading → running on ready, emits isolate:ready',
      at('loading'),
      { k: 'ready' },
      { state: 'running' },
      [{ k: 'emit', event: 'isolate:ready', data: {} }, moved('loading', 'running')],
    ],
    [
      'loading → crashed → restarting on a tick past readyTimeoutMs',
      at('loading', { spawnedAt: 0 }),
      { k: 'tick', at: 10_001 },
      { state: 'restarting', reason: 'ready-timeout', restarts: 1 },
      [
        { k: 'terminate' },
        moved('loading', 'crashed'),
        crashed('ready-timeout', 'No ready within 10000 ms'),
        moved('crashed', 'restarting'),
        { k: 'spawn', afterMs: 250 },
      ],
    ],
    [
      'running → blocked on a tick with no beat for blockedAfterMs, shows busy',
      at('running', { lastBeatAt: 0 }),
      { k: 'tick', at: 401 },
      { state: 'blocked' },
      [{ k: 'showBusy' }, moved('running', 'blocked')],
    ],
    [
      'blocked → running on a beat, hides busy',
      at('blocked'),
      { k: 'beat', at: 900, lagMs: 500 },
      { state: 'running', lastBeatAt: 900, lagMs: 500 },
      [{ k: 'hideBusy' }, moved('blocked', 'running')],
    ],
    [
      'blocked → crashed on a tick with no beat for killAfterMs, terminates',
      at('blocked', { lastBeatAt: 0 }),
      { k: 'tick', at: 10_001 },
      { state: 'restarting', reason: 'unresponsive' },
      [
        { k: 'terminate' },
        { k: 'hideBusy' },
        moved('blocked', 'crashed'),
        crashed('unresponsive', 'No heartbeat for 10000 ms'),
        moved('crashed', 'restarting'),
        { k: 'spawn', afterMs: 250 },
      ],
    ],
    [
      'running → crashed on workerError, emits isolate:crash',
      at('running'),
      { k: 'workerError', at: 5, message: 'boom' },
      { state: 'restarting', reason: 'worker-error', error: 'boom', restarts: 1, window: [5] },
      [
        { k: 'terminate' },
        moved('running', 'crashed'),
        crashed('worker-error', 'boom'),
        moved('crashed', 'restarting'),
        { k: 'spawn', afterMs: 250 },
      ],
    ],
    [
      'blocked → crashed on a fatal error',
      at('blocked'),
      { k: 'error', at: 5, fatal: true, message: 'bad' },
      { state: 'restarting', reason: 'error', error: 'bad' },
      [
        { k: 'terminate' },
        { k: 'hideBusy' },
        moved('blocked', 'crashed'),
        crashed('error', 'bad'),
        moved('crashed', 'restarting'),
        { k: 'spawn', afterMs: 250 },
      ],
    ],
    [
      'crashed with restarts in window ≥ max → failed, shows the fallback',
      at('running', { window: [1, 2, 3], restarts: 3 }),
      { k: 'workerError', at: 4, message: 'boom' },
      { state: 'failed', reason: 'worker-error', restarts: 3 },
      [
        { k: 'terminate' },
        moved('running', 'crashed'),
        crashed('worker-error', 'boom'),
        moved('crashed', 'failed'),
        { k: 'showFallback', reason: 'worker-error', message: 'boom' },
        {
          k: 'emit',
          event: 'isolate:failed',
          data: { reason: 'worker-error', message: 'boom' },
        },
      ],
    ],
    [
      'restarting → loading when spawned, clears the crash',
      at('restarting', { reason: 'error', error: 'boom', restarts: 1 }),
      { k: 'spawned', at: 2000 },
      { state: 'loading', spawnedAt: 2000, lastBeatAt: 2000, restarts: 1 },
      [moved('restarting', 'loading')],
    ],
    [
      'running → stopped on stop, shuts down with grace',
      at('running'),
      { k: 'stop' },
      { state: 'stopped' },
      [{ k: 'shutdown', graceMs: 1000 }, moved('running', 'stopped')],
    ],
    [
      'blocked → stopped hides busy',
      at('blocked'),
      { k: 'stop' },
      { state: 'stopped' },
      [{ k: 'hideBusy' }, { k: 'shutdown', graceMs: 1000 }, moved('blocked', 'stopped')],
    ],
    ['failed ignores stop', at('failed'), { k: 'stop' }, { state: 'failed' }, []],
    [
      'failed → restarting on respawn, hides the fallback, resets the window',
      at('failed', { window: [1, 2, 3], restarts: 3, reason: 'error', error: 'x' }),
      { k: 'respawn' },
      { state: 'restarting', window: [], restarts: 3 },
      [{ k: 'hideFallback' }, { k: 'spawn', afterMs: 0 }, moved('failed', 'restarting')],
    ],
    [
      'stopped → restarting on respawn',
      at('stopped'),
      { k: 'respawn' },
      { state: 'restarting' },
      [{ k: 'spawn', afterMs: 0 }, moved('stopped', 'restarting')],
    ],
    [
      'a running isolate can be respawned by hand; it does not count',
      at('running', { window: [1], restarts: 1 }),
      { k: 'respawn' },
      { state: 'restarting', window: [], restarts: 1 },
      [{ k: 'terminate' }, { k: 'spawn', afterMs: 0 }, moved('running', 'restarting')],
    ],
    [
      'any state → crashed on spawnFailed',
      at('restarting'),
      { k: 'spawnFailed', at: 5, message: 'quota' },
      { state: 'restarting', reason: 'spawn-failed', restarts: 1 },
      [
        moved('restarting', 'crashed'),
        crashed('spawn-failed', 'quota'),
        moved('crashed', 'restarting'),
        { k: 'spawn', afterMs: 250 },
      ],
    ],
    [
      'document hidden pauses hang judgement: no busy',
      at('running', { lastBeatAt: 0, hidden: true }),
      { k: 'tick', at: 401 },
      { state: 'running' },
      [],
    ],
    [
      'document hidden pauses hang judgement: no kill',
      at('blocked', { lastBeatAt: 0, hidden: true }),
      { k: 'tick', at: 60_000 },
      { state: 'blocked' },
      [],
    ],
    [
      'document visible resets the heartbeat clock',
      at('running', { lastBeatAt: 0, hidden: true }),
      { k: 'visible', at: 30_000 },
      { state: 'running', hidden: false, lastBeatAt: 30_000 },
      [],
    ],
    [
      'document visible resets the ready clock while loading',
      at('loading', { spawnedAt: 0, hidden: true }),
      { k: 'visible', at: 30_000 },
      { spawnedAt: 30_000, lastBeatAt: 30_000 },
      [],
    ],
    [
      'a non-fatal error is only reported',
      at('running'),
      { k: 'error', at: 5, fatal: false, message: 'meh' },
      { state: 'running', restarts: 0 },
      [{ k: 'emit', event: 'isolate:error', data: { message: 'meh' } }],
    ],
  ])('%s', (_name, s, input, expected, effects) => {
    const out = step(s, input, cfg);
    expect(out.s).toMatchObject(expected);
    expect(out.effects).toEqual(effects);
  });
});

describe('supervisor edges', () => {
  it('clears reason and error on spawn', () => {
    const { s } = run(at('running'), [
      { k: 'workerError', at: 0, message: 'x' },
      { k: 'spawned', at: 300 },
    ]);
    expect(s).not.toHaveProperty('reason');
    expect(s).not.toHaveProperty('error');
  });

  it('ignores a second crash while restarting, and beats once stopped', () => {
    expect(step(at('restarting'), { k: 'workerError', at: 1, message: 'x' }, cfg).effects).toEqual(
      [],
    );
    expect(step(at('stopped'), { k: 'beat', at: 9, lagMs: 0 }, cfg).s.lastBeatAt).toBe(0);
  });

  it('never judges silence up to the thresholds', () => {
    expect(step(at('running', { lastBeatAt: 0 }), { k: 'tick', at: 400 }, cfg).s.state).toBe(
      'running',
    );
    expect(step(at('blocked', { lastBeatAt: 0 }), { k: 'tick', at: 10_000 }, cfg).s.state).toBe(
      'blocked',
    );
    expect(step(at('loading', { spawnedAt: 0 }), { k: 'tick', at: 10_000 }, cfg).s.state).toBe(
      'loading',
    );
  });
});

const crashAt = (t: number): SupervisorInput[] => [
  { k: 'workerError', at: t, message: 'boom' },
  { k: 'spawned', at: t },
  { k: 'ready' },
];
const spawns = (effects: SupervisorEffect[]): number[] =>
  effects.flatMap((e) => (e.k === 'spawn' ? [e.afterMs] : []));

describe('restart policy (fake clock)', () => {
  it('restarts 3 times in 60 s with backoff, then fails', () => {
    const { s, effects } = run(at('running'), [
      ...crashAt(0),
      ...crashAt(1000),
      ...crashAt(2000),
      { k: 'workerError', at: 3000, message: 'boom' },
    ]);
    expect(spawns(effects)).toEqual([250, 500, 1000]);
    expect(s.state).toBe('failed');
    expect(s.restarts).toBe(3);
  });

  it('caps the backoff', () => {
    const c = { ...cfg, maxRestarts: 10 };
    const { effects } = run(
      at('running'),
      [0, 1, 2, 3, 4, 5].flatMap((t) => crashAt(t)),
      c,
    );
    expect(spawns(effects)).toEqual([250, 500, 1000, 2000, 4000, 4000]);
  });

  it('slides the window: old restarts stop counting', () => {
    const { s, effects } = run(at('running'), [
      ...crashAt(0),
      ...crashAt(1000),
      ...crashAt(2000),
      // 60 s after the first restart, it has left the window.
      { k: 'workerError', at: 60_000, message: 'boom' },
    ]);
    expect(s.state).toBe('restarting');
    expect(s.window).toEqual([1000, 2000, 60_000]);
    // Two restarts still in the window → third step of the backoff.
    expect(spawns(effects).at(-1)).toBe(1000);
  });

  it('strategy never fails on the first crash', () => {
    const { s, effects } = run(at('running'), [{ k: 'workerError', at: 0, message: 'boom' }], {
      ...cfg,
      strategy: 'never',
    });
    expect(s.state).toBe('failed');
    expect(spawns(effects)).toEqual([]);
  });

  it('respawn resets the window, so a failed isolate gets its restarts back', () => {
    const failed = run(at('running'), [
      ...crashAt(0),
      ...crashAt(1),
      ...crashAt(2),
      { k: 'workerError', at: 3, message: 'boom' },
    ]).s;
    expect(failed.state).toBe('failed');
    const { s, effects } = run(failed, [
      { k: 'respawn' },
      { k: 'spawned', at: 4 },
      { k: 'ready' },
      { k: 'workerError', at: 5, message: 'boom' },
    ]);
    expect(s.state).toBe('restarting');
    expect(spawns(effects)).toEqual([0, 250]);
  });

  it('an isolate that crashes while loading also fails at the limit', () => {
    const loop: SupervisorInput[] = [
      { k: 'error', at: 0, fatal: true, message: 'start threw' },
      { k: 'spawned', at: 0 },
    ];
    const { s } = run(at('loading'), [...loop, ...loop, ...loop, ...loop]);
    expect(s.state).toBe('failed');
    expect(s.error).toBe('start threw');
  });
});
