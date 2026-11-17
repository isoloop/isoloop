/**
 * The part of the kernel the balancer uses: the public API only (`spawn`,
 * `stop`, `pools`, and the `isolate:beat`, `isolate:crash` and
 * `isolate:failed` events), so `@isoloop/host`'s `Kernel` fits it as is.
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

/** What the balancer reads from an isolate manifest: its id, and the pool it sets. */
export type ManifestLike = { id: string; pool?: string };

/** The kernel's `isolate:beat` event (ADR 0017). */
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

/** The fields of `PoolSnapshot` the balancer reads. */
export type PoolLike = { name: string; members: readonly string[]; running: boolean };

/** The fields of the kernel's `isolate:crash` event the balancer reads. */
export type CrashLike = { id: string; reason: string; pool?: string };

/** The fields of the kernel's `isolate:failed` event the balancer reads (M3j). */
export type FailedLike = { id: string; reason: string; pool?: string };

/**
 * Where the balancer keeps each isolate's measured load between page loads,
 * so a reload places from history (M3h, Q17). The app supplies it; the
 * creator backs it with a persistent topic. `get` returning `undefined`
 * means "never measured": the isolate starts in quarantine.
 */
export interface LoadStore {
  get(id: string): number | undefined;
  set(id: string, loadPct: number): void;
}

export type BalancerOptions = {
  /**
   * The balancer's own allowance of workers (ADR 0017, amended): its
   * `balancer-N` pools, plus any quarantine worker beyond the first. The
   * quarantine, `balancer-quarantine-1`, is allowed on top, and workers the
   * app runs itself don't count; the kernel's budget stays the page-wide
   * warning. Default `max(2, navigator.hardwareConcurrency - 2)`; at least 1.
   */
  maxWorkers?: number;
  /**
   * A beat with the pool's `lagMs` above this is a spike, put on the member
   * that was busiest in it. A first spike is only reported (`spike`, action
   * `noted`); a second from the same member within 60 s sends it to
   * quarantine (M3i). Default 100.
   */
  spike?: { lagMs?: number };
  /**
   * The pool's median `lagMs` above `lagMs` over `forMs` moves its heaviest
   * member out. Default 50 ms over 3,000 ms. So does a pool whose members'
   * busy time adds up to 80 % of a core or more over the same window, whatever
   * its lag (a fixed threshold, above `headroom`).
   */
  sustained?: { lagMs?: number; forMs?: number };
  /** An isolate joins a pool only while pool load + its load stays under `loadPct`. Default 60. */
  headroom?: { loadPct?: number };
  /**
   * Leaving quarantine: an isolate there only to be measured leaves once it
   * has 3 s of beats there, or, if a bisect moved it there, once that bisect
   * ends. An offender leaves after `steadyMs` (default 30,000 ms) with no
   * spike and no crash, whatever its load; each offence doubles the window
   * (30, 60, 120 s), capped at 2 minutes (or `steadyMs`, if longer). Back in
   * a balancer pool, an offender loses one offence for each quiet window it
   * completes there (M3j). After `maxReturns` returns (default 3) the next
   * offence keeps it apart for good. Either goes where the placement rule
   * finds room, or stays, flagged `atCap`, until there is.
   */
  quarantine?: { steadyMs?: number; maxReturns?: number };
  loads?: LoadStore;
  /**
   * Packing back (M3i): a member alone in its pool and steady for 60 s (no
   * spike, crash, lagging or full pool, and a backlog no higher than 60 s
   * before, M3j) joins another of the balancer's pools if both together stay
   * under 40 % of a core, freeing a worker. At most one pack every 60 s. On by
   * default.
   */
  pack?: { enabled?: boolean };
};

/**
 * What the app tells the balancer about an isolate (`report`): its queued
 * work, its own measured busy time, or both. At least one must be given.
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
   * a running total, so a late or missed report still counts (M3j). For work
   * the kernel's `busyMs` misses, such as slices resumed after `await`. The
   * balancer takes its difference over the 3 s window and uses the larger of
   * that and the beats' figure. A total that goes down is taken as a restart
   * of the count.
   */
  busyMs?: number;
};

/**
 * `failed`: the kernel gave up on the isolate (past its restart limit, M3j).
 * The balancer never moves or restarts it; after `kernel.restart(id)` it's
 * placed again as new.
 */
export type PlacementState = 'placed' | 'quarantined' | 'kept-apart' | 'moving' | 'failed';

export type Placement = {
  id: string;
  pool: string;
  state: PlacementState;
  /**
   * Measured share of one core, 0–100: the larger of the beats' `busyMs` and
   * the app's reported `busyMs` over the last 3 s; `undefined` until measured.
   */
  loadPct: number | undefined;
  /** The share of one core from the app's `busyMs` reports alone, while they're fresh (M3j). */
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
 * unnamed culprit), `steady` (back out of quarantine), `backlog` (its
 * reported backlog kept rising, M3i) or `pack` (a quiet member joining
 * another pool to free a worker, M3i).
 */
export type MoveReason =
  | 'spike'
  | 'sustained'
  | 'full'
  | 'crash'
  | 'bisect'
  | 'steady'
  | 'backlog'
  | 'pack';

/** A move, once the old copy has stopped and the new one is spawned. */
export type MoveEvent = { id: string; from: string; to: string; reason: MoveReason };

/**
 * A moved member's first beat in its new pool (M3i). `costMs` is the time from
 * the balancer stopping it to that beat: what the move cost the isolate. It
 * follows `move`, which fires before the cost is known; a member stopped or
 * moved again before it beats never arrives.
 */
export type ArrivedEvent = MoveEvent & { costMs: number };

/**
 * A spike put on a member (M3i): `noted` for a first one (nothing moves), or
 * `quarantined` when it sends the member to quarantine, or restarts the quiet
 * window of one already there.
 */
export type SpikeEvent = {
  id: string;
  pool: string;
  lagMs: number;
  action: 'noted' | 'quarantined';
};

/**
 * A member's reported backlog keeps rising, but it already has its pool to
 * itself or the balancer has no worker or pool to give it (M3i). Also when
 * its pool's trouble needs a bisect and no quarantine pool is free for one
 * (M3j). Emitted when it first happens, then at most every 30 s while it
 * lasts. `backlog` is the latest fresh report, or 0.
 */
export type BehindEvent = { id: string; pool: string; backlog: number };

/**
 * The kernel gave up on a member (`isolate:failed`, M3j). It drops out of its
 * pool's load and any bisect, and no move restarts it.
 */
export type FailedEvent = { id: string; pool: string; reason: string };

/** An isolate the balancer didn't place turned up in one of its pools (see `Placement.foreign`). */
export type ForeignEvent = { id: string; pool: string };

export type BalancerEvents = {
  move: MoveEvent;
  arrived: ArrivedEvent;
  spike: SpikeEvent;
  behind: BehindEvent;
  failed: FailedEvent;
  foreign: ForeignEvent;
};

/**
 * Pools are named `balancer-1`, `balancer-2`…; the quarantine is
 * `balancer-quarantine-1`, and `-2`, `-3`… when a suspect needs a worker of
 * its own. `createBalancer` throws `balancer_exists` if the kernel has one.
 */
export interface Balancer<M extends ManifestLike = ManifestLike> {
  /** Like `kernel.spawn`, but the balancer picks `pool`; `manifest.pool` must be absent. */
  spawn(manifest: M): Placement;
  stop(id: string): Promise<void>;
  placements(): Placement[];
  /**
   * `id`'s load over the last 3 s, as a share of one core (0–100), whether
   * the balancer placed it or not: a preview's, for `loads.set` on Save.
   * `undefined` until 3 s of beats have been seen.
   */
  measure(id: string): number | undefined;
  /** Leaves `id` where it is until the returned function is called (a widget open for editing). */
  hold(id: string): () => void;
  /**
   * The app's view of `id`'s queued work (M3i) and of its own busy time (M3j).
   * A backlog higher at the end of a 10 s window than at its start, and above
   * 0, moves the isolate somewhere with more CPU. A reported `busyMs` total
   * counts toward its load wherever the balancer reads one. A report older
   * than 10 s counts as none, so report at least every few seconds. Throws a
   * `TypeError` for a report with neither field, or a field that isn't a
   * finite number of 0 or more. Ignored for isolates the balancer didn't place
   * and ones the kernel gave up on.
   */
  report(id: string, report: Report): void;
  on<E extends keyof BalancerEvents>(event: E, fn: (e: BalancerEvents[E]) => void): () => void;
  /**
   * Stops watching and gives back the kernel's claim, so another balancer
   * can be created on it; isolates keep running where they are. `spawn`
   * throws afterwards.
   */
  dispose(): void;
}
