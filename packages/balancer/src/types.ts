/**
 * The part of the kernel the balancer uses: the public API only (`spawn`,
 * `stop`, `isolates`, `pools`, `on`), so `@isoloop/host`'s `Kernel` fits it
 * as is. `busyMs` comes with the per-member load timing of M3h; without it
 * every member reads as idle and only spikes and crashes move anything.
 */
export interface KernelLike<M extends ManifestLike = ManifestLike> {
  spawn(manifest: M): unknown;
  stop(id: string): Promise<void>;
  isolates(): readonly IsolateLike[];
  pools(): readonly PoolLike[];
  on(event: 'isolate:crash', fn: (e: CrashLike) => void): () => void;
}

/** What the balancer reads from an isolate manifest: its id, and the pool it sets. */
export type ManifestLike = { id: string; pool?: string };

/** The fields of `IsolateSnapshot` the balancer reads. */
export type IsolateLike = {
  id: string;
  state: string;
  pool?: string;
  /** `performance.now()` of the last beat. */
  lastBeatAt: number;
  /** The worker's lag at the last beat: the same for every member of a pool. */
  lagMs: number;
  /** Time this isolate spent running in the last heartbeat interval (M3h). */
  busyMs?: number;
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
   * Most workers the page may run, counting every worker: the bus, own
   * workers, manual pools and the balancer's. Default
   * `max(2, navigator.hardwareConcurrency - 2)`. One is always kept for the
   * quarantine, and one auto pool is always allowed.
   */
  maxWorkers?: number;
  /** One beat with the pool's `lagMs` above this moves its busiest member to quarantine. Default 100. */
  spike?: { lagMs?: number };
  /** The pool's median `lagMs` above `lagMs` over `forMs` moves its heaviest member out. Default 50 ms over 3,000 ms. */
  sustained?: { lagMs?: number; forMs?: number };
  /** An isolate joins a pool only while pool load + its load stays under `loadPct`. Default 60. */
  headroom?: { loadPct?: number };
  /**
   * Leaving quarantine: no spike for `steadyMs` (default 30,000 ms) and, for
   * an isolate sent there for misbehaving, a load under `steadyLoadPct`
   * (default 20). Each offence doubles the window (30, 60, 120 s); after
   * `maxReturns` returns (default 3) the next offence keeps the isolate apart
   * for good. An isolate only there to be measured just needs a measurement.
   */
  quarantine?: { steadyMs?: number; steadyLoadPct?: number; maxReturns?: number };
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
};

export type MoveReason = 'spike' | 'sustained' | 'crash' | 'bisect' | 'steady';

export type MoveEvent = { id: string; from: string; to: string; reason: MoveReason };

export type BalancerEvents = { move: MoveEvent };

export interface Balancer<M extends ManifestLike = ManifestLike> {
  /** Like `kernel.spawn`, but the balancer picks `pool`; `manifest.pool` must be absent. */
  spawn(manifest: M): Placement;
  stop(id: string): Promise<void>;
  placements(): Placement[];
  /** Leaves `id` where it is until the returned function is called (a widget open for editing). */
  hold(id: string): () => void;
  on<E extends keyof BalancerEvents>(event: E, fn: (e: BalancerEvents[E]) => void): () => void;
  /** Stops watching; isolates keep running where they are. */
  dispose(): void;
}
