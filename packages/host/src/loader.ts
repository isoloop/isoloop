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
  /**
   * The URL its worker was started from. For the tiny `@isoloop/runtime/worker`
   * entry, as `@isoloop/vite` marks it (`ENTRY_MARK`), each worker gets a
   * fragment of its own, so a memory measurement can tell workers apart
   * (ADR 0020, decision 4). Other bootstrap URLs are used as given.
   */
  url: string;
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
  /** `KernelConfig.bus.commitIntervalMs` (ADR 0016, decision 1). */
  commitIntervalMs?: number;
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
    ...(o.commitIntervalMs === undefined ? {} : { commitIntervalMs: o.commitIntervalMs }),
    src: new URL(o.src, document.baseURI).href,
    ...(o.wake ? { wake: true } : {}),
  },
});

/** A pool's shared worker and the isolates in it. */
type Pool = { worker: Worker; url: string; members: Set<string> };

let serial = 0;

/**
 * The fragment `@isoloop/vite` puts on `@isoloop/runtime/worker`'s URL in
 * `virtual:isoloop/workers`: the tiny entry no chunk imports, so the kernel
 * may start each worker from it with a fragment of its own (ADR 0020,
 * decision 4). Internal: an app passing its own URLs gets no memory figures
 * per isolate unless it adds the mark to that entry's URL.
 */
export const ENTRY_MARK = '#isoloop-entry';

/**
 * The bootstrap URL with a fragment naming one worker. Every isolate starts
 * from the same bootstrap, and `measureUserAgentSpecificMemory()` attributes
 * memory by worker URL, fragment included, so each worker needs its own.
 *
 * Only for the tiny `@isoloop/runtime/worker` entry: a module URL with a
 * fragment is a module of its own, so a worker started that way from
 * `@isoloop/runtime/bootstrap` evaluates the bootstrap twice once a shared
 * chunk imports it back by its plain URL.
 */
export function workerUrl(bootstrapUrl: string): string {
  const base = bootstrapUrl.endsWith(ENTRY_MARK)
    ? bootstrapUrl.slice(0, -ENTRY_MARK.length)
    : bootstrapUrl;
  return `${base}#isoloop-worker=${++serial}`;
}

export type Loader = {
  load(o: LoadOptions): LoadedWorker;
  /** Workers running now: an own worker or a pool each count once (ADR 0001 budget). */
  workers(): number;
  /** Each running pool's members, by pool name. */
  pools(): Record<string, readonly string[]>;
  /**
   * A worker started from a marked URL reported no tiny entry in its `ready`:
   * the mark was wrong, so later workers start from the URL as given.
   */
  entryDenied(bootstrapUrl: string): void;
};

export function createLoader(): Loader {
  const pools = new Map<string, Pool>();
  let own = 0;
  /** Marked URLs whose worker turned out not to run the tiny entry. */
  const denied = new Set<string>();
  const urlOf = (bootstrapUrl: string): string => {
    if (!bootstrapUrl.endsWith(ENTRY_MARK)) return bootstrapUrl;
    // A wrongly marked URL starts without any fragment, so its bootstrap loads once.
    if (denied.has(bootstrapUrl)) return bootstrapUrl.slice(0, -ENTRY_MARK.length);
    return workerUrl(bootstrapUrl);
  };

  const loadOwn = (o: LoadOptions): LoadedWorker => {
    const url = urlOf(o.bootstrapUrl);
    const worker = new Worker(url, { type: 'module', name: o.id });
    own++;
    worker.postMessage(initOf(o), [o.busPort]);
    let ended = false;
    return {
      worker,
      pool: undefined,
      url,
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
      const url = urlOf(o.bootstrapUrl);
      pool = {
        worker: new Worker(url, { type: 'module', name: `pool:${name}` }),
        url,
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
      url: p.url,
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
    entryDenied: (bootstrapUrl) => {
      denied.add(bootstrapUrl);
    },
  };
}
