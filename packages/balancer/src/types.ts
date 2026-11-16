/**
 * The part of the kernel the balancer uses: the public API only (`spawn`,
 * `stop`, `pools`, and the `isolate:beat` and `isolate:crash` events), so
 * `@isoloop/host`'s `Kernel` fits it as is.
 */
export interface KernelLike<M extends ManifestLike = ManifestLike> {
  spawn(manifest: M): unknown;
  stop(id: string): Promise<void>;
  pools(): readonly PoolLike[];
  on(event: 'isolate:crash', fn: (e: CrashLike) => void): () => void;
  /** Every heartbeat as it arrives, once per member of a pool (ADR 0017). */
  on(event: 'isolate:beat', fn: (e: BeatLike) => void): () => void;
  /**
   * Only for kernels not made by `createKernel` (a simulated one in tests):
   * the claim of the `balancer-*` pools, as the host's `claimPools` gives it.
   * The host's `Kernel` has none; the balancer then calls the host's.
   */
  claimPools?(owner: 'balancer'): { spawn(manifest: M): unknown };
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
  /** One beat with the pool's `lagMs` above this moves its busiest member to quarantine. Default 100. */
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
   * has 3 s of beats there. An offender leaves after `steadyMs` (default
   * 30,000 ms) with no spike and no crash, whatever its load; each offence
   * doubles the window (30, 60, 120 s), and after `maxReturns` returns
   * (default 3) the next offence keeps it apart for good. Either goes where
   * the placement rule finds room, or stays, flagged `atCap`, until there is.
   */
  quarantine?: { steadyMs?: number; maxReturns?: number };
  loads?: LoadStore;
};

export type PlacementState = 'placed' | 'quarantined' | 'kept-apart' | 'moving';

export type Placement = {
  id: string;
  pool: string;
  state: PlacementState;
  /** Measured share of one core, 0–100; `undefined` until measured. */
  loadPct: number | undefined;
  /** No pool had room and the worker cap was reached: placed anyway, or left where it is. */
  atCap?: true;
  /**
   * In one of the balancer's pools, but not placed by it. The host reserves
   * `balancer-*` pools, so this shouldn't happen; it is never moved.
   */
  foreign?: true;
};

/**
 * Why a member moved: `spike` (one long task), `sustained` (the pool's lag
 * stayed high), `full` (the pool's members' busy time reached 80 % of a core,
 * whatever its lag), `crash`, `bisect` (looking for a pool's unnamed
 * culprit), or `steady` (back out of quarantine).
 */
export type MoveReason = 'spike' | 'sustained' | 'full' | 'crash' | 'bisect' | 'steady';

export type MoveEvent = { id: string; from: string; to: string; reason: MoveReason };

/** An isolate the balancer didn't place turned up in one of its pools (see `Placement.foreign`). */
export type ForeignEvent = { id: string; pool: string };

export type BalancerEvents = { move: MoveEvent; foreign: ForeignEvent };

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
  on<E extends keyof BalancerEvents>(event: E, fn: (e: BalancerEvents[E]) => void): () => void;
  /** Stops watching; isolates keep running where they are. */
  dispose(): void;
}
