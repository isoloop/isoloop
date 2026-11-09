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
      'loading → failed on renderFmtMismatch, with no restart and an empty window (ADR 0011)',
      at('loading'),
      { k: 'renderFmtMismatch', at: 5, message: 'speaks x@9' },
      { state: 'failed', reason: 'render-fmt-mismatch', restarts: 0, window: [] },
      [
        { k: 'terminate' },
        moved('loading', 'crashed'),
        crashed('render-fmt-mismatch', 'speaks x@9'),
        moved('crashed', 'failed'),
        { k: 'showFallback', reason: 'render-fmt-mismatch', message: 'speaks x@9' },
        {
          k: 'emit',
          event: 'isolate:failed',
          data: { reason: 'render-fmt-mismatch', message: 'speaks x@9' },
        },
      ],
    ],
    [
      'loading → failed on versionMismatch (runtime-too-old), with no restart (ADR 0012)',
      at('loading'),
      { k: 'versionMismatch', at: 5, reason: 'runtime-too-old', message: 'built for x' },
      { state: 'failed', reason: 'runtime-too-old', restarts: 0, window: [] },
      [
        { k: 'terminate' },
        moved('loading', 'crashed'),
        crashed('runtime-too-old', 'built for x'),
        moved('crashed', 'failed'),
        { k: 'showFallback', reason: 'runtime-too-old', message: 'built for x' },
        {
          k: 'emit',
          event: 'isolate:failed',
          data: { reason: 'runtime-too-old', message: 'built for x' },
        },
      ],
    ],
    [
      'loading → failed on versionMismatch (isolate-too-old), with no restart (ADR 0012)',
      at('loading'),
      { k: 'versionMismatch', at: 5, reason: 'isolate-too-old', message: 'built for x' },
      { state: 'failed', reason: 'isolate-too-old', restarts: 0, window: [] },
      [
        { k: 'terminate' },
        moved('loading', 'crashed'),
        crashed('isolate-too-old', 'built for x'),
        moved('crashed', 'failed'),
        { k: 'showFallback', reason: 'isolate-too-old', message: 'built for x' },
        {
          k: 'emit',
          event: 'isolate:failed',
          data: { reason: 'isolate-too-old', message: 'built for x' },
        },
      ],
    ],
    [
      'versionMismatch outside loading is ignored',
      at('running'),
      { k: 'versionMismatch', at: 5, reason: 'runtime-too-old', message: 'late' },
      { state: 'running' },
      [],
    ],
    [
      'running → failed on busFailed, with no restart (ADR 0003, decision 7)',
      at('running'),
      { k: 'busFailed', at: 5, message: 'contracts_mismatch' },
      { state: 'failed', reason: 'bus-failed', restarts: 0, window: [] },
      [
        { k: 'terminate' },
        moved('running', 'crashed'),
        crashed('bus-failed', 'contracts_mismatch'),
        moved('crashed', 'failed'),
        { k: 'showFallback', reason: 'bus-failed', message: 'contracts_mismatch' },
        {
          k: 'emit',
          event: 'isolate:failed',
          data: { reason: 'bus-failed', message: 'contracts_mismatch' },
        },
      ],
    ],
    [
      'busFailed on a stopped isolate is ignored',
      at('stopped'),
      { k: 'busFailed', at: 5, message: 'x' },
      { state: 'stopped' },
      [],
    ],
    [
      'running → suspended on suspend: shutdown with grace (ADR 0001)',
      at('running'),
      { k: 'suspend' },
      { state: 'suspended' },
      [{ k: 'suspend', graceMs: 1000 }, moved('running', 'suspended')],
    ],
    [
      'suspend outside running is ignored',
      at('blocked'),
      { k: 'suspend' },
      { state: 'blocked' },
      [],
    ],
    [
      'suspended asks the wake queue on wake, and stays suspended until spawned',
      at('suspended'),
      { k: 'wake' },
      { state: 'suspended' },
      [{ k: 'wake' }],
    ],
    [
      'suspended → loading on spawned, restart window untouched',
      at('suspended', { restarts: 2, window: [5, 6] }),
      { k: 'spawned', at: 10 },
      { state: 'loading', restarts: 2, window: [5, 6], spawnedAt: 10 },
      [moved('suspended', 'loading')],
    ],
    [
      'wake on a running isolate is ignored',
      at('running'),
      { k: 'wake' },
      { state: 'running' },
      [],
    ],
    [
      'a suspended isolate is never judged blocked',
      at('suspended', { lastBeatAt: 0 }),
      { k: 'tick', at: 99_999 },
      { state: 'suspended' },
      [],
    ],
    [
      'renderFmtMismatch outside loading is ignored',
      at('running'),
      { k: 'renderFmtMismatch', at: 5, message: 'late' },
      { state: 'running' },
      [],
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

describe('poolCrash (M2c)', () => {
  it('crashes a live pool member with the reason of the member that took the worker down', () => {
    const input: SupervisorInput = {
      k: 'poolCrash',
      at: 5,
      reason: 'unresponsive',
      message: 'pool "p" restarted',
    };
    const out = step(at('running'), input, cfg);
    expect(out.s).toMatchObject({ state: 'restarting', reason: 'unresponsive', restarts: 1 });
    expect(out.effects).toContainEqual({ k: 'terminate' });
    expect(out.effects).toContainEqual(crashed('unresponsive', 'pool "p" restarted'));
  });

  it('leaves a member alone that is not live', () => {
    for (const state of ['stopped', 'failed', 'restarting', 'suspended'] as const)
      expect(
        step(at(state), { k: 'poolCrash', at: 5, reason: 'worker-error', message: 'x' }, cfg)
          .effects,
      ).toEqual([]);
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

describe('wake order (ADR 0001)', () => {
  it('visible surfaces first, top to bottom then left to right; headless last, in queue order', async () => {
    const { wakeOrder } = await import('../kernel');
    expect(
      wakeOrder([
        { id: 'h1', rect: undefined },
        { id: 'b', rect: { top: 100, left: 0 } },
        { id: 'a2', rect: { top: 0, left: 50 } },
        { id: 'h2', rect: undefined },
        { id: 'a1', rect: { top: 0, left: 10 } },
      ]),
    ).toEqual(['a1', 'a2', 'b', 'h1', 'h2']);
  });
});
