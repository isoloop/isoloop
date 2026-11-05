/*
 * Per-isolate supervision as a pure state machine (design §4.3). It only
 * decides: workers, timers and the DOM live in the kernel, which feeds inputs
 * in and carries the effects out. Every event the kernel emits about an
 * isolate's lifecycle comes from here, so the transition table is testable
 * end to end with plain numbers.
 *
 * `crashed` is passed through, never rested in: a crash goes straight on to
 * `restarting` (waiting out the backoff) or `failed`.
 *
 * `suspended` (ADR 0001) is opt-in and entered only from `running` when the
 * kernel judges the isolate idle; `wake` asks the kernel's wake queue for a
 * spawn, and `spawned` moves it to `loading`. It never touches the restart
 * window.
 */
import { assertNever } from '@isoloop/protocol';
import { backoffMs, DEFAULT_BACKOFF, slide, type Backoff } from './timers';

export type IsolateState =
  | 'loading'
  | 'running'
  | 'blocked'
  | 'stopped'
  | 'crashed'
  | 'restarting'
  | 'failed'
  /** Opt-in: idle, so its worker was shut down; wakes on visibility, a record or `resume` (ADR 0001). */
  | 'suspended';

export type CrashReason =
  /** A fatal `error` message from the isolate. */
  | 'error'
  /** The worker's `error` or `messageerror` event. */
  | 'worker-error'
  /** No `ready` within `readyTimeoutMs` of the spawn. */
  | 'ready-timeout'
  /** Blocked for `killAfterMs` without a beat; the worker was terminated. */
  | 'unresponsive'
  /** `new Worker` threw. */
  | 'spawn-failed'
  /** `ready.renderFmt` isn't one the host speaks. Fails at once: a restart can't fix it (ADR 0011). */
  | 'render-fmt-mismatch'
  /** The bus couldn't load its contracts. Fails at once: the error is deterministic (ADR 0003). */
  | 'bus-failed';

export type SupervisorConfig = {
  /** `never` fails on the first crash. */
  strategy: 'one-for-one' | 'never';
  /** Restarts allowed within `withinMs`; the next crash fails the isolate. */
  maxRestarts: number;
  withinMs: number;
  backoff: Backoff;
  blockedAfterMs: number;
  killAfterMs: number;
  readyTimeoutMs: number;
  /** Time an isolate gets for its `onShutdown` handlers on stop. */
  stopGraceMs: number;
};

export const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
  strategy: 'one-for-one',
  maxRestarts: 3,
  withinMs: 60_000,
  backoff: DEFAULT_BACKOFF,
  blockedAfterMs: 400,
  killAfterMs: 10_000,
  readyTimeoutMs: 10_000,
  stopGraceMs: 1000,
};

export type IsolateSupervision = {
  state: IsolateState;
  /** `performance.now()` of the spawn, for the ready timeout. */
  spawnedAt: number;
  /** `performance.now()` of the last beat, or of the spawn before the first one. */
  lastBeatAt: number;
  lagMs: number;
  /** Crash restarts since spawn. A manual respawn doesn't count. */
  restarts: number;
  /** Times of the restarts in the current window, oldest first. */
  window: number[];
  /** While the document is hidden, nothing is judged blocked or killed. */
  hidden: boolean;
  /** The last crash, while restarting or failed. */
  reason?: CrashReason;
  error?: string;
};

export type SupervisorInput =
  | { k: 'spawned'; at: number }
  | { k: 'ready' }
  | { k: 'beat'; at: number; lagMs: number }
  | { k: 'tick'; at: number }
  | { k: 'error'; at: number; fatal: boolean; message: string }
  | { k: 'workerError'; at: number; message: string }
  | { k: 'spawnFailed'; at: number; message: string }
  | { k: 'renderFmtMismatch'; at: number; message: string }
  /** The bus failed its contracts check: stop and fail, no restart. */
  | { k: 'busFailed'; at: number; message: string }
  | { k: 'stop' }
  | { k: 'respawn' }
  /** The kernel judged a running isolate idle (ADR 0001). */
  | { k: 'suspend' }
  /** Visible again, a record for a headless isolate, or `kernel.resume`. */
  | { k: 'wake' }
  | { k: 'hidden' }
  /** Document visible again, or the Page Lifecycle `resume` event. */
  | { k: 'visible'; at: number };

export type SupervisorEvent =
  | { event: 'isolate:state'; data: { state: IsolateState; prev: IsolateState } }
  | { event: 'isolate:ready'; data: Record<string, never> }
  | { event: 'isolate:crash'; data: { reason: CrashReason; message: string } }
  | { event: 'isolate:failed'; data: { reason: CrashReason; message: string } }
  | { event: 'isolate:error'; data: { message: string } };

export type SupervisorEffect =
  | { k: 'terminate' }
  /** Start a new worker after `afterMs`, then feed `spawned`. Replaces a pending spawn. */
  | { k: 'spawn'; afterMs: number }
  /** Send `shutdown`, then terminate after `graceMs` or the isolate's last message. */
  | { k: 'shutdown'; graceMs: number }
  | { k: 'showBusy' }
  | { k: 'hideBusy' }
  /** Freeze the surface, `shutdown { reason: 'suspend' }`, detach keeping offsets, terminate. */
  | { k: 'suspend'; graceMs: number }
  /** Put the isolate in the wake queue; the kernel spawns it and feeds `spawned`. */
  | { k: 'wake' }
  | { k: 'showFallback'; reason: CrashReason; message: string }
  | { k: 'hideFallback' }
  | ({ k: 'emit' } & SupervisorEvent);

export type Step = { s: IsolateSupervision; effects: SupervisorEffect[] };

export function initialSupervision(at: number): IsolateSupervision {
  return {
    state: 'restarting',
    spawnedAt: at,
    lastBeatAt: at,
    lagMs: 0,
    restarts: 0,
    window: [],
    hidden: false,
  };
}

const live = (s: IsolateState): boolean => s === 'loading' || s === 'running' || s === 'blocked';

const emit = (e: SupervisorEvent): SupervisorEffect => ({ k: 'emit', ...e });

const moved = (prev: IsolateState, state: IsolateState): SupervisorEffect =>
  emit({ event: 'isolate:state', data: { state, prev } });

const withoutCrash = (s: IsolateSupervision): IsolateSupervision => {
  const { reason: _r, error: _e, ...rest } = s;
  return rest;
};

export function step(s: IsolateSupervision, input: SupervisorInput, cfg: SupervisorConfig): Step {
  const same: Step = { s, effects: [] };
  switch (input.k) {
    case 'spawned':
      if (s.state !== 'restarting' && s.state !== 'suspended') return same;
      return {
        s: {
          ...withoutCrash(s),
          state: 'loading',
          spawnedAt: input.at,
          lastBeatAt: input.at,
          lagMs: 0,
        },
        effects: [moved(s.state, 'loading')],
      };

    case 'ready':
      if (s.state !== 'loading') return same;
      return {
        s: { ...s, state: 'running' },
        effects: [emit({ event: 'isolate:ready', data: {} }), moved('loading', 'running')],
      };

    case 'beat': {
      if (!live(s.state)) return same;
      const next = { ...s, lastBeatAt: input.at, lagMs: input.lagMs };
      if (s.state !== 'blocked') return { s: next, effects: [] };
      return {
        s: { ...next, state: 'running' },
        effects: [{ k: 'hideBusy' }, moved('blocked', 'running')],
      };
    }

    case 'tick':
      if (s.hidden) return same;
      if (s.state === 'loading' && input.at - s.spawnedAt > cfg.readyTimeoutMs)
        return crash(s, input.at, 'ready-timeout', `No ready within ${cfg.readyTimeoutMs} ms`, cfg);
      if (s.state === 'running' && input.at - s.lastBeatAt > cfg.blockedAfterMs)
        return {
          s: { ...s, state: 'blocked' },
          effects: [{ k: 'showBusy' }, moved('running', 'blocked')],
        };
      if (s.state === 'blocked' && input.at - s.lastBeatAt > cfg.killAfterMs)
        return crash(s, input.at, 'unresponsive', `No heartbeat for ${cfg.killAfterMs} ms`, cfg);
      return same;

    case 'error':
      if (!live(s.state)) return same;
      if (!input.fatal)
        return { s, effects: [emit({ event: 'isolate:error', data: { message: input.message } })] };
      return crash(s, input.at, 'error', input.message, cfg);

    case 'workerError':
      return live(s.state) ? crash(s, input.at, 'worker-error', input.message, cfg) : same;

    case 'spawnFailed':
      return s.state === 'stopped' || s.state === 'failed'
        ? same
        : crash(s, input.at, 'spawn-failed', input.message, cfg);

    case 'renderFmtMismatch':
      return s.state === 'loading'
        ? crash(s, input.at, 'render-fmt-mismatch', input.message, cfg, true)
        : same;

    case 'busFailed':
      return s.state === 'stopped' || s.state === 'failed'
        ? same
        : crash(s, input.at, 'bus-failed', input.message, cfg, true);

    case 'stop':
      if (s.state === 'stopped' || s.state === 'failed') return same;
      return {
        s: { ...withoutCrash(s), state: 'stopped' },
        effects: [
          ...(s.state === 'blocked' ? [{ k: 'hideBusy' } as const] : []),
          { k: 'shutdown', graceMs: cfg.stopGraceMs },
          moved(s.state, 'stopped'),
        ],
      };

    case 'respawn': {
      const effects: SupervisorEffect[] = [];
      if (live(s.state)) effects.push({ k: 'terminate' });
      if (s.state === 'blocked') effects.push({ k: 'hideBusy' });
      if (s.state === 'failed') effects.push({ k: 'hideFallback' });
      effects.push({ k: 'spawn', afterMs: 0 });
      if (s.state !== 'restarting') effects.push(moved(s.state, 'restarting'));
      return { s: { ...withoutCrash(s), state: 'restarting', window: [] }, effects };
    }

    case 'suspend':
      if (s.state !== 'running') return same;
      return {
        s: { ...s, state: 'suspended' },
        effects: [{ k: 'suspend', graceMs: cfg.stopGraceMs }, moved('running', 'suspended')],
      };

    case 'wake':
      return s.state === 'suspended' ? { s, effects: [{ k: 'wake' }] } : same;

    case 'hidden':
      return { s: { ...s, hidden: true }, effects: [] };

    case 'visible':
      return {
        s: {
          ...s,
          hidden: false,
          lastBeatAt: input.at,
          spawnedAt: s.state === 'loading' ? input.at : s.spawnedAt,
        },
        effects: [],
      };

    default:
      return assertNever(input, 'Unknown supervisor input');
  }
}

function crash(
  s: IsolateSupervision,
  at: number,
  reason: CrashReason,
  message: string,
  cfg: SupervisorConfig,
  /** Skip the restart: the crash would happen again. */
  final = false,
): Step {
  const effects: SupervisorEffect[] = [];
  if (s.state !== 'restarting') effects.push({ k: 'terminate' });
  if (s.state === 'blocked') effects.push({ k: 'hideBusy' });
  effects.push(
    moved(s.state, 'crashed'),
    emit({ event: 'isolate:crash', data: { reason, message } }),
  );

  const window = slide(s.window, at, cfg.withinMs);
  if (final || cfg.strategy === 'never' || window.length >= cfg.maxRestarts) {
    effects.push(
      moved('crashed', 'failed'),
      { k: 'showFallback', reason, message },
      emit({ event: 'isolate:failed', data: { reason, message } }),
    );
    return { s: { ...s, state: 'failed', window, reason, error: message }, effects };
  }

  effects.push(moved('crashed', 'restarting'), {
    k: 'spawn',
    afterMs: backoffMs(window.length, cfg.backoff),
  });
  return {
    s: {
      ...s,
      state: 'restarting',
      window: [...window, at],
      restarts: s.restarts + 1,
      reason,
      error: message,
    },
    effects,
  };
}
