/*
 * Per-isolate supervision as a pure state machine (design §4.3), with the
 * proof of concept's rules for M0: blocked after `blockedAfterMs` without a
 * beat (status only, never killed), restart `restartAfterMs` after a crash, no
 * restart limit. Timers and workers live in the kernel; this only decides.
 */
import { assertNever } from '@isoloop/protocol';

export type IsolateState = 'loading' | 'running' | 'blocked' | 'crashed' | 'restarting' | 'stopped';

export type Supervision = {
  state: IsolateState;
  /** `performance.now()` of the last beat, or of the spawn before the first one. */
  lastBeatAt: number;
  lagMs: number;
  /** Crash restarts. A manual restart doesn't count, as in the PoC. */
  restarts: number;
  /** Message of the last crash, while crashed. */
  error?: string;
};

export type SupervisorInput =
  | { k: 'spawned'; at: number }
  | { k: 'ready' }
  | { k: 'beat'; at: number; lagMs: number }
  | { k: 'tick'; at: number }
  | { k: 'workerError'; message: string }
  | { k: 'error'; fatal: boolean; message: string }
  | { k: 'restart' }
  | { k: 'stop' };

export type SupervisorEffect =
  | { k: 'terminate' }
  | { k: 'spawn'; afterMs: number }
  | { k: 'reportError'; message: string };

export type SupervisorConfig = { blockedAfterMs: number; restartAfterMs: number };

export function initialSupervision(at: number): Supervision {
  return { state: 'loading', lastBeatAt: at, lagMs: 0, restarts: 0 };
}

const live = (s: IsolateState): boolean => s === 'loading' || s === 'running' || s === 'blocked';

export function step(
  s: Supervision,
  input: SupervisorInput,
  cfg: SupervisorConfig,
): { s: Supervision; effects: SupervisorEffect[] } {
  const same = { s, effects: [] };
  switch (input.k) {
    case 'spawned': {
      const { error: _cleared, ...rest } = s;
      return { s: { ...rest, state: 'loading', lastBeatAt: input.at, lagMs: 0 }, effects: [] };
    }
    case 'ready':
      return s.state === 'loading' ? { s: { ...s, state: 'running' }, effects: [] } : same;
    case 'beat': {
      if (!live(s.state)) return same;
      const state = s.state === 'blocked' ? 'running' : s.state;
      return { s: { ...s, state, lastBeatAt: input.at, lagMs: input.lagMs }, effects: [] };
    }
    case 'tick':
      return s.state === 'running' && input.at - s.lastBeatAt > cfg.blockedAfterMs
        ? { s: { ...s, state: 'blocked' }, effects: [] }
        : same;
    case 'error':
      if (!input.fatal) return { s, effects: [{ k: 'reportError', message: input.message }] };
      return crash(s, input.message, cfg);
    case 'workerError':
      return crash(s, input.message, cfg);
    case 'restart': {
      if (s.state === 'stopped') return same;
      const { error: _cleared, ...rest } = s;
      return {
        s: { ...rest, state: 'restarting' },
        effects: [{ k: 'terminate' }, { k: 'spawn', afterMs: 0 }],
      };
    }
    case 'stop':
      return s.state === 'stopped'
        ? same
        : { s: { ...s, state: 'stopped' }, effects: [{ k: 'terminate' }] };
    default:
      return assertNever(input, 'Unknown supervisor input');
  }
}

function crash(
  s: Supervision,
  message: string,
  cfg: SupervisorConfig,
): { s: Supervision; effects: SupervisorEffect[] } {
  if (!live(s.state)) return { s, effects: [] };
  return {
    s: { ...s, state: 'crashed', restarts: s.restarts + 1, error: message },
    effects: [{ k: 'terminate' }, { k: 'spawn', afterMs: cfg.restartAfterMs }],
  };
}
