import { describe, expect, it } from 'vitest';
import { initialSupervision, step, type Supervision, type SupervisorInput } from './supervisor';

const cfg = { blockedAfterMs: 400, restartAfterMs: 1500 };
const at = (state: Supervision['state'], extra: Partial<Supervision> = {}): Supervision => ({
  ...initialSupervision(0),
  state,
  ...extra,
});

describe('supervisor step', () => {
  it.each<[string, Supervision, SupervisorInput, Partial<Supervision>, unknown[]]>([
    ['loading → running on ready', at('loading'), { k: 'ready' }, { state: 'running' }, []],
    ['ready is ignored once running', at('running'), { k: 'ready' }, { state: 'running' }, []],
    [
      'a beat records time and lag',
      at('running'),
      { k: 'beat', at: 50, lagMs: 3 },
      { lastBeatAt: 50, lagMs: 3 },
      [],
    ],
    [
      'silence up to blockedAfterMs stays running',
      at('running'),
      { k: 'tick', at: 400 },
      { state: 'running' },
      [],
    ],
    [
      'silence past blockedAfterMs → blocked',
      at('running'),
      { k: 'tick', at: 401 },
      { state: 'blocked' },
      [],
    ],
    [
      'loading is never judged blocked',
      at('loading'),
      { k: 'tick', at: 5000 },
      { state: 'loading' },
      [],
    ],
    [
      'blocked → running on a beat',
      at('blocked'),
      { k: 'beat', at: 900, lagMs: 500 },
      { state: 'running', lagMs: 500 },
      [],
    ],
    [
      'blocked is never killed (M0)',
      at('blocked'),
      { k: 'tick', at: 60_000 },
      { state: 'blocked' },
      [],
    ],
    [
      'a worker error crashes and schedules a restart',
      at('running'),
      { k: 'workerError', message: 'boom' },
      { state: 'crashed', restarts: 1, error: 'boom' },
      [{ k: 'terminate' }, { k: 'spawn', afterMs: 1500 }],
    ],
    [
      'a fatal error crashes too',
      at('loading'),
      { k: 'error', fatal: true, message: 'bad' },
      { state: 'crashed', restarts: 1 },
      [{ k: 'terminate' }, { k: 'spawn', afterMs: 1500 }],
    ],
    [
      'a blocked isolate can crash',
      at('blocked', { restarts: 2 }),
      { k: 'workerError', message: 'x' },
      { state: 'crashed', restarts: 3 },
      [{ k: 'terminate' }, { k: 'spawn', afterMs: 1500 }],
    ],
    [
      'a non-fatal error is only reported',
      at('running'),
      { k: 'error', fatal: false, message: 'meh' },
      { state: 'running', restarts: 0 },
      [{ k: 'reportError', message: 'meh' }],
    ],
    [
      'a second crash while crashed is ignored',
      at('crashed', { restarts: 1 }),
      { k: 'workerError', message: 'x' },
      { restarts: 1 },
      [],
    ],
    [
      'spawned → loading, clears the error, keeps restarts',
      at('crashed', { restarts: 1, error: 'boom' }),
      { k: 'spawned', at: 2000 },
      { state: 'loading', restarts: 1, lastBeatAt: 2000 },
      [],
    ],
    [
      'a manual restart does not count',
      at('running', { restarts: 1 }),
      { k: 'restart' },
      { state: 'restarting', restarts: 1 },
      [{ k: 'terminate' }, { k: 'spawn', afterMs: 0 }],
    ],
    [
      'a manual restart of a crashed isolate goes now',
      at('crashed', { restarts: 1, error: 'boom' }),
      { k: 'restart' },
      { state: 'restarting', restarts: 1 },
      [{ k: 'terminate' }, { k: 'spawn', afterMs: 0 }],
    ],
    ['stop terminates', at('running'), { k: 'stop' }, { state: 'stopped' }, [{ k: 'terminate' }]],
    ['stop is idempotent', at('stopped'), { k: 'stop' }, { state: 'stopped' }, []],
    [
      'a stopped isolate ignores beats',
      at('stopped'),
      { k: 'beat', at: 9, lagMs: 0 },
      { state: 'stopped', lastBeatAt: 0 },
      [],
    ],
    [
      'a stopped isolate is not restarted',
      at('stopped'),
      { k: 'restart' },
      { state: 'stopped' },
      [],
    ],
  ])('%s', (_name, s, input, expected, effects) => {
    const out = step(s, input, cfg);
    expect(out.s).toMatchObject(expected);
    if ('error' in expected && expected.error === undefined)
      expect(out.s).not.toHaveProperty('error');
    expect(out.effects).toEqual(effects);
  });
});
