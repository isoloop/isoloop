import { claimPools } from './claim';
import type { Kernel } from '@isoloop/host';
import type {
  Balancer,
  BalancerEvents,
  BalancerOf,
  BalancerOptions,
  BeatLike,
  BehindEvent,
  CrashLike,
  FailedLike,
  KernelLike,
  ManifestLike,
  MoveReason,
  Placement,
  PlacementState,
  SpikeEvent,
} from './types';

/**
 * A pool's beat reaches the balancer as one `isolate:beat` per member, all
 * from the same worker message: events this close together are one beat.
 * Beats are 100 ms apart by default.
 */
const BEAT_GAP_MS = 10;
/** How often it decides. */
const DECIDE_MS = 500;
/** How often a changed load is written to the `loads` store. */
const SAVE_MS = 10_000;
/** A load is written again only once it moved by this much. */
const SAVE_DELTA_PCT = 5;

/** Pool names: `balancer-1`, `balancer-2`…, reserved by the host for the balancer. */
const POOLS = 'balancer';
/** The quarantine, and `-2`, `-3`… for suspects given a worker of their own. */
const QUARANTINES = 'balancer-quarantine';
const QUARANTINE = `${QUARANTINES}-1`;

const now = (): number => performance.now();

/** A report's figure: a finite number, 0 or more. */
const valid = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/**
 * `busyMs` is approximate: shared framework work is split between members and
 * promise continuations go unattributed. When the members' busy time explains
 * less than this share of the interval, the lag isn't pinned on the busiest
 * member; the balancer bisects instead, as on a kill.
 */
const ATTRIBUTED_PCT = 50;

/**
 * A pool whose members' busy time adds up to this share of a core over the
 * window is full (Q15), whatever its lag: work that yields often keeps the lag
 * low while the members starve each other. Placement stops adding at
 * `headroom` (60 by default); moving starts here, and the gap is the
 * hysteresis.
 */
const FULL_PCT = 80;

/** A second spike from the same member (or unexplained one in the same pool) within this quarantines (M3i). */
const SPIKE_REPEAT_MS = 60_000;

/**
 * Backlog (M3i): a reported backlog higher at the end of this window than at
 * its start, and above 0, is rising. After a backlog move, the next one waits
 * for a whole fresh window: that's the cooldown.
 */
const BACKLOG_WINDOW_MS = 10_000;
/** A report older than this is no signal. */
const STALE_MS = 10_000;
/** `behind` again at most this often while it lasts. */
const BEHIND_REPEAT_MS = 30_000;

/** Moves for load (not spike, crash or bisect) per member per window (M3i). */
const MOVE_BUDGET = 3;
const MOVE_BUDGET_MS = 300_000;

/** Packing back (M3i): quiet this long, into a pool that stays under `PACK_PCT` with it, one every `PACK_EVERY_MS`. */
const PACK_STEADY_MS = 60_000;
const PACK_PCT = 40;
const PACK_EVERY_MS = 60_000;

/** An offender's quiet window doubles with each offence up to this, or `steadyMs` if longer (M3j). */
const QUIET_CAP_MS = 120_000;

/** Worker crash reasons whose culprit the kernel can't name: every member of the pool crashes. */
const POOL_KILL = new Set(['unresponsive', 'worker_error']);

type Beat = { at: number; busy: number; dur: number };
type Lag = { at: number; lagMs: number };

type Member<M> = {
  manifest: M;
  pool: string;
  state: PlacementState;
  beats: Beat[];
  lastBeatAt: number | undefined;
  /** The last load measured over a full window, or the stored one. */
  knownLoad: number | undefined;
  savedLoad: number | undefined;
  /** Times sent to quarantine for misbehaving (spike, crash, bisect culprit). */
  offences: number;
  /** When it last entered quarantine, or `-Infinity`. */
  quarantinedAt: number;
  /** When it last left quarantine or lost an offence: the start of its next quiet window outside (M3j). */
  decayAt: number;
  /** When a spike or crash that counted was last put on it, or `-Infinity`. */
  lastSpikeAt: number;
  /** A first spike, only noted: a second within `SPIKE_REPEAT_MS` counts (M3i). */
  spikeNotedAt: number;
  holds: number;
  atCap: boolean;
  /** When it last started running in its current pool. */
  arrivedAt: number;
  /** Times of its moves, for the budget. */
  moveTimes: number[];
  /**
   * Started in the quarantine because it was never measured, and hasn't moved
   * or offended since (M3j): its way out is free of the move budget.
   */
  unmeasured: boolean;
  /** Set by `move`: reported as `arrived` on its first beat in the new pool. */
  arrival?: { from: string; to: string; reason: MoveReason; at: number };
  /** Backlog reports since it last moved, oldest first; and the latest one. */
  backlogs: { at: number; value: number }[];
  backlog: { at: number; value: number } | undefined;
  /** Backlog reports over the last `PACK_STEADY_MS` and one before, for packing (M3j). */
  backlogHistory: { at: number; value: number }[];
  /** The app's `busyMs` totals since it last moved, oldest first (M3j). */
  busyReports: { at: number; total: number }[];
  /** When its backlog was last seen rising. */
  risingAt: number;
  /** When a bisect its pool needed last had no quarantine pool free (M3j). */
  stuckAt: number;
  /** Rising with nowhere to go, as of the last decision. */
  behind: boolean;
  /** When `behind` was last emitted: at most every `BEHIND_REPEAT_MS`, whatever happens between. */
  behindAt: number;
  /** While `moving`: settles once the kernel has stopped the old copy. */
  stopping?: Promise<void>;
};

type Pool<M> = {
  /** Lag samples since the pool's membership last changed. */
  lags: Lag[];
  /** When the pool's latest beat arrived, and the members it reported. */
  beatAt: number | undefined;
  beat: Member<M>[];
  /** When the membership last changed: a full window must follow before it moves anyone. */
  since: number;
  /** A member moved out: its next full window must show the lag fell, or the next-heaviest goes too. */
  watch: boolean;
  /** When it was last lagging or full. */
  troubleAt: number;
  /** A first unexplained spike, only noted (M3i). */
  spikeNotedAt: number;
};

const defaultMaxWorkers = (): number => {
  const nav: { hardwareConcurrency?: number } | undefined = Reflect.get(globalThis, 'navigator');
  const cores = nav?.hardwareConcurrency ?? 4;
  return Math.max(2, cores - 2);
};

const median = (xs: number[]): number => {
  const s = xs.toSorted((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

const isQuarantine = (pool: string): boolean => pool.startsWith(`${QUARANTINES}-`);

/** Offended at least once, and not yet forgiven (decision 5). */
const offender = (m: { offences: number }): boolean => m.offences > 0;

const isOurs = (pool: string): boolean => pool.startsWith(`${POOLS}-`);

/** Load as a share of one core over `beats`, if they cover at least 90 % of `windowMs`. */
const average = (beats: Beat[], windowMs: number, t: number): number | undefined => {
  const recent = beats.filter((b) => b.at > t - windowMs);
  const dur = recent.reduce((s, b) => s + b.dur, 0);
  if (dur < windowMs * 0.9) return undefined;
  const busy = recent.reduce((s, b) => s + b.busy, 0);
  return Math.min(100, (busy / dur) * 100);
};

/**
 * Automatic placement for isolates spawned through it: it places each in a
 * pool with room by measured load, moves one out when its pool lags or is
 * full, and keeps one that blocks or crashes in a quarantine pool until it's
 * quiet again.
 *
 * It decides on the main thread, from every heartbeat (`isolate:beat`), and
 * moves an isolate by stopping it and spawning it again with another `pool`;
 * the kernel never pools on its own. Isolates spawned with `kernel.spawn` are
 * never touched, and don't count toward `maxWorkers`. One balancer per kernel
 * at a time: `dispose()` frees the kernel for another.
 *
 * @param kernel The kernel to place isolates in.
 * @param opts The worker allowance and thresholds. Default: all defaults.
 * @returns The balancer.
 * @throws {KernelError} `balancer_exists` when the kernel already has a
 *   balancer that hasn't been disposed.
 * @example
 * ```ts
 * import { createBalancer } from '@isoloop/balancer';
 *
 * const balancer = createBalancer(kernel, { maxWorkers: 4 });
 * balancer.spawn({ id: 'task-1', src: '/isolates/task.js' });
 * balancer.on('move', (e) => console.log(e.id, e.from, '→', e.to, e.reason));
 * ```
 * @experimental The policy and its options may change before 1.0.
 */
export function createBalancer(kernel: Kernel, opts: BalancerOptions = {}): Balancer {
  return balance(kernel, opts);
}

/**
 * `createBalancer` for any `KernelLike`: the tests' simulated kernel.
 * @internal
 */
export function balance<M extends ManifestLike>(
  kernel: KernelLike<M>,
  opts: BalancerOptions = {},
): BalancerOf<M> {
  // One balancer per kernel at a time; throws `balancer_exists` for a second
  // until the first is disposed.
  const claim = claimPools(kernel, 'balancer');
  const maxWorkers = Math.max(1, opts.maxWorkers ?? defaultMaxWorkers());
  const spikeLag = opts.spike?.lagMs ?? 100;
  const sustainedLag = opts.sustained?.lagMs ?? 50;
  const windowMs = opts.sustained?.forMs ?? 3000;
  const headroom = opts.headroom?.loadPct ?? 60;
  const steadyMs = opts.quarantine?.steadyMs ?? 30_000;
  const maxReturns = opts.quarantine?.maxReturns ?? 3;
  const loads = opts.loads;
  const packing = opts.pack?.enabled ?? true;

  const members = new Map<string, Member<M>>();
  const pools = new Map<string, Pool<M>>();
  const listeners: { [E in keyof BalancerEvents]: Set<(e: BalancerEvents[E]) => void> } = {
    move: new Set(),
    arrived: new Set(),
    spike: new Set(),
    behind: new Set(),
    failed: new Set(),
    foreign: new Set(),
  };
  /** Beats of isolates the balancer didn't place, for `measure` (previews included). */
  const seen = new Map<string, { lastBeatAt: number; beats: Beat[] }>();
  /** Isolates in our pools we didn't place, by id: their pool. */
  const foreign = new Map<string, string>();
  /** Pools the kernel killed since the last decision (an unnamed culprit). */
  const killed = new Set<string>();
  /** An unfinished search for the member that kills its pool (Q20). */
  /**
   * `suspects` narrows with each step; `moved` is everyone it has moved so
   * far, kept in quarantine until it ends so a culprit that only shows with
   * company still meets the members it was moved with.
   */
  let bisect: { suspects: Set<string>; moved: Set<string>; at: number } | undefined;
  /** Pools whose latest beat spiked, judged once all its members' events are in. */
  const spiked = new Set<string>();
  let judging: ReturnType<typeof setTimeout> | undefined;
  let lastSave = -Infinity;
  /** The last backlog move: rising is judged only on reports after it. */
  let lastBacklogMoveAt = -Infinity;
  let lastPackAt = -Infinity;
  /** A pool being emptied into another by packing, one member at a time (M3j). */
  let merging: { from: string; into: string } | undefined;
  let disposed = false;

  // ---- pools and loads ----

  const pool = (name: string): Pool<M> => {
    let p = pools.get(name);
    if (!p) {
      p = {
        lags: [],
        beatAt: undefined,
        beat: [],
        since: now(),
        watch: false,
        troubleAt: -Infinity,
        spikeNotedAt: -Infinity,
      };
      pools.set(name, p);
    }
    return p;
  };

  /** Running in its pool: not mid-move, and not given up on by the kernel. */
  const live = (m: Member<M>): boolean => m.state !== 'moving' && m.state !== 'failed';

  /** Its members, moving ones included: the ones a pack has to move to empty it (M3j). */
  const inPool = (name: string): Member<M>[] =>
    [...members.values()].filter((m) => m.pool === name && m.state !== 'failed');

  const membersOf = (name: string): Member<M>[] =>
    [...members.values()].filter((m) => m.pool === name && live(m));

  const changed = (name: string): void => {
    const p = pool(name);
    p.lags = [];
    p.beatAt = undefined;
    p.beat = [];
    p.since = now();
  };

  /**
   * The app's reported busy time (M3j) as a share of one core: the running
   * total's difference over about a window, from a fresh report back to one
   * taken at least 90 % of a window before it.
   */
  const reportedOf = (m: Member<M>, t: number): number | undefined => {
    const latest = m.busyReports.at(-1);
    if (!latest || t - latest.at > STALE_MS) return undefined;
    const start = m.busyReports.findLast((r) => r.at <= latest.at - windowMs * 0.9);
    if (!start) return undefined;
    const ms = latest.at - start.at;
    return Math.min(100, ((latest.total - start.total) / ms) * 100);
  };

  /** The beats' and the report's measures over the last window, whichever is larger. */
  const measured = (m: Member<M>, t: number): number | undefined => {
    const beat = average(m.beats, windowMs, t);
    const reported = reportedOf(m, t);
    if (beat === undefined) return reported;
    return reported === undefined ? beat : Math.max(beat, reported);
  };

  /** Measured load over the last window, or the last one known. */
  const loadOf = (m: Member<M>): number | undefined => measured(m, now()) ?? m.knownLoad;

  const poolLoad = (name: string): number =>
    membersOf(name).reduce((s, m) => s + (loadOf(m) ?? 0), 0);

  const windowFull = (name: string): boolean => {
    const p = pool(name);
    const last = p.lags.at(-1);
    return last !== undefined && last.at - p.since >= windowMs;
  };

  /**
   * Workers counted against `maxWorkers`: the balancer's pools and any
   * quarantine worker beyond the first, which is allowed on top. Workers the
   * app runs itself don't count (ADR 0017, amended). A pool a move has
   * claimed counts before its worker runs (M3j), so two moves in one
   * decision can't each take the last worker.
   */
  const ownWorkers = (): number => {
    const names = new Set(
      kernel
        .pools()
        .filter((p) => p.running && isOurs(p.name))
        .map((p) => p.name),
    );
    for (const m of members.values()) if (m.state !== 'failed') names.add(m.pool);
    names.delete(QUARANTINE);
    return [...names].filter((n) => isOurs(n)).length;
  };

  const ownPools = (): string[] =>
    [
      ...new Set([...members.values()].filter((m) => m.state !== 'failed').map((m) => m.pool)),
    ].filter((n) => !isQuarantine(n));

  /** Room for one more worker of the balancer's own. */
  const roomForPool = (): boolean => ownWorkers() + 1 <= maxWorkers;

  /**
   * When a member whose backlog is rising last found no room in a shared
   * pool (M3j). For a window after, a worker that frees up is its: no new
   * quarantine pool takes it.
   */
  let starvedAt = -Infinity;
  const starving = (): boolean => now() - starvedAt < BACKLOG_WINDOW_MS;

  /** Room for a quarantine pool beyond the first: under the cap, and no backlog waiting (M3j). */
  const roomForQuarantine = (): boolean => roomForPool() && !starving();

  const freshName = (prefix: string, first: number): string => {
    const taken = new Set(kernel.pools().map((p) => p.name));
    for (const m of members.values()) taken.add(m.pool);
    for (let n = first; ; n++) {
      const name = `${prefix}-${n}`;
      if (!taken.has(name)) return name;
    }
  };

  const recentlySpiked = (name: string): boolean =>
    membersOf(name).some((m) => now() - m.lastSpikeAt < steadyMs);

  /**
   * Where an isolate with `load` goes (Q7′): the auto pool with the most room
   * that stays under `headroom` with it, else a new pool if the cap allows,
   * else the least-loaded auto pool, flagged at the cap. `undefined` when
   * there's nowhere better than `except`.
   */
  const target = (load: number, except?: string): { pool: string; atCap: boolean } | undefined => {
    const candidates = ownPools()
      .filter((n) => n !== except && !recentlySpiked(n))
      .map((n) => ({ n, load: poolLoad(n) }))
      .filter((c) => c.load + load < headroom)
      .toSorted((a, b) => a.load - b.load);
    const best = candidates[0];
    if (best) return { pool: best.n, atCap: false };
    if (ownPools().length === 0 || roomForPool())
      return { pool: freshName(POOLS, 1), atCap: false };
    if (except !== undefined) return undefined;
    const least = ownPools()
      .map((n) => ({ n, load: poolLoad(n) }))
      .toSorted((a, b) => a.load - b.load)[0];
    return least ? { pool: least.n, atCap: true } : { pool: freshName(POOLS, 1), atCap: true };
  };

  // ---- moves ----

  const emit = <E extends keyof BalancerEvents>(event: E, e: BalancerEvents[E]): void => {
    for (const fn of listeners[event] as Set<(e: BalancerEvents[E]) => void>) fn(e);
  };

  /** Moves in the last `MOVE_BUDGET_MS`. */
  const inBudget = (m: Member<M>): boolean => {
    const t = now();
    m.moveTimes = m.moveTimes.filter((at) => t - at < MOVE_BUDGET_MS);
    return m.moveTimes.length < MOVE_BUDGET;
  };

  const save = (m: Member<M>): void => {
    const load = loadOf(m);
    if (!loads || load === undefined) return;
    if (m.savedLoad !== undefined && Math.abs(load - m.savedLoad) < SAVE_DELTA_PCT) return;
    loads.set(m.manifest.id, load);
    m.savedLoad = load;
  };

  const move = (m: Member<M>, to: string, reason: MoveReason, state: PlacementState): void => {
    const from = m.pool;
    const id = m.manifest.id;
    const startedAt = now();
    m.knownLoad = loadOf(m) ?? m.knownLoad;
    m.state = 'moving';
    m.beats = [];
    m.lastBeatAt = undefined;
    // A never-measured isolate's way out of the quarantine is no decision
    // to help: it doesn't count toward the budget (M3j).
    if (!m.unmeasured) m.moveTimes.push(startedAt);
    m.unmeasured = false;
    m.backlogs = [];
    m.backlogHistory = [];
    // A respawned isolate counts its busy time from 0 again.
    m.busyReports = [];
    m.behind = false;
    delete m.arrival;
    // Its new pool is taken at once, so a second move in the same decision
    // doesn't pick the same fresh name.
    m.pool = to;
    changed(from);
    pool(from).watch = true;
    let stopped: Promise<void>;
    try {
      stopped = kernel.stop(id);
    } catch (error) {
      // The host's kernel throws at once for an id it no longer has.
      stopped = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const settled = stopped.then(
      () => {
        // Stopped by the app in the meantime (`stop`), or disposed: no respawn.
        if (disposed || members.get(id) !== m) return;
        changed(to);
        claim.spawn({ ...m.manifest, pool: to });
        m.state = state;
        m.arrivedAt = now();
        m.arrival = { from, to, reason, at: startedAt };
        delete m.stopping;
        emit('move', { id, from, to, reason });
      },
      () => {
        // The kernel couldn't stop it (destroyed, most likely): forget it.
        if (members.get(id) === m) members.delete(id);
      },
    );
    m.stopping = settled;
  };

  /**
   * What a member in quarantine is reported as: an offender is `quarantined`
   * (or `kept-apart` past `maxReturns`); one that never offended is only there
   * to be measured (never measured, or moved in by a bisect): `measuring`.
   */
  const stateFor = (m: Member<M>): PlacementState =>
    m.offences > maxReturns ? 'kept-apart' : m.offences > 0 ? 'quarantined' : 'measuring';

  /** Sends `m` to quarantine for misbehaving (`offence`) or to bisect. */
  const quarantine = (m: Member<M>, reason: MoveReason, offence: boolean): void => {
    m.lastSpikeAt = now();
    if (offence) {
      m.offences++;
      m.unmeasured = false;
    }
    const state = stateFor(m);
    m.quarantinedAt = now();
    if (isQuarantine(m.pool)) {
      m.state = state;
      return;
    }
    move(m, QUARANTINE, reason, state);
  };

  const movable = (m: Member<M>): boolean => live(m) && m.holds === 0;

  /**
   * A member the kernel gave up on beats again: the app restarted it
   * (`kernel.restart`). It's placed again as new (M3j): no offences, no
   * history, and its pool's rules from here.
   */
  const revive = (m: Member<M>): void => {
    m.offences = 0;
    m.state = isQuarantine(m.pool) ? stateFor(m) : 'placed';
    m.quarantinedAt = isQuarantine(m.pool) ? now() : -Infinity;
    m.lastSpikeAt = m.spikeNotedAt = m.decayAt = m.risingAt = m.stuckAt = -Infinity;
    m.arrivedAt = now();
    m.moveTimes = [];
    m.unmeasured = false;
    m.beats = [];
    m.lastBeatAt = undefined;
    m.backlogs = [];
    m.backlogHistory = [];
    m.busyReports = [];
    changed(m.pool);
  };

  // ---- beats ----

  const trim = (beats: Beat[], at: number): void => {
    const cut = at - windowMs;
    while ((beats[0]?.at ?? Infinity) <= cut) beats.shift();
  };

  /** A beat of an isolate the balancer doesn't place, for `measure`. */
  const watchOther = (e: BeatLike): void => {
    const w = seen.get(e.id);
    if (!w) {
      seen.set(e.id, { lastBeatAt: e.at, beats: [] });
      return;
    }
    w.beats.push({ at: e.at, busy: e.busyMs ?? 0, dur: e.at - w.lastBeatAt });
    w.lastBeatAt = e.at;
    trim(w.beats, e.at);
  };

  /**
   * Every heartbeat, as the kernel reports it (`isolate:beat`). A pool's
   * beat comes as one event per member; its lag is recorded once, and a
   * spike is judged once all of them are in.
   */
  const onBeat = (e: BeatLike): void => {
    if (disposed) return;
    const m = members.get(e.id);
    if (!m) {
      watchOther(e);
      return;
    }
    if (m.state === 'moving' || e.pool !== m.pool) return;
    if (m.state === 'failed') revive(m);
    if (m.arrival) {
      const { from, to, reason, at } = m.arrival;
      delete m.arrival;
      emit('arrived', { id: e.id, from, to, reason, costMs: e.at - at });
    }
    if (m.lastBeatAt !== undefined) {
      m.beats.push({ at: e.at, busy: e.busyMs ?? 0, dur: e.at - m.lastBeatAt });
      trim(m.beats, e.at);
    }
    m.lastBeatAt = e.at;
    const p = pool(m.pool);
    if (p.beatAt === undefined || e.at - p.beatAt > BEAT_GAP_MS) {
      p.beatAt = e.at;
      p.beat = [];
      p.lags.push({ at: e.at, lagMs: e.lagMs });
      const cut = e.at - windowMs;
      while ((p.lags[0]?.at ?? Infinity) <= cut) p.lags.shift();
      if (e.lagMs > spikeLag) {
        spiked.add(m.pool);
        // After the rest of this worker message's events, which run in the same task.
        judging ??= setTimeout(judge, 0);
      }
    }
    p.beat.push(m);
  };

  const spike = (e: SpikeEvent): void => emit('spike', e);

  /**
   * A spike (Q6′, M3i): put on the member that was busiest in that beat. A
   * first one is only noted; a second within `SPIKE_REPEAT_MS` sends it to
   * quarantine. One long task is often the data, not the isolate (a file that
   * blocks whichever member gets it), and by the time its beat arrives it's
   * over: moving the member then protects nobody.
   */
  const judge = (): void => {
    judging = undefined;
    if (disposed) return;
    const t = now();
    for (const name of spiked) {
      const p = pool(name);
      const lagMs = p.lags.at(-1)?.lagMs ?? 0;
      const beat = p.beat.filter(
        (m) => members.get(m.manifest.id) === m && m.pool === name && m.state !== 'moving',
      );
      const dur = Math.max(0, ...beat.map((m) => m.beats.at(-1)?.dur ?? 0));
      const busy = beat.reduce((sum, m) => sum + (m.beats.at(-1)?.busy ?? 0), 0);
      if (dur > 0 && (busy / dur) * 100 < ATTRIBUTED_PCT) {
        // Unexplained: the pool's second within the window (or any while a
        // bisect is narrowing this pool down) bisects.
        const narrowing = bisect && beat.some((m) => bisect?.suspects.has(m.manifest.id));
        if (narrowing || t - p.spikeNotedAt < SPIKE_REPEAT_MS) {
          p.spikeNotedAt = -Infinity;
          search(name, 'spike');
        } else p.spikeNotedAt = t;
        continue;
      }
      const culprit = beat
        .filter((m) => m.beats.length > 0)
        .toSorted((a, b) => (b.beats.at(-1)?.busy ?? 0) - (a.beats.at(-1)?.busy ?? 0))[0];
      if (!culprit) continue;
      const id = culprit.manifest.id;
      const repeat = t - culprit.spikeNotedAt < SPIKE_REPEAT_MS;
      if (isQuarantine(name) && culprit.offences > 0) {
        // An offender in quarantine: its quiet window starts again.
        culprit.lastSpikeAt = t;
        spike({ id, pool: name, lagMs, action: 'quarantined' });
        continue;
      }
      // Alone in its pool and never quarantined: it hurts nobody else, and
      // nothing joins its pool while it spikes (`recentlySpiked`).
      const harmless = !isQuarantine(name) && membersOf(name).length < 2 && culprit.offences === 0;
      if (!repeat || !movable(culprit) || harmless) {
        culprit.spikeNotedAt = t;
        spike({ id, pool: name, lagMs, action: 'noted' });
        continue;
      }
      culprit.spikeNotedAt = -Infinity;
      // In quarantine only to be measured, it becomes an offender there.
      quarantine(culprit, 'spike', true);
      spike({ id, pool: name, lagMs, action: 'quarantined' });
    }
    spiked.clear();
  };

  /** Defensive: the host reserves our pools, so nobody else should be in them. */
  const checkForeign = (): void => {
    const present = new Map<string, string>();
    for (const p of kernel.pools()) {
      if (!isOurs(p.name)) continue;
      for (const id of p.members) if (!members.has(id)) present.set(id, p.name);
    }
    for (const [id, name] of present) {
      if (foreign.get(id) === name) continue;
      foreign.set(id, name);
      for (const fn of listeners.foreign) fn({ id, pool: name });
    }
    for (const id of foreign.keys()) if (!present.has(id)) foreign.delete(id);
  };

  // ---- deciding ----

  /**
   * A quarantine pool a bisect from `name` can have to itself (M3j): the
   * first quarantine if it holds only members this bisect moved (or none), else a
   * new quarantine pool if the cap allows. Never one that holds offenders.
   */
  const bisectPool = (name: string): string | undefined => {
    const free = membersOf(QUARANTINE).every(
      (o) => o.offences === 0 && bisect?.moved.has(o.manifest.id) === true,
    );
    if (!isQuarantine(name) && free) return QUARANTINE;
    return roomForQuarantine() ? freshName(QUARANTINES, 2) : undefined;
  };

  /**
   * Finds the member behind a pool's trouble when the kernel or `busyMs`
   * can't name it (Q20): the heavier half of the suspects moves, and
   * whichever half acts up again holds the culprit. Only into a quarantine
   * pool of its own (M3j); with none free, the pool stays as it is and its
   * members are `behind`.
   */
  const search = (name: string, reason: 'spike' | 'sustained' | 'crash'): void => {
    const here = membersOf(name).filter((m) => m.holds === 0);
    if (here.length === 0) return;
    const ids = new Set(here.map((m) => m.manifest.id));
    const prior = bisect && [...bisect.suspects].filter((id) => ids.has(id));
    const suspects = prior && prior.length > 0 ? prior : [...ids];
    if (suspects.length === 1) {
      const culprit = members.get(suspects[0] ?? '');
      bisect = undefined;
      if (!culprit) return;
      // Alone and never quarantined: a lag of its own hurts nobody else.
      if (reason !== 'crash' && membersOf(name).length === 1 && culprit.offences === 0) return;
      // Found: a worker of its own in quarantine when the cap allows (Q18),
      // so it stops taking the other suspects down with it.
      if (membersOf(name).length > 1 && roomForQuarantine()) {
        culprit.offences++;
        culprit.lastSpikeAt = culprit.quarantinedAt = now();
        move(culprit, freshName(QUARANTINES, 2), reason, stateFor(culprit));
      } else quarantine(culprit, reason, true);
      return;
    }
    const sorted = suspects
      .map((id) => members.get(id))
      .filter((m): m is Member<M> => m !== undefined)
      .toSorted((a, b) => (loadOf(b) ?? 0) - (loadOf(a) ?? 0));
    const to = bisectPool(name);
    if (to === undefined) {
      const t = now();
      for (const m of here) {
        m.stuckAt = t;
        behind(m, t);
      }
      return;
    }
    const half = sorted.slice(0, Math.ceil(sorted.length / 2));
    bisect = {
      suspects: new Set(suspects),
      moved: new Set([...(bisect?.moved ?? []), ...half.map((m) => m.manifest.id)]),
      at: now(),
    };
    for (const m of half) {
      if (!isQuarantine(name)) m.quarantinedAt = now();
      move(m, to, 'bisect', stateFor(m));
    }
  };

  /**
   * The moves that would bring pool `name` back under (M3i): the heaviest
   * candidates in turn, each to where the placement rule finds room given
   * the moves before it, until the pool's load is predicted under the line,
   * `FULL_PCT` for a full pool or `headroom` for a lagging one. Returns the
   * first of them, or `undefined` when no such set of moves exists.
   */
  const relief = (
    name: string,
    candidates: Member<M>[],
    busy: number,
    lagging: boolean,
  ): { member: Member<M>; to: string } | undefined => {
    const line = lagging ? headroom : FULL_PCT;
    const added = new Map<string, number>();
    let fresh = 0;
    let left = busy;
    let first: { member: Member<M>; to: string } | undefined;
    for (const m of candidates) {
      if (left < line) break;
      const load = loadOf(m) ?? 0;
      const into = [...new Set([...ownPools(), ...added.keys()])]
        .filter((n) => n !== name && !recentlySpiked(n))
        .map((n) => ({ n, load: poolLoad(n) + (added.get(n) ?? 0) }))
        .filter((c) => c.load + load < headroom)
        .toSorted((a, b) => a.load - b.load)[0];
      let to: string | undefined;
      if (into) to = into.n;
      else if (ownWorkers() + fresh + 1 <= maxWorkers) {
        to = fresh === 0 ? freshName(POOLS, 1) : `${POOLS}-new-${fresh}`;
        fresh++;
      }
      if (to === undefined) continue;
      added.set(to, (added.get(to) ?? 0) + load);
      left -= load;
      first ??= { member: m, to };
    }
    return left < line ? first : undefined;
  };

  /** The latest report, if fresh. */
  const backlogNow = (m: Member<M>, t: number): number | undefined =>
    m.backlog && t - m.backlog.at <= STALE_MS ? m.backlog.value : undefined;

  /**
   * Rising (M3i; two windows since M3j): the latest fresh report is above 0
   * and higher than one taken at least a window before it, which is itself
   * higher than one taken at least a window before that, all since it last
   * moved and since the last backlog move. A queue at a steady rate that
   * jumps once and holds isn't falling behind.
   */
  const rising = (m: Member<M>, t: number): boolean => {
    const latest = m.backlog;
    if (backlogNow(m, t) === undefined || !latest || latest.value <= 0) return false;
    const before = (at: number) =>
      m.backlogs.findLast((b) => b.at >= lastBacklogMoveAt && b.at <= at - BACKLOG_WINDOW_MS);
    const mid = before(latest.at);
    if (mid === undefined || latest.value <= mid.value) return false;
    const early = before(mid.at);
    return early !== undefined && mid.value > early.value;
  };

  /**
   * Somewhere with more CPU for `m` (M3i): a pool of its own if the cap
   * allows, else the balancer's pool with the least load that stays under
   * `headroom` with it and has less load than its own pool-mates.
   */
  const roomier = (m: Member<M>): string | undefined => {
    if (roomForPool()) return freshName(POOLS, 1);
    const load = loadOf(m) ?? 0;
    const mates = poolLoad(m.pool) - load;
    return ownPools()
      .filter((n) => n !== m.pool && !recentlySpiked(n))
      .map((n) => ({ n, load: poolLoad(n) }))
      .filter((c) => c.load + load < headroom && c.load < mates)
      .toSorted((a, b) => a.load - b.load)[0]?.n;
  };

  const behind = (m: Member<M>, t: number): void => {
    m.behind = true;
    if (t - m.behindAt < BEHIND_REPEAT_MS) return;
    m.behindAt = t;
    const e: BehindEvent = { id: m.manifest.id, pool: m.pool, backlog: backlogNow(m, t) ?? 0 };
    emit('behind', e);
  };

  /**
   * Makes room for a backlog (M3j): the quarantine pool beyond the first
   * with the fewest members folds into the first, all of it, which frees
   * its worker. Only like into like: offenders into a first quarantine that
   * holds only offenders (or none), or members that never offended into one
   * that holds none, such as a bisect's two halves meeting again. Anyone
   * who hasn't offended never joins an offender (decision 3). A bisect
   * whose halves meet ends. False when there's no such pool.
   */
  const fold = (): boolean => {
    const first = membersOf(QUARANTINE);
    const fits = (here: Member<M>[]): boolean =>
      here.every(offender) ? first.every(offender) : !here.some(offender) && !first.some(offender);
    const extra = [...new Set([...members.values()].map((m) => m.pool))]
      .filter((n) => isQuarantine(n) && n !== QUARANTINE)
      .map((n) => ({ n, here: membersOf(n) }))
      .filter((c) => c.here.length > 0 && c.here.every(movable) && fits(c.here))
      .toSorted((a, b) => a.here.length - b.here.length)[0];
    if (!extra) return false;
    for (const m of extra.here) {
      if (bisect?.moved.has(m.manifest.id)) bisect = undefined;
      move(m, QUARANTINE, 'room', m.state);
    }
    return true;
  };

  /**
   * Backlog (M3i): of the members whose backlog is rising, the one in the
   * busiest pool (the heaviest there first) moves somewhere with more CPU;
   * one move per fresh window across the balancer, so members of one
   * consumer group move one at a time. One that can't get more CPU is
   * `behind`, unless a quarantine beyond the first holds the worker it
   * needs: that one folds into the first, and the move follows once its
   * worker has stopped (M3j).
   */
  const backlogs = (t: number): void => {
    const up = [...members.values()].filter((m) => {
      const r = m.state === 'placed' && !isQuarantine(m.pool) && rising(m, t);
      if (r) m.risingAt = t;
      // `behind` for a bisect with nowhere to go lasts while that does.
      else if (t - m.stuckAt >= windowMs) m.behind = false;
      return r;
    });
    const order = up.toSorted(
      (a, b) => poolLoad(b.pool) - poolLoad(a.pool) || (loadOf(b) ?? 0) - (loadOf(a) ?? 0),
    );
    for (const m of order) {
      if (!movable(m) || !inBudget(m)) continue;
      const shared = membersOf(m.pool).length >= 2;
      const to = shared ? roomier(m) : undefined;
      if (to === undefined) {
        if (shared) {
          starvedAt = t;
          if (fold()) return;
        }
        behind(m, t);
        continue;
      }
      m.atCap = false;
      lastBacklogMoveAt = t;
      move(m, to, 'backlog', 'placed');
      return;
    }
  };

  /**
   * Its backlog rose over the last `PACK_STEADY_MS` (M3j): the latest fresh
   * report is higher than the one at or just before the window's start (or
   * the oldest since it moved, when it hasn't reported that long). A
   * queue that holds steady while work arrives doesn't count, nor does a
   * stale report or none.
   */
  const roseLately = (m: Member<M>, t: number): boolean => {
    const latest = backlogNow(m, t);
    if (latest === undefined) return false;
    // The report at or just before the window's start, or the oldest one since it moved.
    const start =
      m.backlogHistory.findLast((b) => b.at <= t - PACK_STEADY_MS) ?? m.backlogHistory[0];
    return start !== undefined && latest > start.value;
  };

  /**
   * Packing back (M3i; whole pools since M3j): the lightest pool whose
   * members have all been quiet for `PACK_STEADY_MS` empties into the
   * fullest other pool that stays under `PACK_PCT` with all of it, one
   * member per pack, which frees its worker once the last one is in. A merge
   * that has started is finished first. Never a pool with a member on hold,
   * out of budget, whose backlog rose over the window (M3j), or a
   * quarantine; never into a pool that's moving or whose members' backlog
   * rose.
   */
  const pack = (t: number): void => {
    const quiet = (since: number): boolean => t - since >= PACK_STEADY_MS;
    const steady = (m: Member<M>): boolean =>
      quiet(Math.max(m.arrivedAt, m.lastSpikeAt, m.spikeNotedAt, pool(m.pool).troubleAt)) &&
      !roseLately(m, t);
    const packable = (m: Member<M>): boolean =>
      m.state === 'placed' && movable(m) && inBudget(m) && loadOf(m) !== undefined && steady(m);
    const sources = ownPools()
      .filter((n) => isOurs(n))
      .map((n) => ({ n, all: inPool(n), load: poolLoad(n) }))
      .filter((c) => c.all.length > 0 && c.all.every(packable))
      // The merge already under way first, then the lightest.
      .toSorted(
        (a, b) => Number(b.n === merging?.from) - Number(a.n === merging?.from) || a.load - b.load,
      );
    for (const from of sources) {
      const into = ownPools()
        .filter((n) => n !== from.n && isOurs(n) && !recentlySpiked(n) && quiet(pool(n).troubleAt))
        // Not into a pool that's busy moving, or whose members' work is piling up.
        .filter((n) => inPool(n).every((o) => o.state !== 'moving' && !roseLately(o, t)))
        .map((n) => ({ n, load: poolLoad(n) }))
        .filter((c) => c.load + from.load < PACK_PCT)
        .toSorted(
          (a, b) =>
            Number(b.n === merging?.into) - Number(a.n === merging?.into) || b.load - a.load,
        )[0];
      if (!into) continue;
      const m = from.all.toSorted((a, b) => (loadOf(a) ?? 0) - (loadOf(b) ?? 0))[0];
      if (!m) continue;
      lastPackAt = t;
      merging = from.all.length > 1 ? { from: from.n, into: into.n } : undefined;
      move(m, into.n, 'pack', 'placed');
      return;
    }
  };

  /** The quiet window: doubled per offence, capped at 2 minutes (or `steadyMs`, if longer; M3j). */
  const steadyFor = (m: Member<M>): number =>
    Math.min(Math.max(steadyMs, QUIET_CAP_MS), steadyMs * 2 ** Math.max(0, m.offences - 1));

  /**
   * Offences decay (M3j): an offender back in a balancer pool loses one for
   * each quiet window it completes there, so one that stays quiet is back to
   * the shortest window. One that offends again soon after leaving still
   * gets a longer one, and `kept-apart` stays apart.
   */
  const decay = (t: number): void => {
    for (const m of members.values()) {
      if (m.state !== 'placed' || m.offences === 0) continue;
      if (t - Math.max(m.decayAt, m.lastSpikeAt, m.spikeNotedAt) < steadyFor(m)) continue;
      m.offences--;
      m.decayAt = t;
    }
  };

  const decide = (): void => {
    const t = now();
    checkForeign();
    // Beats of isolates that stopped (a closed preview) are forgotten.
    for (const [id, w] of seen) if (t - w.lastBeatAt > windowMs * 2) seen.delete(id);
    for (const name of killed) search(name, 'crash');
    killed.clear();
    if (bisect && t - bisect.at > steadyMs * 2) bisect = undefined;

    // Sustained (Q6′, Q18) or full (Q15): the heaviest member moves
    // somewhere with room. After a move out, the same check on the pool's
    // next full window is the follow-up: if the pool is still over, the
    // next-heaviest goes too. A move is made only when the moves it starts
    // are predicted to bring the pool back under (M3i): no restart for a
    // move that can't end the trouble.
    for (const name of new Set([...members.values()].map((m) => m.pool))) {
      const here = membersOf(name);
      if (!windowFull(name)) continue;
      const p = pool(name);
      const lagging = median(p.lags.map((l) => l.lagMs)) > sustainedLag;
      const busy = here.reduce((sum, m) => sum + (loadOf(m) ?? 0), 0);
      // The quarantine is never "full": it holds suspects, and its own split below is by lag.
      const full = !isQuarantine(name) && busy >= FULL_PCT;
      if (!lagging && !full) {
        p.watch = false;
        continue;
      }
      p.troubleAt = t;
      if (here.length < 2) continue;
      if (lagging && !full && busy < ATTRIBUTED_PCT) {
        search(name, 'sustained');
        continue;
      }
      const byLoad = here.toSorted((a, b) => (loadOf(b) ?? 0) - (loadOf(a) ?? 0));
      // At first, a heaviest member on hold means wait: moving a lighter one
      // wouldn't relieve the pool. After a move that didn't help, the
      // next-heaviest that can move goes.
      const first = byLoad[0];
      if (!first || (!p.watch && !movable(first))) continue;
      if (isQuarantine(name)) {
        const heaviest = byLoad.find(movable);
        if (heaviest && roomForQuarantine())
          move(heaviest, freshName(QUARANTINES, 2), 'sustained', heaviest.state);
        continue;
      }
      // A lagging pool is `sustained` even when it's also full; `full` is the low-lag case (Q19).
      const reason: MoveReason = lagging ? 'sustained' : 'full';
      const plan = relief(name, byLoad.filter(movable).filter(inBudget), busy, lagging);
      if (plan) {
        plan.member.atCap = false;
        move(plan.member, plan.to, reason, 'placed');
      } else first.atCap = true;
    }

    backlogs(t);
    decay(t);

    // Out of quarantine (Q18, Q19): an isolate only there to be measured
    // (never measured, or moved there by a bisect that has ended) leaves as
    // soon as it has a measurement taken there. An offender leaves after its quiet window (no
    // spike, no crash), whatever its load. Either goes where the placement
    // rule finds room; with none, it stays, flagged at the cap.
    for (const m of members.values()) {
      if (
        (m.state !== 'quarantined' && m.state !== 'measuring') ||
        !movable(m) ||
        !(m.unmeasured || inBudget(m))
      )
        continue;
      const fresh = average(m.beats, windowMs, t);
      if (m.offences === 0) {
        // Members a bisect moved stay until it ends (culprit found, or
        // expired): "whichever half acts up again" needs them kept together.
        if (fresh === undefined || bisect?.moved.has(m.manifest.id)) continue;
      } else if (t - Math.max(m.quarantinedAt, m.lastSpikeAt) < steadyFor(m)) continue;
      const load = fresh ?? m.knownLoad;
      if (load === undefined) continue;
      const to = target(load, m.pool);
      if (!to || to.atCap) {
        m.atCap = true;
        continue;
      }
      m.atCap = false;
      m.decayAt = t;
      move(m, to.pool, m.offences === 0 ? 'measured' : 'steady', 'placed');
    }

    if (packing && t - lastPackAt >= PACK_EVERY_MS) pack(t);

    if (t - lastSave >= SAVE_MS) {
      lastSave = t;
      for (const m of members.values()) save(m);
    }
  };

  const onCrash = (e: CrashLike): void => {
    const m = members.get(e.id);
    if (!m || !live(m)) return;
    if (POOL_KILL.has(e.reason) && e.pool !== undefined) killed.add(e.pool);
    else if (e.reason === 'error') {
      // Its own fatal error: the culprit is known (Q6′).
      if (m.holds > 0) m.lastSpikeAt = now();
      else quarantine(m, 'crash', true);
    }
  };

  /**
   * The kernel gave up on a member (M3j): it leaves its pool's load, the
   * quarantine's count and any bisect, and stays where it is until the app
   * restarts it. A member mid-move was stopped by the balancer itself; its
   * respawn is a fresh start.
   */
  const onFailed = (e: FailedLike): void => {
    const m = members.get(e.id);
    if (!m || !live(m)) return;
    m.state = 'failed';
    m.beats = [];
    m.lastBeatAt = undefined;
    m.atCap = false;
    m.behind = false;
    m.busyReports = [];
    delete m.arrival;
    bisect?.suspects.delete(e.id);
    bisect?.moved.delete(e.id);
    changed(m.pool);
    emit('failed', { id: e.id, pool: m.pool, reason: e.reason });
  };

  const timer = setInterval(decide, DECIDE_MS);
  const offs = [
    kernel.on('isolate:crash', onCrash),
    kernel.on('isolate:beat', onBeat),
    kernel.on('isolate:failed', onFailed),
  ];

  const placement = (m: Member<M>): Placement => {
    const p: Placement = {
      id: m.manifest.id,
      pool: m.pool,
      state: m.state,
      loadPct: m.state === 'failed' ? undefined : loadOf(m),
    };
    const reported = m.state === 'failed' ? undefined : reportedOf(m, now());
    if (reported !== undefined) p.reportedPct = reported;
    if (m.atCap) p.atCap = true;
    const backlog = backlogNow(m, now());
    if (backlog !== undefined) p.backlog = backlog;
    if (m.behind) p.behind = true;
    return p;
  };

  return {
    spawn(manifest) {
      if (disposed) throw new TypeError('balancer.spawn: this balancer was disposed');
      if (manifest.pool !== undefined)
        throw new TypeError(`balancer.spawn: "${manifest.id}" names a pool; the balancer picks it`);
      if (members.has(manifest.id))
        throw new TypeError(`balancer.spawn: "${manifest.id}" is already running`);
      const known = loads?.get(manifest.id);
      // Never measured (Q17): it starts in quarantine and earns its way out.
      const to = known === undefined ? { pool: QUARANTINE, atCap: false } : target(known);
      const dest = to ?? { pool: QUARANTINE, atCap: true };
      const m: Member<M> = {
        manifest,
        pool: dest.pool,
        state: isQuarantine(dest.pool) ? 'measuring' : 'placed',
        beats: [],
        lastBeatAt: undefined,
        knownLoad: known,
        savedLoad: known,
        offences: 0,
        quarantinedAt: isQuarantine(dest.pool) ? now() : -Infinity,
        decayAt: -Infinity,
        lastSpikeAt: -Infinity,
        spikeNotedAt: -Infinity,
        holds: 0,
        atCap: dest.atCap,
        arrivedAt: now(),
        moveTimes: [],
        unmeasured: known === undefined,
        backlogs: [],
        backlog: undefined,
        backlogHistory: [],
        busyReports: [],
        risingAt: -Infinity,
        stuckAt: -Infinity,
        behind: false,
        behindAt: -Infinity,
      };
      members.set(manifest.id, m);
      changed(dest.pool);
      claim.spawn({ ...manifest, pool: dest.pool });
      return placement(m);
    },
    async stop(id) {
      const m = members.get(id);
      if (!m) return kernel.stop(id);
      save(m);
      members.delete(id);
      changed(m.pool);
      // Mid-move the kernel has already stopped the old copy, and the
      // respawn is cancelled by the member being gone: wait for the stop.
      if (m.state === 'moving' && m.stopping) return m.stopping;
      await kernel.stop(id);
    },
    placements() {
      const ours = [...members.values()].map(placement);
      const others = [...foreign].map(([id, name]): Placement => ({
        id,
        pool: name,
        state: 'placed',
        loadPct: average(seen.get(id)?.beats ?? [], windowMs, now()),
        foreign: true,
      }));
      return [...ours, ...others];
    },
    hold(id) {
      const m = members.get(id);
      if (!m) return () => {};
      m.holds++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        m.holds--;
      };
    },
    report(id, { backlog, busyMs }) {
      if (backlog === undefined && busyMs === undefined)
        throw new TypeError('balancer.report: give a backlog, a busyMs or both');
      if (backlog !== undefined && !valid(backlog))
        throw new TypeError('balancer.report: backlog must be a finite number, 0 or more');
      if (busyMs !== undefined && !valid(busyMs))
        throw new TypeError('balancer.report: busyMs must be a finite number, 0 or more');
      const m = members.get(id);
      if (!m || m.state === 'failed') return;
      const t = now();
      if (backlog !== undefined) {
        const sample = { at: t, value: backlog };
        m.backlog = sample;
        m.backlogs.push(sample);
        m.backlogHistory.push(sample);
        // Keep the latest sample at or before three windows ago, and everything
        // after: two rising windows back from any report in the last one.
        while ((m.backlogs[1]?.at ?? Infinity) <= t - 3 * BACKLOG_WINDOW_MS) m.backlogs.shift();
        while ((m.backlogHistory[1]?.at ?? Infinity) <= t - PACK_STEADY_MS)
          m.backlogHistory.shift();
      }
      if (busyMs !== undefined) {
        // A total that went down: the app started counting again.
        if ((m.busyReports.at(-1)?.total ?? 0) > busyMs) m.busyReports = [];
        m.busyReports.push({ at: t, total: busyMs });
        // Keep the latest report at or before a window and the stale time ago, and everything after.
        const cut = t - windowMs - STALE_MS;
        while ((m.busyReports[1]?.at ?? Infinity) <= cut) m.busyReports.shift();
      }
    },
    measure(id) {
      const m = members.get(id);
      if (m) return average(m.beats, windowMs, now());
      const s = seen.get(id);
      return s && average(s.beats, windowMs, now());
    },
    on(event, fn) {
      const set = listeners[event] as Set<typeof fn>;
      set.add(fn);
      return () => void set.delete(fn);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      claim.release();
      clearInterval(timer);
      if (judging !== undefined) clearTimeout(judging);
      for (const off of offs) off();
      for (const set of Object.values(listeners)) set.clear();
    },
  };
}
