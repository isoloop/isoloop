import { claimPools } from './claim';
import type {
  Balancer,
  BalancerEvents,
  BalancerOptions,
  BeatLike,
  CrashLike,
  KernelLike,
  ManifestLike,
  MoveReason,
  Placement,
  PlacementState,
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

/**
 * `busyMs` is approximate: shared framework work is split between members and
 * promise continuations go unattributed. When the members' busy time explains
 * less than this share of the interval, the lag isn't pinned on the busiest
 * member; the balancer bisects instead, as on a kill.
 */
const ATTRIBUTED_PCT = 50;

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
 * Automatic placement for isolates spawned through it (M3h, ADR 0017).
 *
 * @experimental The policy and its options may change before 1.0.
 *
 * It decides on the main thread, from every heartbeat (`isolate:beat`), and moves an
 * isolate by stopping it and spawning it again with another `pool`; the
 * kernel itself never pools on its own (ADR 0001). Isolates spawned with
 * `kernel.spawn` are never touched, and don't count toward `maxWorkers`.
 */
export function createBalancer<M extends ManifestLike>(
  kernel: KernelLike<M>,
  opts: BalancerOptions = {},
): Balancer<M> {
  // One balancer per kernel; throws `balancer_exists` for a second.
  const claim = claimPools(kernel, 'balancer');
  const maxWorkers = Math.max(1, opts.maxWorkers ?? defaultMaxWorkers());
  const spikeLag = opts.spike?.lagMs ?? 100;
  const sustainedLag = opts.sustained?.lagMs ?? 50;
  const windowMs = opts.sustained?.forMs ?? 3000;
  const headroom = opts.headroom?.loadPct ?? 60;
  const steadyMs = opts.quarantine?.steadyMs ?? 30_000;
  const steadyLoad = opts.quarantine?.steadyLoadPct ?? 20;
  const maxReturns = opts.quarantine?.maxReturns ?? 3;
  const loads = opts.loads;

  const members = new Map<string, Member<M>>();
  const pools = new Map<string, Pool<M>>();
  const listeners: { [E in keyof BalancerEvents]: Set<(e: BalancerEvents[E]) => void> } = {
    move: new Set(),
    foreign: new Set(),
  };
  /** Beats of isolates the balancer didn't place, for `measure` (previews included). */
  const seen = new Map<string, { lastBeatAt: number; beats: Beat[] }>();
  /** Isolates in our pools we didn't place, by id: their pool. */
  const foreign = new Map<string, string>();
  /** Pools the kernel killed since the last decision (an unnamed culprit). */
  const killed = new Set<string>();
  /** An unfinished search for the member that kills its pool (Q20). */
  let bisect: { suspects: Set<string>; at: number } | undefined;
  /** Pools whose latest beat spiked, judged once all its members' events are in. */
  const spiked = new Set<string>();
  let judging: ReturnType<typeof setTimeout> | undefined;
  let lastSave = -Infinity;
  let disposed = false;

  // ---- pools and loads ----

  const pool = (name: string): Pool<M> => {
    let p = pools.get(name);
    if (!p) {
      p = { lags: [], beatAt: undefined, beat: [], since: now(), watch: false };
      pools.set(name, p);
    }
    return p;
  };

  const membersOf = (name: string): Member<M>[] =>
    [...members.values()].filter((m) => m.pool === name && m.state !== 'moving');

  const changed = (name: string): void => {
    const p = pool(name);
    p.lags = [];
    p.beatAt = undefined;
    p.beat = [];
    p.since = now();
  };

  /** Measured load over the last window, or the last one known. */
  const loadOf = (m: Member<M>): number | undefined =>
    average(m.beats, windowMs, now()) ?? m.knownLoad;

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
   * app runs itself don't count (ADR 0017, amended).
   */
  const ownWorkers = (): number =>
    kernel.pools().filter((p) => p.running && isOurs(p.name) && p.name !== QUARANTINE).length;

  const ownPools = (): string[] =>
    [...new Set([...members.values()].map((m) => m.pool))].filter((n) => !isQuarantine(n));

  /** Room for one more worker of the balancer's own. */
  const roomForPool = (): boolean => ownWorkers() + 1 <= maxWorkers;

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

  const emit = (e: BalancerEvents['move']): void => {
    for (const fn of listeners.move) fn(e);
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
        claim.spawn({ ...m.manifest, pool: to });
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

  /** A spike (Q6′): the member that was busiest in that beat goes to quarantine at once. */
  const judge = (): void => {
    judging = undefined;
    if (disposed) return;
    for (const name of spiked) {
      const beat = pool(name).beat.filter(
        (m) => members.get(m.manifest.id) === m && m.pool === name && m.state !== 'moving',
      );
      const dur = Math.max(0, ...beat.map((m) => m.beats.at(-1)?.dur ?? 0));
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
        move(culprit, freshName(QUARANTINES, 2), reason, stateFor(culprit));
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
        ? freshName(QUARANTINES, 2)
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
    checkForeign();
    // Beats of isolates that stopped (a closed preview) are forgotten.
    for (const [id, w] of seen) if (t - w.lastBeatAt > windowMs * 2) seen.delete(id);
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
        if (roomForPool()) move(heaviest, freshName(QUARANTINES, 2), 'sustained', heaviest.state);
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

  const timer = setInterval(decide, DECIDE_MS);
  const offs = [kernel.on('isolate:crash', onCrash), kernel.on('isolate:beat', onBeat)];

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
      claim.spawn({ ...manifest, pool: dest.pool });
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
      disposed = true;
      clearInterval(timer);
      if (judging !== undefined) clearTimeout(judging);
      for (const off of offs) off();
      listeners.move.clear();
      listeners.foreign.clear();
    },
  };
}
