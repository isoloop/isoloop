import type {
  Balancer,
  BalancerEvents,
  BalancerOptions,
  CrashLike,
  IsolateLike,
  KernelLike,
  ManifestLike,
  MoveReason,
  Placement,
  PlacementState,
} from './types';

/** How often the balancer reads the kernel's snapshots: once per default heartbeat. */
const SAMPLE_MS = 100;
/** How often it decides. */
const DECIDE_MS = 500;
/** How often a changed load is written to the `loads` store. */
const SAVE_MS = 10_000;
/** A load is written again only once it moved by this much. */
const SAVE_DELTA_PCT = 5;

const QUARANTINE = 'auto-quarantine';

const now = (): number => performance.now();

/**
 * `busyMs` is approximate: shared framework work is split between members and
 * promise continuations go unattributed. When the members' busy time explains
 * less than this share of the interval, the lag isn't pinned on the busiest
 * member; the balancer bisects instead, as on a kill.
 */
const ATTRIBUTED_PCT = 50;

/** Kernel states in which an isolate still holds a worker. */
const LIVE = new Set(['loading', 'running', 'blocked', 'crashed', 'restarting']);

/** Worker crash reasons whose culprit the kernel can't name: every member of the pool crashes. */
const POOL_KILL = new Set(['unresponsive', 'worker-error']);

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
  /** When a spike or crash was last put on it, or `-Infinity`. */
  lastSpikeAt: number;
  holds: number;
  atCap: boolean;
};

type Pool = {
  /** Lag samples since the pool's membership last changed. */
  lags: Lag[];
  lastBeatAt: number | undefined;
  /** When the membership last changed: a full window must follow before it moves anyone. */
  since: number;
  /** A member moved out: its next full window must show the lag fell, or the next-heaviest goes too. */
  watch: boolean;
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

const isQuarantine = (pool: string): boolean =>
  pool === QUARANTINE || pool.startsWith(`${QUARANTINE}-`);

/**
 * Automatic placement for isolates spawned through it (M3h, ADR 0017).
 *
 * @experimental The policy and its options may change before 1.0.
 *
 * It decides on the main thread, from the kernel's snapshots, and moves an
 * isolate by stopping it and spawning it again with another `pool`; the
 * kernel itself never pools on its own (ADR 0001). Isolates spawned with
 * `kernel.spawn` are never touched; they only count toward `maxWorkers`.
 */
export function createBalancer<M extends ManifestLike>(
  kernel: KernelLike<M>,
  opts: BalancerOptions = {},
): Balancer<M> {
  const maxWorkers = opts.maxWorkers ?? defaultMaxWorkers();
  const spikeLag = opts.spike?.lagMs ?? 100;
  const sustainedLag = opts.sustained?.lagMs ?? 50;
  const windowMs = opts.sustained?.forMs ?? 3000;
  const headroom = opts.headroom?.loadPct ?? 60;
  const steadyMs = opts.quarantine?.steadyMs ?? 30_000;
  const steadyLoad = opts.quarantine?.steadyLoadPct ?? 20;
  const maxReturns = opts.quarantine?.maxReturns ?? 3;
  const loads = opts.loads;

  const members = new Map<string, Member<M>>();
  const pools = new Map<string, Pool>();
  const listeners = new Set<(e: BalancerEvents['move']) => void>();
  /** Pools the kernel killed since the last decision (an unnamed culprit). */
  const killed = new Set<string>();
  /** An unfinished search for the member that kills its pool (Q20). */
  let bisect: { suspects: Set<string>; at: number } | undefined;
  let lastSave = -Infinity;
  let disposed = false;

  // ---- pools and loads ----

  const pool = (name: string): Pool => {
    let p = pools.get(name);
    if (!p) {
      p = { lags: [], lastBeatAt: undefined, since: now(), watch: false };
      pools.set(name, p);
    }
    return p;
  };

  const membersOf = (name: string): Member<M>[] =>
    [...members.values()].filter((m) => m.pool === name && m.state !== 'moving');

  const changed = (name: string): void => {
    const p = pool(name);
    p.lags = [];
    p.lastBeatAt = undefined;
    p.since = now();
  };

  /** Measured load over the last window, or the last one known. */
  const loadOf = (m: Member<M>): number | undefined => {
    const t = now();
    const recent = m.beats.filter((b) => b.at > t - windowMs);
    const dur = recent.reduce((s, b) => s + b.dur, 0);
    if (dur < windowMs * 0.9) return m.knownLoad;
    const busy = recent.reduce((s, b) => s + b.busy, 0);
    return Math.min(100, (busy / dur) * 100);
  };

  const poolLoad = (name: string): number =>
    membersOf(name).reduce((s, m) => s + (loadOf(m) ?? 0), 0);

  const windowFull = (name: string): boolean => {
    const p = pool(name);
    const last = p.lags.at(-1);
    return last !== undefined && last.at - p.since >= windowMs;
  };

  /** Every worker the page runs: the bus, own workers and running pools. */
  const liveWorkers = (): number => {
    const own = kernel.isolates().filter((i) => i.pool === undefined && LIVE.has(i.state)).length;
    const running = kernel.pools().filter((p) => p.running).length;
    return 1 + own + running;
  };

  const autoPools = (): string[] =>
    [...new Set([...members.values()].map((m) => m.pool))].filter((n) => !isQuarantine(n));

  /** A new worker for a pool, leaving one for the quarantine while it isn't running. */
  const roomForPool = (): boolean => {
    const quarantineRuns = kernel.pools().some((p) => p.name === QUARANTINE && p.running);
    return liveWorkers() + 1 + (quarantineRuns ? 0 : 1) <= maxWorkers;
  };

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
    const candidates = autoPools()
      .filter((n) => n !== except && !recentlySpiked(n))
      .map((n) => ({ n, load: poolLoad(n) }))
      .filter((c) => c.load + load < headroom)
      .toSorted((a, b) => a.load - b.load);
    const best = candidates[0];
    if (best) return { pool: best.n, atCap: false };
    if (autoPools().length === 0 || roomForPool())
      return { pool: freshName('auto', 1), atCap: false };
    if (except !== undefined) return undefined;
    const least = autoPools()
      .map((n) => ({ n, load: poolLoad(n) }))
      .toSorted((a, b) => a.load - b.load)[0];
    return least ? { pool: least.n, atCap: true } : { pool: freshName('auto', 1), atCap: true };
  };

  // ---- moves ----

  const emit = (e: BalancerEvents['move']): void => {
    for (const fn of listeners) fn(e);
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
    m.knownLoad = loadOf(m) ?? m.knownLoad;
    m.state = 'moving';
    m.beats = [];
    m.lastBeatAt = undefined;
    // Its new pool is taken at once, so a second move in the same decision
    // doesn't pick the same fresh name.
    m.pool = to;
    changed(from);
    pool(from).watch = true;
    void kernel.stop(id).then(
      () => {
        if (disposed || members.get(id) !== m) return;
        changed(to);
        kernel.spawn({ ...m.manifest, pool: to });
        m.state = state;
        emit({ id, from, to, reason });
      },
      () => {
        // The kernel couldn't stop it (destroyed, most likely): forget it.
        members.delete(id);
      },
    );
  };

  const stateFor = (m: Member<M>): PlacementState =>
    m.offences > maxReturns ? 'kept-apart' : 'quarantined';

  /** Sends `m` to quarantine for misbehaving (`offence`) or to bisect. */
  const quarantine = (m: Member<M>, reason: MoveReason, offence: boolean): void => {
    m.lastSpikeAt = now();
    if (offence) m.offences++;
    const state = stateFor(m);
    m.quarantinedAt = now();
    if (isQuarantine(m.pool)) {
      m.state = state;
      return;
    }
    move(m, QUARANTINE, reason, state);
  };

  const movable = (m: Member<M>): boolean => m.state !== 'moving' && m.holds === 0;

  // ---- sampling ----

  const sample = (): void => {
    const byId = new Map<string, IsolateLike>(kernel.isolates().map((i) => [i.id, i]));
    const fresh = new Map<string, Member<M>[]>();
    for (const m of members.values()) {
      if (m.state === 'moving') continue;
      const s = byId.get(m.manifest.id);
      if (!s || s.state !== 'running' || s.lastBeatAt === m.lastBeatAt) continue;
      if (m.lastBeatAt !== undefined) {
        m.beats.push({ at: s.lastBeatAt, busy: s.busyMs ?? 0, dur: s.lastBeatAt - m.lastBeatAt });
        const cut = s.lastBeatAt - windowMs;
        while ((m.beats[0]?.at ?? Infinity) <= cut) m.beats.shift();
      }
      m.lastBeatAt = s.lastBeatAt;
      const p = pool(m.pool);
      if (p.lastBeatAt !== s.lastBeatAt) {
        p.lastBeatAt = s.lastBeatAt;
        p.lags.push({ at: s.lastBeatAt, lagMs: s.lagMs });
        const cut = s.lastBeatAt - windowMs;
        while ((p.lags[0]?.at ?? Infinity) <= cut) p.lags.shift();
        if (s.lagMs > spikeLag) fresh.set(m.pool, []);
      }
      fresh.get(m.pool)?.push(m);
    }
    // A spike (Q6′): the member that was busiest in that beat goes to quarantine at once.
    for (const [name, beat] of fresh) {
      const dur = Math.max(...beat.map((m) => m.beats.at(-1)?.dur ?? 0));
      const busy = beat.reduce((sum, m) => sum + (m.beats.at(-1)?.busy ?? 0), 0);
      if (dur > 0 && (busy / dur) * 100 < ATTRIBUTED_PCT) {
        search(name, 'spike');
        continue;
      }
      const culprit = beat
        .filter((m) => m.beats.length > 0)
        .toSorted((a, b) => (b.beats.at(-1)?.busy ?? 0) - (a.beats.at(-1)?.busy ?? 0))[0];
      if (!culprit) continue;
      culprit.lastSpikeAt = now();
      if (!movable(culprit)) continue;
      if (isQuarantine(name)) quarantine(culprit, 'spike', false);
      else if (membersOf(name).length > 1 || culprit.offences > 0)
        quarantine(culprit, 'spike', true);
      // Alone in its pool and never quarantined: it hurts nobody else, and
      // nothing joins its pool while it spikes (`recentlySpiked`).
    }
  };

  // ---- deciding ----

  /**
   * Finds the member behind a pool's trouble when the kernel or `busyMs`
   * can't name it (Q20): the heavier half of the suspects moves, and
   * whichever half acts up again holds the culprit.
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
      if (membersOf(name).length > 1 && roomForPool()) {
        culprit.offences++;
        culprit.lastSpikeAt = culprit.quarantinedAt = now();
        move(culprit, freshName(QUARANTINE, 2), reason, stateFor(culprit));
      } else quarantine(culprit, reason, true);
      return;
    }
    const sorted = suspects
      .map((id) => members.get(id))
      .filter((m): m is Member<M> => m !== undefined)
      .toSorted((a, b) => (loadOf(b) ?? 0) - (loadOf(a) ?? 0));
    const half = sorted.slice(0, Math.ceil(sorted.length / 2));
    bisect = { suspects: new Set(suspects), at: now() };
    const to = isQuarantine(name)
      ? roomForPool()
        ? freshName(QUARANTINE, 2)
        : undefined
      : QUARANTINE;
    if (to === undefined) return;
    for (const m of half) {
      if (to === QUARANTINE) {
        m.quarantinedAt = now();
        move(m, to, 'bisect', stateFor(m));
      } else move(m, to, 'bisect', m.state);
    }
  };

  const steadyFor = (m: Member<M>): number => steadyMs * 2 ** Math.max(0, m.offences - 1);

  const decide = (): void => {
    const t = now();
    for (const name of killed) search(name, 'crash');
    killed.clear();
    if (bisect && t - bisect.at > steadyMs * 2) bisect = undefined;

    // Sustained (Q6′, Q18): the heaviest member moves somewhere with room.
    // After a move out, the same check on the pool's next full window is the
    // follow-up: if the lag didn't fall, the next-heaviest goes too.
    for (const name of new Set([...members.values()].map((m) => m.pool))) {
      const here = membersOf(name);
      if (!windowFull(name)) continue;
      const p = pool(name);
      if (median(p.lags.map((l) => l.lagMs)) <= sustainedLag) {
        p.watch = false;
        continue;
      }
      if (here.length < 2) continue;
      if (here.reduce((sum, m) => sum + (loadOf(m) ?? 0), 0) < ATTRIBUTED_PCT) {
        search(name, 'sustained');
        continue;
      }
      const byLoad = here.toSorted((a, b) => (loadOf(b) ?? 0) - (loadOf(a) ?? 0));
      // At first, a heaviest member on hold means wait: moving a lighter one
      // wouldn't relieve the pool. After a move that didn't help, the
      // next-heaviest that can move goes.
      const heaviest = p.watch ? byLoad.find(movable) : byLoad[0];
      if (!heaviest || !movable(heaviest)) continue;
      if (isQuarantine(name)) {
        if (roomForPool()) move(heaviest, freshName(QUARANTINE, 2), 'sustained', heaviest.state);
        continue;
      }
      const to = target(loadOf(heaviest) ?? 0, name);
      if (to) {
        heaviest.atCap = false;
        move(heaviest, to.pool, 'sustained', 'placed');
      } else heaviest.atCap = true;
    }

    // Steady (Q19): back out of quarantine once quiet for long enough. An
    // offender must also be light; an isolate only there to be measured
    // (never measured, or moved there by a bisect) just needs a measurement,
    // and the headroom rule places it.
    for (const m of members.values()) {
      if (m.state !== 'quarantined' || !movable(m)) continue;
      if (t - Math.max(m.quarantinedAt, m.lastSpikeAt) < steadyFor(m)) continue;
      const load = loadOf(m);
      if (load === undefined || (m.offences > 0 && load >= steadyLoad)) continue;
      const to = target(load, m.pool);
      if (!to || to.atCap) continue;
      move(m, to.pool, 'steady', 'placed');
    }

    if (t - lastSave >= SAVE_MS) {
      lastSave = t;
      for (const m of members.values()) save(m);
    }
  };

  const onCrash = (e: CrashLike): void => {
    const m = members.get(e.id);
    if (!m || m.state === 'moving') return;
    if (POOL_KILL.has(e.reason) && e.pool !== undefined) killed.add(e.pool);
    else if (e.reason === 'error') {
      // Its own fatal error: the culprit is known (Q6′).
      if (m.holds > 0) m.lastSpikeAt = now();
      else quarantine(m, 'crash', true);
    }
  };

  const timers = [setInterval(sample, SAMPLE_MS), setInterval(decide, DECIDE_MS)];
  const off = kernel.on('isolate:crash', onCrash);

  const placement = (m: Member<M>): Placement => {
    const p: Placement = {
      id: m.manifest.id,
      pool: m.pool,
      state: m.state,
      loadPct: loadOf(m),
    };
    if (m.atCap) p.atCap = true;
    return p;
  };

  return {
    spawn(manifest) {
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
        state: isQuarantine(dest.pool) ? 'quarantined' : 'placed',
        beats: [],
        lastBeatAt: undefined,
        knownLoad: known,
        savedLoad: known,
        offences: 0,
        quarantinedAt: isQuarantine(dest.pool) ? now() : -Infinity,
        lastSpikeAt: -Infinity,
        holds: 0,
        atCap: dest.atCap,
      };
      members.set(manifest.id, m);
      changed(dest.pool);
      kernel.spawn({ ...manifest, pool: dest.pool });
      return placement(m);
    },
    async stop(id) {
      const m = members.get(id);
      if (!m) return kernel.stop(id);
      save(m);
      members.delete(id);
      changed(m.pool);
      await kernel.stop(id);
    },
    placements() {
      return [...members.values()].map(placement);
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
    on(event, fn) {
      if (event !== 'move') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      disposed = true;
      for (const t of timers) clearInterval(t);
      off();
      listeners.clear();
    },
  };
}
