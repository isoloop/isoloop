/*
 * Turns a manifest into a running worker (design §4.2): a module worker from
 * the bootstrap URL, then `init` with the bus port transferred. The bus
 * controller made that port and attached its other end to the bus worker.
 *
 * A manifest with `pool` (M2c, ADR 0001) joins a shared worker instead: the
 * pool's worker starts with its first member and is terminated after its
 * last, and every message to a member names it in `isolate`.
 */
import { PROTOCOL, type Grants, type HostToIsolate } from '@isoloop/protocol';

/** Where one isolate runs: its own worker, or a member's place in a pool. */
export type LoadedWorker = {
  /** The worker it runs in; shared with the other members in a pool. */
  worker: Worker;
  /** The pool's name, or undefined for an own worker. */
  pool: string | undefined;
  /** Sends to this isolate (naming it in `isolate` in a pool). */
  post(msg: HostToIsolate, transfer?: Transferable[]): void;
  /**
   * True for a message from this isolate: everything from an own worker; in
   * a pool, what names this member, plus what is about the whole worker
   * (`beat`, which names no one).
   */
  mine(msg: unknown): boolean;
  /**
   * Ends this isolate: terminates an own worker; leaves a pool, terminating
   * the pool's worker after its last member.
   */
  terminate(): void;
};

export type LoadOptions = {
  bootstrapUrl: string;
  id: string;
  src: string;
  config: unknown;
  grants: Grants;
  renderFmt: string;
  heartbeatMs: number;
  /** The isolate's end of its bus connection; transferred in `init`. */
  busPort: MessagePort;
  /** Waking from suspension: `latest` subscriptions resume from `committed` (ADR 0001). */
  wake?: boolean;
  /** Named pool to join (ADR 0001, ADR 0015). */
  pool?: string;
};

const initOf = (o: LoadOptions): HostToIsolate => ({
  v: 1,
  t: 'init',
  ...(o.pool === undefined ? {} : { isolate: o.id }),
  p: {
    isolateId: o.id,
    protocol: { min: PROTOCOL.min, max: PROTOCOL.v },
    renderFmt: o.renderFmt,
    config: o.config,
    grants: o.grants,
    busPort: o.busPort,
    heartbeatMs: o.heartbeatMs,
    src: new URL(o.src, document.baseURI).href,
    ...(o.wake ? { wake: true } : {}),
  },
});

/** A pool's shared worker and the isolates in it. */
type Pool = { worker: Worker; members: Set<string> };

export type Loader = {
  load(o: LoadOptions): LoadedWorker;
  /** Workers running now: an own worker or a pool each count once (ADR 0001 budget). */
  workers(): number;
  /** Each running pool's members, by pool name. */
  pools(): Record<string, readonly string[]>;
};

export function createLoader(): Loader {
  const pools = new Map<string, Pool>();
  let own = 0;

  const loadOwn = (o: LoadOptions): LoadedWorker => {
    const worker = new Worker(o.bootstrapUrl, { type: 'module', name: o.id });
    own++;
    worker.postMessage(initOf(o), [o.busPort]);
    let ended = false;
    return {
      worker,
      pool: undefined,
      post: (msg, transfer = []) => {
        worker.postMessage(msg, transfer);
      },
      mine: () => true,
      terminate: () => {
        if (ended) return;
        ended = true;
        own--;
        worker.terminate();
      },
    };
  };

  const loadMember = (o: LoadOptions, name: string): LoadedWorker => {
    let pool = pools.get(name);
    if (!pool) {
      pool = {
        worker: new Worker(o.bootstrapUrl, { type: 'module', name: `pool:${name}` }),
        members: new Set(),
      };
      pools.set(name, pool);
    }
    const p = pool;
    p.members.add(o.id);
    p.worker.postMessage(initOf(o), [o.busPort]);
    let ended = false;
    return {
      worker: p.worker,
      pool: name,
      post: (msg, transfer = []) => {
        p.worker.postMessage({ ...msg, isolate: o.id }, transfer);
      },
      mine: (msg) => {
        const isolate: unknown =
          typeof msg === 'object' && msg !== null ? Reflect.get(msg, 'isolate') : undefined;
        return isolate === undefined || isolate === o.id;
      },
      terminate: () => {
        if (ended) return;
        ended = true;
        p.members.delete(o.id);
        if (p.members.size > 0) {
          // The others keep the worker: drop this member inside it too, now.
          // (After its `bye` it is gone already, and this is ignored.)
          p.worker.postMessage({
            v: 1,
            t: 'shutdown',
            isolate: o.id,
            p: { reason: 'stop', graceMs: 0 },
          } satisfies HostToIsolate);
          return;
        }
        p.worker.terminate();
        if (pools.get(name) === p) pools.delete(name);
      },
    };
  };

  return {
    load: (o) => (o.pool === undefined ? loadOwn(o) : loadMember(o, o.pool)),
    workers: () => own + pools.size,
    pools: () => Object.fromEntries([...pools].map(([name, p]) => [name, [...p.members]])),
  };
}
