import type { IsolateManifest } from '@isoloop/host';

/**
 * The part of the kernel the balancer uses: the public API only (`spawn`,
 * `stop`, `pools`, and the `isolate:beat`, `isolate:crash` and
 * `isolate:failed` events), so `@isoloop/host`'s `Kernel` fits it as is.
 * The tests' simulated kernel is one too.
 * @internal
 */
export interface KernelLike<M extends ManifestLike = ManifestLike> {
  spawn(manifest: M): unknown;
  stop(id: string): Promise<void>;
  pools(): readonly PoolLike[];
  on(event: 'isolate:crash', fn: (e: CrashLike) => void): () => void;
  /** Every heartbeat as it arrives, once per member of a pool (ADR 0017). */
  on(event: 'isolate:beat', fn: (e: BeatLike) => void): () => void;
  /** An isolate past the kernel's restart limit: it stays down until `kernel.restart` (M3j). */
  on(event: 'isolate:failed', fn: (e: FailedLike) => void): () => void;
  /**
   * Only for kernels not made by `createKernel` (a simulated one in tests):
   * the claim of the `balancer-*` pools, as the host's `claimPools` gives it.
   * The host's `Kernel` has none; the balancer then calls the host's.
   */
  claimPools?(owner: 'balancer'): { spawn(manifest: M): unknown; release?(): void };
}

/** What the balancer reads from an isolate manifest: its id, and the pool it sets. @internal */
export type ManifestLike = { id: string; pool?: string };

/** The kernel's `isolate:beat` event (ADR 0017). @internal */
export type BeatLike = {
  id: string;
  pool?: string;
  /** The worker's lag at this beat: the same for every member of a pool. */
  lagMs: number;
  /**
   * Time this isolate spent running in the interval the beat covers.
   * Absent from runtimes that don't report it; read as 0.
   */
  busyMs?: number;
  /** The host's `performance.now()` on receipt. */
  at: number;
};

/** The fields of `PoolSnapshot` the balancer reads. @internal */
export type PoolLike = { name: string; members: readonly string[]; running: boolean };

/** The fields of the kernel's `isolate:crash` event the balancer reads. @internal */
export type CrashLike = { id: string; reason: string; pool?: string };

/** The fields of the kernel's `isolate:failed` event the balancer reads. @internal */
export type FailedLike = { id: string; reason: string; pool?: string };

/**
 * Where the balancer keeps each isolate's measured load between page loads,
 * so a reload places it from history instead of measuring it again. The app
 * supplies it, for example backed by a persistent topic.
 * @experimental
 */
export interface LoadStore {
  /**
   * The load saved for `id`.
   * @param id The isolate's id.
   * @returns Its share of one core (0–100), or `undefined` if it was never
   *   measured, in which case the isolate starts in quarantine.
   */
  get(id: string): number | undefined;
  /**
   * Saves `id`'s measured load. The balancer calls it every 10 s when a
   * load has moved by 5 points or more since it was saved, and when the
   * isolate stops. The app can call it too, with `measure()`'s figure.
   * @param id The isolate's id.
   * @param loadPct Its share of one core, 0–100.
   */
  set(id: string, loadPct: number): void;
}

/** The options of `createBalancer`: its worker allowance and the thresholds that move isolates. @experimental */
export type BalancerOptions = {
  /**
   * The balancer's own allowance of workers: its `balancer-N` pools, plus any
   * quarantine worker beyond the first. The quarantine,
   * `balancer-quarantine-1`, is allowed on top, and workers the app runs
   * itself don't count; the kernel's worker budget stays the page-wide
   * warning. Default `max(2, navigator.hardwareConcurrency - 2)`, taking 4 as the
   * core count when there is no `navigator`. A value you set is raised to 1 if it's lower.
   */
  maxWorkers?: number;
  /**
   * When a long task is a spike. A first spike from a member is only
   * reported (`spike`, action `noted`); a second from the same member within
   * 60 s sends it to quarantine.
   */
  spike?: {
    /**
     * A beat with the pool's `lagMs` above this is a spike, put on the member
     * that was busiest in it. Default `100`.
     */
    lagMs?: number;
  };
  /**
   * When a pool's lag stays high. The pool's heaviest member moves out. So
   * does a pool whose members' busy time adds up to 80 % of a core or more
   * over the same window, whatever its lag (a fixed threshold, above
   * `headroom`).
   */
  sustained?: {
    /** The pool's median `lagMs` that counts as high. Default `50`. */
    lagMs?: number;
    /** How long it has to stay high, in milliseconds. Default `3000`. */
    forMs?: number;
  };
  /** How much room a pool keeps. */
  headroom?: {
    /**
     * An isolate joins a pool only while the pool's load plus its own stays
     * under this share of one core. Default `60`.
     */
    loadPct?: number;
  };
  /**
   * Leaving quarantine. An isolate there only to be measured leaves once it
   * has 3 s of beats there, or, if a bisect moved it there, once that bisect
   * ends. An offender leaves after a quiet window with no spike and no crash,
   * whatever its load; each offence doubles the window (30, 60, 120 s),
   * capped at 2 minutes (or `steadyMs`, if longer). Back in a balancer pool,
   * an offender loses one offence for each quiet window it completes there.
   * Either goes where the placement rule finds room, or stays, flagged
   * `atCap`, until there is.
   */
  quarantine?: {
    /** An offender's first quiet window, in milliseconds. Default `30000`. */
    steadyMs?: number;
    /** After this many returns, the next offence keeps it apart for good. Default `3`. */
    maxReturns?: number;
  };
  /**
   * Where measured loads are kept between page loads. Default: none, so
   * every isolate starts in quarantine to be measured.
   */
  loads?: LoadStore;
  /**
   * Packing back. A pool whose members have all been steady for 60 s (no
   * spike, crash, lagging or full pool, and a backlog no higher than 60 s
   * before) empties into another of the balancer's pools if both together
   * stay under 40 % of a core, one member per pack, freeing a worker once the
   * last is in. At most one pack every 60 s.
   */
  pack?: {
    /** Pack pools back together. Default `true`. */
    enabled?: boolean;
  };
};

/**
 * What the app tells the balancer about an isolate (`report`): its queued
 * work, its own measured busy time, or both. At least one must be given.
 * @experimental
 */
export type Report = {
  /**
   * Work items waiting for the isolate, in any unit the app likes, as long as
   * it's the same one each time. For a consumer group, report the group's
   * backlog on every member.
   */
  backlog?: number;
  /**
   * Milliseconds of work the app measured for the isolate since it started:
   * a running total, so a late or missed report still counts. For work the
   * kernel's `busyMs` misses, such as slices resumed after `await`. The
   * balancer takes its difference over the 3 s window and uses the larger of
   * that and the beats' figure. A total that goes down is taken as a restart
   * of the count.
   */
  busyMs?: number;
};

/**
 * Where an isolate stands:
 * - `placed`: in one of the balancer's pools;
 * - `measuring`: in a quarantine pool only to be measured, because it was
 *   never measured or a bisect moved it there; it leaves once it has been
 *   measured, and becomes `quarantined` in place if it spikes or crashes first;
 * - `quarantined`: in a quarantine pool after an offence (a second spike, a
 *   crash, or a bisect's culprit);
 * - `kept-apart`: an offender past `quarantine.maxReturns`, kept out of the
 *   shared pools for good;
 * - `moving`: stopped, and being spawned in its new pool;
 * - `failed`: the kernel gave up on it (past its restart limit). The balancer
 *   never moves or restarts it; after `kernel.restart(id)` it's placed again
 *   as new.
 * @experimental
 */
export type PlacementState =
  | 'placed'
  | 'measuring'
  | 'quarantined'
  | 'kept-apart'
  | 'moving'
  | 'failed';

/** Where the balancer has put an isolate, and what it knows of its load. @experimental */
export type Placement = {
  /** The isolate's id. */
  id: string;
  /** The pool it's in. */
  pool: string;
  /** Where it stands. */
  state: PlacementState;
  /**
   * Measured share of one core, 0–100: the larger of the beats' `busyMs` and
   * the app's reported `busyMs` over the last 3 s; `undefined` until measured.
   */
  loadPct: number | undefined;
  /** The share of one core from the app's `busyMs` reports alone, while they're fresh. */
  reportedPct?: number;
  /** No pool had room and the worker cap was reached: placed anyway, or left where it is. */
  atCap?: true;
  /** The latest backlog `report`, while it's fresh (under 10 s old). */
  backlog?: number;
  /**
   * Its backlog is rising, or its pool needs a bisect, and the balancer has
   * nowhere to give it (`behind`).
   */
  behind?: true;
  /**
   * In one of the balancer's pools, but not placed by it. The host reserves
   * `balancer-*` pools, so this shouldn't happen; it is never moved.
   */
  foreign?: true;
};

/**
 * Why a member moved: `spike` (a second long task within 60 s), `sustained`
 * (the pool's lag stayed high), `full` (the pool's members' busy time reached
 * 80 % of a core, whatever its lag), `crash`, `bisect` (looking for a pool's
 * unnamed culprit), `measured` (out of quarantine after being measured there),
 * `steady` (an offender back out of quarantine after its quiet window), `backlog` (its
 * reported backlog kept rising), `pack` (a quiet member joining another pool
 * to free a worker) or `room` (a quarantine pool beyond the first folding
 * into the first, like with like, so a member whose backlog is rising gets
 * its worker).
 * @experimental
 */
export type MoveReason =
  | 'spike'
  | 'sustained'
  | 'full'
  | 'crash'
  | 'bisect'
  | 'steady'
  | 'measured'
  | 'backlog'
  | 'pack'
  | 'room';

/** A move, once the old copy has stopped and the new one is spawned. @experimental */
export type MoveEvent = {
  /** The isolate's id. */
  id: string;
  /** The pool it left. */
  from: string;
  /** The pool it was spawned in. */
  to: string;
  /** Why it moved. */
  reason: MoveReason;
};

/**
 * A moved member's first beat in its new pool. It follows `move`, which fires
 * before the cost is known; a member stopped or moved again before it beats
 * never arrives.
 * @experimental
 */
export type ArrivedEvent = MoveEvent & {
  /** The time from the balancer stopping it to that beat, in milliseconds: what the move cost the isolate. */
  costMs: number;
};

/**
 * A spike put on a member: `noted` for a first one (nothing moves), or
 * `quarantined` when it sends the member to quarantine, or restarts the quiet
 * window of one already there.
 * @experimental
 */
export type SpikeEvent = {
  /** The member the spike was put on: the busiest in the beat. */
  id: string;
  /** Its pool. */
  pool: string;
  /** The pool's lag in that beat, in milliseconds. */
  lagMs: number;
  /** What the balancer did. */
  action: 'noted' | 'quarantined';
};

/**
 * A member's reported backlog keeps rising, but it already has its pool to
 * itself or the balancer has no worker or pool to give it. Also when its
 * pool's trouble needs a bisect and no quarantine pool is free for one.
 * Emitted when it first happens, then at most every 30 s while it lasts.
 * @experimental
 */
export type BehindEvent = {
  /** The isolate's id. */
  id: string;
  /** Its pool. */
  pool: string;
  /** The latest fresh backlog report, or 0. */
  backlog: number;
};

/**
 * The kernel gave up on a member (`isolate:failed`). It drops out of its
 * pool's load and any bisect, and no move restarts it.
 * @experimental
 */
export type FailedEvent = {
  /** The isolate's id. */
  id: string;
  /** The pool it was in. */
  pool: string;
  /** The kernel's reason for giving up. */
  reason: string;
};

/** An isolate the balancer didn't place turned up in one of its pools (see `Placement.foreign`). @experimental */
export type ForeignEvent = {
  /** The isolate's id. */
  id: string;
  /** The balancer's pool it turned up in. */
  pool: string;
};

/** The events `Balancer.on` takes, by name. @experimental */
export type BalancerEvents = {
  /** An isolate moved. */
  move: MoveEvent;
  /** A moved isolate beat in its new pool. */
  arrived: ArrivedEvent;
  /** A spike was put on an isolate. */
  spike: SpikeEvent;
  /** An isolate is behind and has nowhere to go. */
  behind: BehindEvent;
  /** The kernel gave up on an isolate. */
  failed: FailedEvent;
  /** An isolate the balancer didn't place is in one of its pools. */
  foreign: ForeignEvent;
};

/**
 * The balancer `createBalancer` returns. Pools are named `balancer-1`,
 * `balancer-2`…; the quarantine is `balancer-quarantine-1`, and `-2`, `-3`…
 * when a suspect needs a worker of its own.
 * @experimental
 */
export interface Balancer {
  /**
   * Spawns an isolate like `kernel.spawn`, but the balancer picks its pool:
   * from its saved load if `loads` has one, else the quarantine, to be
   * measured.
   * @param manifest The isolate's manifest, without `pool`.
   * @returns Where it was placed.
   * @throws {TypeError} When `manifest.pool` is set, when the id is already
   *   running under this balancer, or after `dispose()`. Otherwise it throws
   *   what `kernel.spawn` throws for the manifest.
   */
  spawn(manifest: IsolateManifest): Placement;
  /**
   * Stops an isolate and saves its load to `loads`. For an isolate the
   * balancer didn't place, it's `kernel.stop(id)`.
   * @param id The isolate's id.
   * @returns A promise that resolves once it has stopped.
   */
  stop(id: string): Promise<void>;
  /**
   * Every isolate in the balancer's pools, its own and any foreign ones.
   * @returns One placement each.
   */
  placements(): Placement[];
  /**
   * `id`'s load over the last 3 s, as a share of one core (0–100), whether
   * the balancer placed it or not: a preview's, for `loads.set` on Save.
   * @param id The isolate's id.
   * @returns The load, or `undefined` until 3 s of beats have been seen.
   */
  measure(id: string): number | undefined;
  /**
   * Leaves `id` where it is, for example while a widget is open for editing.
   * Holds stack.
   * @param id The isolate's id.
   * @returns The function that releases this hold.
   */
  hold(id: string): () => void;
  /**
   * The app's view of `id`'s queued work and of its own busy time. A backlog
   * that rose over two 10 s windows in a row, and is above 0, moves the
   * isolate somewhere with more CPU. A reported `busyMs` total counts toward
   * its load wherever the balancer reads one. A report older than 10 s counts
   * as none, so report at least every few seconds. Ignored for isolates the
   * balancer didn't place and ones the kernel gave up on.
   * @param id The isolate's id.
   * @param report Its backlog, its busy time, or both.
   * @throws {TypeError} For a report with neither field, or a field that
   *   isn't a finite number of 0 or more.
   */
  report(id: string, report: Report): void;
  /**
   * Listens for one of the balancer's events.
   * @param event The event's name.
   * @param fn Called with each event.
   * @returns The function that stops listening.
   */
  on<E extends keyof BalancerEvents>(event: E, fn: (e: BalancerEvents[E]) => void): () => void;
  /**
   * Stops watching and gives back the kernel's claim, so another balancer
   * can be created on it; isolates keep running where they are. `spawn`
   * throws afterwards.
   */
  dispose(): void;
}

/**
 * `Balancer` for any `KernelLike`'s manifest (the tests' simulated kernel).
 * @internal
 */
export type BalancerOf<M extends ManifestLike = ManifestLike> = Omit<Balancer, 'spawn'> & {
  spawn(manifest: M): Placement;
};
