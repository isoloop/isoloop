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
 *
 * The restart limit (ADR 0001, *Restart limit: short runs*) is two rules, and
 * the first one met fails the isolate: `maxRestarts` restarts in a sliding
 * `withinMs`, and a crash after `maxRestarts` crashes in a row that each came
 * after less than `withinMs` of healthy running. A healthy run lasts from
 * `ready` to the last beat; a run of `withinMs` or longer clears the count.
 */
import { assertNever } from '@isoloop/protocol';
import { backoffMs, DEFAULT_BACKOFF, slide, type Backoff } from './timers';

/**
 * Where an isolate is in its life:
 * - `loading`: its worker is starting, and it hasn't sent `ready`;
 * - `running`: ready and beating;
 * - `blocked`: no beat for `heartbeat.blockedAfterMs`; its surface shows a busy overlay;
 * - `stopped`: stopped by `kernel.stop` or its handle;
 * - `crashed`: passed through on a crash, on the way to `restarting` or `failed`;
 * - `restarting`: waiting out the backoff before a new worker;
 * - `failed`: past the restart limit, or a crash a restart can't fix; it stays down and shows its fallback;
 * - `suspended`: opt-in, idle, so its worker was shut down; it wakes on visibility, a record or `kernel.resume`.
 */
export type IsolateState =
  | 'loading'
  | 'running'
  | 'blocked'
  | 'stopped'
  | 'crashed'
  | 'restarting'
  | 'failed'
  /** Opt-in: idle, so its worker was shut down; wakes on visibility, a record or `resume`. */
  | 'suspended';

/**
 * Why an isolate (or the bus) crashed:
 * - `error`: the isolate reported a fatal error;
 * - `worker_error`: the worker's `error` or `messageerror` event;
 * - `ready_timeout`: no `ready` within `heartbeat.readyTimeoutMs` of the spawn;
 * - `unresponsive`: blocked for `heartbeat.killAfterMs` without a beat, so the worker was terminated;
 * - `spawn_failed`: `new Worker` threw;
 * - `render_format_mismatch`: the isolate renders in a format this host doesn't read;
 * - `bus_failed`: the bus couldn't load its contracts;
 * - `runtime_too_old`: the isolate was built for a newer Isoloop than this host;
 * - `isolate_too_old`: the isolate was built for an Isoloop older than this host still runs.
 *
 * The last four fail at once, without restarts, since a restart can't fix them.
 */
export type CrashReason =
  /** A fatal `error` message from the isolate. */
  | 'error'
  /** The worker's `error` or `messageerror` event. */
  | 'worker_error'
  /** No `ready` within `readyTimeoutMs` of the spawn. */
  | 'ready_timeout'
  /** Blocked for `killAfterMs` without a beat; the worker was terminated. */
  | 'unresponsive'
  /** `new Worker` threw. */
  | 'spawn_failed'
  /** `ready.renderFmt` isn't one the host speaks. Fails at once: a restart can't fix it. */
  | 'render_format_mismatch'
  /** The bus couldn't load its contracts. Fails at once: the error is deterministic. */
  | 'bus_failed'
  /** `ready.requires` is newer than this host's `VERSION`. Fails at once. */
  | 'runtime_too_old'
  /** `ready.requires` is older than this host's `FLOOR`. Fails at once. */
  | 'isolate_too_old';

export type SupervisorConfig = {
  /** `never` fails on the first crash. */
  strategy: 'one-for-one' | 'never';
  /**
   * Restarts allowed within `withinMs`, and crashes in a row allowed after
   * short runs; the next crash fails the isolate.
   */
  maxRestarts: number;
  /** The sliding window, and the healthy run that clears the count of short runs. */
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
  /** `performance.now()` of this worker's `ready`; unset until it's ready. */
  readyAt?: number;
  /** Crashes in a row, each after a healthy run shorter than `withinMs`. */
  short: number;
  /** While the document is hidden, nothing is judged blocked or killed. */
  hidden: boolean;
  /** The last crash, while restarting or failed. */
  reason?: CrashReason;
  error?: string;
};

export type SupervisorInput =
  | { k: 'spawned'; at: number }
  | { k: 'ready'; at: number }
  | { k: 'beat'; at: number; lagMs: number }
  /** `pool`: the pool whose worker it shares, as on `workerError`. */
  | { k: 'tick'; at: number; pool?: string | undefined }
  | { k: 'error'; at: number; fatal: boolean; message: string }
  /**
   * With `pool`, the failure is the shared worker's, which can't say which
   * member caused it, so the message names none. Without, it's this isolate's
   * own: an own worker, or a kill through the inspection feed.
   */
  | { k: 'workerError'; at: number; message: string; pool?: string | undefined }
  | { k: 'spawnFailed'; at: number; message: string }
  | { k: 'renderFmtMismatch'; at: number; message: string }
  /** `ready.requires` outside `[FLOOR, VERSION]` (ADR 0012). */
  | {
      k: 'versionMismatch';
      at: number;
      reason: 'runtime_too_old' | 'isolate_too_old';
      message: string;
    }
  /** The bus failed its contracts check: stop and fail, no restart. */
  | { k: 'busFailed'; at: number; message: string }
  /**
   * Another member of this isolate's pool took the shared worker down (M2c,
   * ADR 0001): it crashes too, with that member's reason, and restarts.
   */
  | { k: 'poolCrash'; at: number; reason: CrashReason; message: string }
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
    short: 0,
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

/** A fresh worker: not ready yet, so no healthy run. */
const unready = (s: IsolateSupervision): IsolateSupervision => {
  const { readyAt: _r, ...rest } = s;
  return rest;
};

/** A worker failure's message: in a pool it's the worker's, and names no member. */
const workerMessage = (pool: string | undefined, what: string, detail: string): string =>
  pool === undefined ? detail : `pool "${pool}" restarted: its worker ${what} (${detail})`;

export function step(s: IsolateSupervision, input: SupervisorInput, cfg: SupervisorConfig): Step {
  const same: Step = { s, effects: [] };
  switch (input.k) {
    case 'spawned':
      if (s.state !== 'restarting' && s.state !== 'suspended') return same;
      return {
        s: {
          ...unready(withoutCrash(s)),
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
        s: { ...s, state: 'running', readyAt: input.at, lastBeatAt: input.at },
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
        return crash(s, input.at, 'ready_timeout', `No ready within ${cfg.readyTimeoutMs} ms`, cfg);
      if (s.state === 'running' && input.at - s.lastBeatAt > cfg.blockedAfterMs)
        return {
          s: { ...s, state: 'blocked' },
          effects: [{ k: 'showBusy' }, moved('running', 'blocked')],
        };
      if (s.state === 'blocked' && input.at - s.lastBeatAt > cfg.killAfterMs)
        return crash(
          s,
          input.at,
          'unresponsive',
          workerMessage(input.pool, 'stopped responding', `No heartbeat for ${cfg.killAfterMs} ms`),
          cfg,
        );
      return same;

    case 'error':
      if (!live(s.state)) return same;
      if (!input.fatal)
        return { s, effects: [emit({ event: 'isolate:error', data: { message: input.message } })] };
      return crash(s, input.at, 'error', input.message, cfg);

    case 'workerError':
      return live(s.state)
        ? crash(
            s,
            input.at,
            'worker_error',
            workerMessage(input.pool, 'failed', input.message),
            cfg,
          )
        : same;

    case 'poolCrash':
      return live(s.state) ? crash(s, input.at, input.reason, input.message, cfg) : same;

    case 'spawnFailed':
      return s.state === 'stopped' || s.state === 'failed'
        ? same
        : crash(s, input.at, 'spawn_failed', input.message, cfg);

    case 'renderFmtMismatch':
      return s.state === 'loading'
        ? crash(s, input.at, 'render_format_mismatch', input.message, cfg, true)
        : same;

    case 'versionMismatch':
      return s.state === 'loading'
        ? crash(s, input.at, input.reason, input.message, cfg, true)
        : same;

    case 'busFailed':
      return s.state === 'stopped' || s.state === 'failed'
        ? same
        : crash(s, input.at, 'bus_failed', input.message, cfg, true);

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
      return {
        s: { ...unready(withoutCrash(s)), state: 'restarting', window: [], short: 0 },
        effects,
      };
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
  // From `ready` to the last beat: the time it took to notice the crash isn't
  // healthy running. A worker that never got ready had none.
  const healthy = s.readyAt === undefined ? 0 : Math.max(0, s.lastBeatAt - s.readyAt);
  const short = healthy >= cfg.withinMs ? 1 : s.short + 1;
  const limit =
    final || cfg.strategy === 'never'
      ? undefined
      : window.length >= cfg.maxRestarts
        ? `${cfg.maxRestarts} restarts in ${cfg.withinMs} ms`
        : short > cfg.maxRestarts
          ? `${short} crashes, each after less than ${cfg.withinMs} ms of healthy running`
          : undefined;
  if (final || cfg.strategy === 'never' || limit !== undefined) {
    const why = limit === undefined ? message : `${message} (${limit})`;
    effects.push(
      moved('crashed', 'failed'),
      { k: 'showFallback', reason, message: why },
      emit({ event: 'isolate:failed', data: { reason, message: why } }),
    );
    return {
      s: { ...unready(s), state: 'failed', window, short, reason, error: why },
      effects,
    };
  }

  effects.push(moved('crashed', 'restarting'), {
    k: 'spawn',
    afterMs: backoffMs(Math.max(window.length, short - 1), cfg.backoff),
  });
  return {
    s: {
      ...unready(s),
      state: 'restarting',
      window: [...window, at],
      short,
      restarts: s.restarts + 1,
      reason,
      error: message,
    },
    effects,
  };
}
