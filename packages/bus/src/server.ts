/*
 * The bus worker's shell (design §6, plan m2-bus task 7). It owns the control
 * port: `boot` imports the contracts module and builds the broker, `attach` /
 * `detach` wire isolate ports to it, and it sends `beat`, `metrics` and
 * `error`. While the contracts load it accepts `attach` and `subscribe` and
 * buffers publishes, validating them in order once the broker exists
 * (ADR 0003, decision 8).
 *
 * `serve()` takes the worker scope as a parameter, so `worker.ts` is one line.
 */
import {
  isHostToBus,
  isSystemTopic,
  type BusMetrics,
  type BusToHost,
  type BusToIsolate,
  type CallResult,
  type ErrorCode,
  type HostToBus,
  type TopicConfig,
} from '@isoloop/protocol';
import { Broker, type BrokerStats, type BusPort } from './broker';
import { MemoryStorage } from './engine/memory-storage';
import { TsEngine } from './engine/ts-engine';
import type { LogStorage, StoredState } from './engine/types';
import { OpfsStorage } from './storage/opfs';
import { isContracts, topicConfig, type Contracts } from './topic';

/** The part of a worker scope the bus uses. */
export type BusScope = {
  postMessage(msg: BusToHost): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<unknown>) => void): void;
};

export type ServeOptions = {
  /** Publishes buffered per port while contracts load. Default 1,000, the inbox limit. */
  inboxLimit?: number;
  /** Default `import()`. */
  importModule?: (url: string) => Promise<unknown>;
  /** Default `performance.now`. */
  now?: () => number;
  /**
   * Storage for persistent topics. Default `OpfsStorage` where sync access
   * handles exist (a dedicated worker), else `MemoryStorage`.
   */
  storage?: () => LogStorage;
};

/** How often metrics are sampled and retention runs (design §6.2, §6.3). */
const METRICS_MS = 1000;

type Failure = { code: ErrorCode; message: string };

/** A contracts load failure: deterministic, so the host doesn't retry it (ADR 0003, decision 7). */
class BootError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const CONTRACT_CODES: ReadonlySet<string> = new Set(['contracts_invalid', 'reserved_topic']);

/** A `ContractsError` thrown while the module evaluated, from any copy of this package. */
function contractsCode(e: unknown): ErrorCode | undefined {
  if (typeof e !== 'object' || e === null || !('code' in e)) return undefined;
  const code: unknown = e.code;
  return typeof code === 'string' && CONTRACT_CODES.has(code)
    ? (code as ErrorCode) // oxlint-disable-line typescript/no-unsafe-type-assertion -- checked against the set
    : undefined;
}

/** Topic configs as a canonical string, so key order doesn't matter. */
function canonical(cfg: TopicConfig): string {
  return JSON.stringify(cfg, (_key, v: unknown) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
    const keys = Object.keys(v);
    keys.sort();
    return Object.fromEntries(keys.map((k) => [k, Reflect.get(v, k)]));
  });
}

/** Names of topics that differ between the module and the host's list, or exist in only one. */
export function mismatchedTopics(module: Contracts, host: readonly TopicConfig[]): string[] {
  const ours = new Map(module.topics.map((t) => [t.name, canonical(topicConfig(t))]));
  const theirs = new Map(host.map((t) => [t.name, canonical(t)]));
  const names = new Set([...ours.keys(), ...theirs.keys()]);
  const differ = [...names].filter((n) => ours.get(n) !== theirs.get(n));
  differ.sort();
  return differ;
}

/** Imports the contracts module and checks it against the host's list (ADR 0003, decisions 4–7). */
export async function loadContracts(
  url: string,
  host: readonly TopicConfig[],
  importModule: (url: string) => Promise<unknown>,
): Promise<Contracts> {
  let mod: unknown;
  try {
    mod = await importModule(url);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const code = contractsCode(e);
    if (code) throw new BootError(code, message);
    throw new BootError('contracts_failed', `Could not import contracts from ${url}: ${message}`);
  }
  const list: unknown =
    typeof mod === 'object' && mod !== null && 'default' in mod ? mod.default : undefined;
  if (!isContracts(list)) {
    throw new BootError(
      'contracts_invalid',
      `${url} has no contracts() default export (ADR 0003, decision 4)`,
    );
  }
  const reserved = list.topics.filter((t) => isSystemTopic(t.name)).map((t) => t.name);
  if (reserved.length > 0) {
    throw new BootError(
      'reserved_topic',
      `isoloop.* topics belong to the kernel: ${reserved.join(', ')}`,
    );
  }
  const differ = mismatchedTopics(list, host);
  if (differ.length > 0) {
    throw new BootError(
      'contracts_mismatch',
      `The contracts at ${url} differ from the host's for: ${differ.join(', ')}`,
    );
  }
  return list;
}

/** A `MessagePort` as a broker `BusPort`, holding messages until the broker listens. */
type HeldPort = BusPort & { held: unknown[] };

function holdPort(
  port: MessagePort,
  limit: number,
  reject: (port: MessagePort, re: string) => void,
): HeldPort {
  let handler: ((msg: unknown) => void) | undefined;
  let buffered = 0;
  const held: HeldPort = {
    held: [],
    post(msg: BusToIsolate) {
      port.postMessage(msg);
    },
    onMessage(h) {
      handler = h;
      for (const msg of held.held.splice(0)) h(msg);
    },
    close() {
      port.close();
    },
  };
  port.addEventListener('message', (e: MessageEvent<unknown>) => {
    if (handler) {
      handler(e.data);
      return;
    }
    const msg = e.data;
    if (isPublishLike(msg)) {
      if (buffered >= limit) {
        if (typeof msg.id === 'string') reject(port, msg.id);
        return;
      }
      buffered++;
    }
    held.held.push(msg);
  });
  port.start();
  return held;
}

const isPublishLike = (m: unknown): m is { t: string; id?: unknown } =>
  typeof m === 'object' && m !== null && 't' in m && (m.t === 'publish' || m.t === 'request');

const unavailable = (what: string): CallResult => ({
  ok: false,
  error: {
    code: 'bus_unavailable',
    message: `${what}: the bus buffer is full while contracts load`,
  },
});

/** Wires the control port of a bus worker. Call once, with the worker's scope. */
export function serve(scope: BusScope, opts: ServeOptions = {}): void {
  const limit = opts.inboxLimit ?? 1000;
  const importModule = opts.importModule ?? ((url: string) => import(/* @vite-ignore */ url));
  const now = opts.now ?? (() => performance.now());
  const post = (msg: BusToHost): void => {
    scope.postMessage(msg);
  };

  let booted = false;
  let failed = false;
  let broker: Broker | undefined;
  /** Control messages that arrived before the broker, replayed in order. */
  const early: HostToBus[] = [];
  /** Ports attached before the broker: they buffer what their isolate sends. */
  const ports = new Map<string, HeldPort>();
  let earlyPublishes = 0;

  const fatal = (f: Failure): void => {
    failed = true;
    post({ v: 1, t: 'error', p: { message: f.message, fatal: true, code: f.code } });
    for (const p of ports.values()) p.close();
    ports.clear();
    early.length = 0;
  };

  const control = (msg: HostToBus, b: Broker): void => {
    switch (msg.t) {
      case 'boot':
        return;
      case 'attach': {
        const port = ports.get(msg.p.isolateId) ?? held(msg.p.port);
        ports.delete(msg.p.isolateId);
        b.attach(msg.p.isolateId, msg.p.grants, port, { reattach: msg.p.reattach ?? false });
        return;
      }
      case 'detach':
        b.detach(msg.p.isolateId, msg.p.keepOffsets, { wake: msg.p.wake ?? false });
        return;
      case 'publish': {
        const { id } = msg;
        // Only the main thread holds the control port. `kernel.publish` refuses
        // isoloop.* there, so a system-topic publish here is the kernel's own.
        const from = isSystemTopic(msg.p.topic)
          ? ({ kind: 'kernel' } as const)
          : ({ kind: 'host' } as const);
        void b.publish(from, msg.p.topic, msg.p.key, msg.p.value).then((r) => {
          if (id !== undefined) post({ v: 1, t: 'result', re: id, p: r });
        });
        return;
      }
      default: {
        const never: never = msg;
        return never;
      }
    }
  };

  const held = (port: MessagePort): HeldPort =>
    holdPort(port, limit, (p, re) => {
      p.postMessage({ v: 1, t: 'result', re, p: unavailable('publish') } satisfies BusToIsolate);
    });

  /** Before the broker: keep what can wait, hold ports, reject publishes past the limit. */
  const wait = (msg: HostToBus): void => {
    switch (msg.t) {
      case 'attach':
        ports.get(msg.p.isolateId)?.close();
        ports.set(msg.p.isolateId, held(msg.p.port));
        break;
      case 'detach':
        ports.get(msg.p.isolateId)?.close();
        ports.delete(msg.p.isolateId);
        break;
      case 'publish':
        if (earlyPublishes >= limit) {
          if (msg.id !== undefined)
            post({ v: 1, t: 'result', re: msg.id, p: unavailable('kernel.publish') });
          return;
        }
        earlyPublishes++;
        break;
      case 'boot':
        return;
    }
    early.push(msg);
  };

  const startBeat = (everyMs: number): void => {
    let last = now();
    setInterval(() => {
      const t = now();
      post({ v: 1, t: 'beat', p: { lagMs: Math.max(0, t - last - everyMs) } });
      last = t;
    }, everyMs);
  };

  const startMetrics = (b: Broker): void => {
    let prev: BrokerStats = b.stats();
    let at = now();
    setInterval(() => {
      b.compact();
      const stats = b.stats();
      const t = now();
      const secs = Math.max(0.001, (t - at) / 1000);
      const before = new Map(prev.topics.map((x) => [x.topic, x]));
      const metrics: BusMetrics = {
        topics: stats.topics.map((x) => ({
          topic: x.topic,
          recordsPerSec: (x.records - (before.get(x.topic)?.records ?? 0)) / secs,
          bytesPerSec: (x.bytes - (before.get(x.topic)?.bytes ?? 0)) / secs,
        })),
        subscriptions: stats.subscriptions,
        rejected: stats.rejected,
      };
      prev = stats;
      at = t;
      post({ v: 1, t: 'metrics', p: metrics });
    }, METRICS_MS);
  };

  /** An engine and broker on `storage`, with persistent topics restored from `stored`. */
  const build = async (
    list: Contracts,
    storage: LogStorage,
    stored: StoredState,
    dev: boolean,
  ): Promise<{ b: Broker; restored: { topic: string; head: number }[] }> => {
    const engine = new TsEngine({ storage });
    const b = new Broker({
      contracts: list,
      engine,
      dev,
      onWake: (isolateId, topic) => post({ v: 1, t: 'wake', p: { isolateId, topic } }),
    });
    return { b, restored: await engine.restore(stored) };
  };

  const boot = async (p: Extract<HostToBus, { t: 'boot' }>['p']): Promise<void> => {
    startBeat(p.heartbeatMs ?? 100);
    let list: Contracts;
    try {
      list = await loadContracts(p.contractsUrl, p.topics, importModule);
    } catch (e) {
      fatal(
        e instanceof BootError
          ? { code: e.code, message: e.message }
          : { code: 'contracts_invalid', message: e instanceof Error ? e.message : String(e) },
      );
      return;
    }
    const dev = p.dev ?? false;
    let storage =
      opts.storage?.() ?? (OpfsStorage.available() ? new OpfsStorage() : new MemoryStorage());
    let quarantined: string[] | undefined;
    let stored: StoredState;
    try {
      if (p.safeMode) quarantined = await storage.quarantineNewest();
      stored = await storage.open();
    } catch (e) {
      // The files couldn't be opened: run in memory rather than not at all.
      console.warn('[isoloop] persistent topics are in memory: storage failed to open', e);
      storage = new MemoryStorage();
      stored = await storage.open();
    }
    let built: Awaited<ReturnType<typeof build>>;
    try {
      // Persistent topics come back from disk before anything is let in.
      built = await build(list, storage, stored, dev);
    } catch (e) {
      // A stored record broke the restore: a crash while loading. The host
      // restarts the bus, and after a second one boots it in safe mode.
      post({
        v: 1,
        t: 'error',
        p: {
          message: `Restoring persistent topics failed: ${e instanceof Error ? e.message : String(e)}`,
          fatal: true,
        },
      });
      return;
    }
    const { b, restored } = built;
    broker = b;
    post({
      v: 1,
      t: 'ready',
      p: { engine: 'ts', storage: storage.kind, restored, ...(quarantined ? { quarantined } : {}) },
    });
    for (const msg of early.splice(0)) control(msg, b);
    startMetrics(b);
  };

  scope.addEventListener('message', (e) => {
    const msg = e.data;
    if (!isHostToBus(msg) || failed) return;
    if (msg.t === 'boot') {
      if (booted) return;
      booted = true;
      void boot(msg.p);
      return;
    }
    if (broker) control(msg, broker);
    else wait(msg);
  });
}
