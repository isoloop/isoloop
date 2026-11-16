// A simulated kernel for the balancer's tests: workers beat every 100 ms,
// reported as one `isolate:beat` per member, each member's busy time comes
// from a script, and a worker's lag grows with the sum of its members' busy
// time. A member that blocks stops its worker's
// beats; after `killAfterMs` every member crashes `unresponsive` and restarts
// in the same pool, as the real kernel does (pool fate, M2c).
import type { BeatLike, CrashLike, KernelLike, ManifestLike, PoolLike } from './types';

const BEAT_MS = 100;

type Iso = {
  id: string;
  state: string;
  pool?: string;
  lagMs: number;
  busyMs: number;
  restartAt?: number;
};

export type SimOptions = { killAfterMs?: number };

export class SimKernel implements KernelLike {
  readonly spawned: ManifestLike[] = [];
  /** The most workers that ran at once, the bus included. */
  peakWorkers = 1;
  /** The most `balancer-N` pools that ran at once (quarantines excluded). */
  peakBalancerPools = 0;
  #isos = new Map<string, Iso>();
  /** Steady busy share of a beat, 0–100, per isolate id. */
  #load = new Map<string, number>();
  /** Busy share the worker spends for `id` that its `busyMs` doesn't show. */
  #hidden = new Map<string, number>();
  /** One-off busy milliseconds added to the next beat. */
  #burst = new Map<string, number>();
  #blocking = new Set<string>();
  #blockedSince = new Map<string, number>();
  #crash = new Set<(e: CrashLike) => void>();
  #beats = new Set<(e: BeatLike) => void>();
  #timer: ReturnType<typeof setInterval>;
  #killAfterMs: number;
  #claimed = false;

  constructor(opts: SimOptions = {}) {
    this.#killAfterMs = opts.killAfterMs ?? 600;
    this.#timer = setInterval(() => this.#beat(), BEAT_MS);
  }

  /** Sets `id`'s steady load, as a share of one core. */
  load(id: string, pct: number): void {
    this.#load.set(id, pct);
  }

  /** `id` costs its worker `pct` of each beat that `busyMs` doesn't attribute. */
  hidden(id: string, pct: number): void {
    this.#hidden.set(id, pct);
  }

  /** `id` runs one long task of `ms` before its worker's next beat. */
  burst(id: string, ms: number): void {
    this.#burst.set(id, ms);
  }

  /** `id` blocks its worker until `unblock`. */
  block(id: string): void {
    this.#blocking.add(id);
  }

  unblock(id: string): void {
    this.#blocking.delete(id);
  }

  /** Emits `isolate:crash` as the kernel would. */
  crash(e: CrashLike): void {
    for (const fn of this.#crash) fn(e);
  }

  poolOf(id: string): string | undefined {
    return this.#isos.get(id)?.pool;
  }

  workers(): number {
    const own = [...this.#isos.values()].filter((i) => i.pool === undefined).length;
    return 1 + own + this.pools().length;
  }

  dispose(): void {
    clearInterval(this.#timer);
  }

  /** As the host will: `balancer-*` pools only through the claim, one claim per kernel. */
  claimPools(_owner: 'balancer'): { spawn(manifest: ManifestLike): void } {
    if (this.#claimed)
      throw Object.assign(new Error('this kernel already has a balancer'), {
        code: 'balancer_exists',
      });
    this.#claimed = true;
    return { spawn: (m) => this.#spawn(m) };
  }

  spawn(manifest: ManifestLike): void {
    if (manifest.pool?.startsWith('balancer-'))
      throw Object.assign(new Error(`"${manifest.pool}" is reserved`), { code: 'reserved_pool' });
    this.#spawn(manifest);
  }

  /** Skips the reservation, to test the balancer's defensive check. */
  spawnAnywhere(manifest: ManifestLike): void {
    this.#spawn(manifest);
  }

  #spawn(manifest: ManifestLike): void {
    if (this.#isos.has(manifest.id)) throw new Error(`"${manifest.id}" exists`);
    this.spawned.push(manifest);
    const iso: Iso = { id: manifest.id, state: 'running', lagMs: 0, busyMs: 0 };
    if (manifest.pool !== undefined) iso.pool = manifest.pool;
    this.#isos.set(manifest.id, iso);
    this.peakWorkers = Math.max(this.peakWorkers, this.workers());
    const ours = this.pools().filter((p) => /^balancer-\d+$/.test(p.name)).length;
    this.peakBalancerPools = Math.max(this.peakBalancerPools, ours);
  }

  async stop(id: string): Promise<void> {
    await Promise.resolve();
    this.#isos.delete(id);
  }

  pools(): PoolLike[] {
    const by = new Map<string, string[]>();
    for (const i of this.#isos.values()) {
      if (i.pool === undefined) continue;
      by.set(i.pool, [...(by.get(i.pool) ?? []), i.id]);
    }
    return [...by].map(([name, members]) => ({ name, members, running: true }));
  }

  on(event: 'isolate:crash', fn: (e: CrashLike) => void): () => void;
  on(event: 'isolate:beat', fn: (e: BeatLike) => void): () => void;
  on(
    event: 'isolate:crash' | 'isolate:beat',
    fn: ((e: CrashLike) => void) | ((e: BeatLike) => void),
  ): () => void {
    const set: Set<(e: never) => void> = event === 'isolate:crash' ? this.#crash : this.#beats;
    set.add(fn);
    return () => void set.delete(fn);
  }

  #beat(): void {
    const now = performance.now();
    const workers = new Map<string, Iso[]>();
    for (const i of this.#isos.values()) {
      const w = i.pool ?? `own:${i.id}`;
      workers.set(w, [...(workers.get(w) ?? []), i]);
    }
    for (const [w, isos] of workers) {
      if (isos.some((i) => i.restartAt !== undefined)) {
        for (const i of isos) {
          if (i.restartAt !== undefined && now >= i.restartAt) {
            delete i.restartAt;
            i.state = 'running';
          }
        }
        continue;
      }
      if (isos.some((i) => this.#blocking.has(i.id))) {
        const since = this.#blockedSince.get(w) ?? now;
        this.#blockedSince.set(w, since);
        if (now - since < this.#killAfterMs) continue;
        this.#blockedSince.delete(w);
        for (const i of isos) {
          i.state = 'restarting';
          i.restartAt = now + 200;
          const e: CrashLike = { id: i.id, reason: 'unresponsive' };
          if (i.pool !== undefined) e.pool = i.pool;
          for (const fn of this.#crash) fn(e);
        }
        continue;
      }
      this.#blockedSince.delete(w);
      let total = 0;
      for (const i of isos) {
        i.busyMs = ((this.#load.get(i.id) ?? 1) * BEAT_MS) / 100 + (this.#burst.get(i.id) ?? 0);
        this.#burst.delete(i.id);
        total += i.busyMs + ((this.#hidden.get(i.id) ?? 0) * BEAT_MS) / 100;
      }
      const lagMs = Math.max(0, total - 60) * 3;
      for (const i of isos) {
        i.lagMs = lagMs;
        const e: BeatLike = { id: i.id, lagMs, busyMs: i.busyMs, at: now };
        if (i.pool !== undefined) e.pool = i.pool;
        for (const fn of this.#beats) fn(e);
      }
    }
  }
}

/** A `LoadStore` over a plain map, for tests. */
export const memoryLoads = (
  init: Record<string, number> = {},
): {
  get(id: string): number | undefined;
  set(id: string, pct: number): void;
  all: Map<string, number>;
} => {
  const all = new Map(Object.entries(init));
  return { get: (id) => all.get(id), set: (id, pct) => void all.set(id, pct), all };
};
