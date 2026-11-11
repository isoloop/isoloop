/*
 * The bus controller (design §1, ADR 0005, ADR 0007). Starts the bus worker
 * before any isolate, gives each isolate a MessageChannel end wired to the
 * bus (`attach`), carries `kernel.publish` / `kernel.subscribe`, and
 * supervises the bus with the same state machine as isolates: on a crash it
 * starts a new bus worker and asks the kernel to `reattach` every connected
 * isolate instead of restarting it.
 *
 * Contract errors (ADR 0003, decision 7) are fatal and never retried.
 */
import {
  createCommitter,
  topicConfigOf,
  type BusMetrics,
  type Committer,
  type BusRecord,
  type BusToHost,
  type BusToIsolate,
  type CallResult,
  type ContractsList,
  type DurabilityDegraded,
  type ErrorCode,
  type Grants,
  type HostToBus,
  type SeedEvent,
  type StartPosition,
  type BatchSender,
  type IsolateToBus,
  createBatchSender,
  isBusToHost,
  isBusToIsolate,
  unbatch,
} from '@isoloop/protocol';
import {
  initialSupervision,
  step,
  type CrashReason,
  type IsolateSupervision,
  type SupervisorConfig,
  type SupervisorEffect,
  type SupervisorInput,
} from '../supervisor';

export type BusFailure =
  /** The contracts module couldn't be used: the kernel can't start (ADR 0003). */
  | { code: ErrorCode; message: string }
  /** Crashed past the restart limit: isolates keep running, publishes reject (ADR 0007). */
  | { reason: CrashReason; message: string };

export type BusControllerEvents = {
  ready(first: boolean): void;
  /** Safe mode set these segments aside, as `<topic>/<file>` (ADR 0007, decision 5). */
  recovered(quarantined: string[]): void;
  /** Persistent topics run in memory on this bus (ADR 0007, decision 6). */
  degraded(reason: DurabilityDegraded): void;
  crash(reason: CrashReason, message: string): void;
  restart(restarts: number): void;
  failed(f: BusFailure): void;
  metrics(m: BusMetrics): void;
  /**
   * An isolate's bus port belongs to a bus worker that is gone. The kernel
   * answers with `connect(id, grants, { reattach: true })` and a `reattach`
   * message, or restarts the isolate.
   */
  reattach(isolateId: string): void;
  /** A record arrived for a suspended isolate's subscription (ADR 0001). */
  wake(isolateId: string, topic: string): void;
  /** Seeding news (ADR 0003, decision 18). */
  seed(e: SeedEvent): void;
  /** Persistent topics on disk the contracts no longer list (ADR 0003, decision 19). */
  orphaned(names: string[], bytes: number): void;
};

export type BusControllerOptions = {
  workerUrl: string;
  contracts: { url: string; list: ContractsList };
  heartbeatMs: number;
  supervisor: SupervisorConfig;
  dev: boolean;
  events: BusControllerEvents;
  /** Every message from the bus worker, before it is handled (the kernel's I7 count). */
  onControlMessage?: (msg: unknown) => void;
  /** Host publishes buffered while no bus worker runs. Default 1,000. */
  inboxLimit?: number;
  /** `KernelConfig.bus.commitIntervalMs` for the host's own subscriptions (ADR 0016). Default 100. */
  commitIntervalMs?: number;
  /** `KernelConfig.bus.batch` (ADR 0016, decision 3): passed to the bus at boot, used on host ports. */
  batch?: boolean;
};

export type HostSubscription = {
  topic: string;
  from: StartPosition;
  fn: (r: BusRecord) => void;
};

export interface BusController {
  /** Wires a new bus connection for an isolate and returns the isolate's end. */
  connect(isolateId: string, grants: Grants, o?: { reattach?: boolean }): MessagePort;
  /**
   * Ends an isolate's connection; its committed offsets stay (ADR 0005).
   * With `wake`, the bus watches its subscriptions for a suspended isolate.
   */
  detach(isolateId: string, o?: { wake?: boolean }): void;
  /** Forgets a suspended isolate the bus may still be watching for (stopped while asleep). */
  forget(isolateId: string): void;
  publish(topic: string, key: string | undefined, value: unknown): Promise<CallResult>;
  /** Deletes an orphaned persistent topic (`kernel.dropTopic`). */
  drop(topic: string, force: boolean): Promise<CallResult>;
  subscribe(sub: HostSubscription): () => void;
  /** Supervisor clock and page visibility, fed by the kernel. */
  feed(input: Extract<SupervisorInput, { k: 'tick' | 'hidden' | 'visible' }>): void;
  /** `failed` once the bus is down for good. */
  readonly state: IsolateSupervision['state'];
  /**
   * The page is freezing or going away: asks a running bus to write its
   * pending persistent records now. Nothing to do while no bus runs.
   */
  flush(): void;
  /** Test hook: kills the bus worker as a crash would. */
  crash(): void;
  destroy(): void;
}

/** Ids of the host's own bus connections; spawn rejects isolate ids with this prefix. */
export const HOST_CONNECTION_PREFIX = 'isoloop:';

const unavailable = (message: string): CallResult => ({
  ok: false,
  error: { code: 'bus_unavailable', message },
});

/**
 * A port nobody but the host listens to, answering everything with
 * `bus_unavailable`: what isolates get once the bus has failed for good.
 */
function deadPort(): MessagePort {
  const { port1, port2 } = new MessageChannel();
  port1.addEventListener('message', (e: MessageEvent<unknown>) => {
    const msg = e.data;
    if (typeof msg !== 'object' || msg === null || !('id' in msg)) return;
    const id: unknown = msg.id;
    if (typeof id !== 'string') return;
    const reply: BusToIsolate = { v: 1, t: 'result', re: id, p: unavailable('The bus is down') };
    port1.postMessage(reply);
  });
  port1.start();
  return port2;
}

type Conn = { grants: Grants; gen: number };

/** A crash this soon after `ready` still counts as one while loading (ADR 0007, decision 5). */
export const SAFE_MODE_WINDOW_MS = 2000;
/** Crashes while loading, in a row, before the next bus boots in safe mode. */
const SAFE_MODE_AFTER = 2;

type PendingPublish = {
  resolve: (r: CallResult) => void;
  sentTo: number | undefined;
  /** A `kernel.publish`, sent again if the bus dies before answering it (ADR 0007, step 6). */
  resend?: HostToBus;
};

/** A random epoch for the host's publish ids: one per page load (controller). */
const randomEpoch = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

export function createBusController(o: BusControllerOptions): BusController {
  const limit = o.inboxLimit ?? 1000;
  const topics = o.contracts.list.topics.map(topicConfigOf);
  let sup = initialSupervision(performance.now());
  let worker: Worker | null = null;
  /** Generation of the live bus worker, or of the next one while none runs. */
  let gen = 0;
  let everReady = false;
  /** When the live bus worker sent `ready`; unset while it loads. */
  let readyAt: number | undefined;
  /** Crashes during or right after loading, in a row. */
  let loadCrashes = 0;
  let fatal = false;
  let destroyed = false;
  let spawnTimer: ReturnType<typeof setTimeout> | undefined;
  /** Control messages waiting for a worker. */
  const queue: { msg: HostToBus; transfer: Transferable[] }[] = [];
  const conns = new Map<string, Conn>();
  const results = new Map<string, PendingPublish>();
  let nextId = 0;
  /** The host's publish ids (ADR 0007, step 6): its instance, and a counter. */
  const epoch = randomEpoch();
  let seq = 0;
  /** The host's own subscriptions, each on its own connection. */
  const hostSubs = new Map<
    string,
    {
      sub: HostSubscription;
      port: MessagePort | null;
      committer: Committer | null;
      /** Sends on `port`, batched per task with `bus.batch` on (ADR 0016, decision 3). */
      sender: BatchSender<IsolateToBus> | null;
    }
  >();

  const send = (msg: HostToBus, transfer: Transferable[] = []): void => {
    if (worker) worker.postMessage(msg, transfer);
    else queue.push({ msg, transfer });
  };

  const down = (): boolean => fatal || sup.state === 'failed';

  const kill = (): void => {
    if (!worker) return;
    worker.terminate();
    worker = null;
    gen++;
    // Calls the dead worker never answered. Publishes go to the next bus, in
    // order: a persistent topic answers one it already wrote by its id, and a
    // memory topic's log is gone, so nothing duplicates (ADR 0007, step 6).
    // Anything else (a drop) may or may not have happened, so it rejects.
    for (const [id, p] of results) {
      if (p.sentTo === undefined) continue;
      if (p.resend) {
        p.sentTo = undefined;
        queue.push({ msg: p.resend, transfer: [] });
        continue;
      }
      results.delete(id);
      p.resolve(unavailable('The bus restarted before answering'));
    }
  };

  const failForGood = (f: BusFailure): void => {
    kill();
    clearTimeout(spawnTimer);
    queue.length = 0;
    for (const [id, p] of results) {
      results.delete(id);
      p.resolve(unavailable(f.message));
    }
    o.events.failed(f);
    if ('code' in f) return;
    // Crash loop: isolates keep running, each on a port that rejects everything.
    for (const id of conns.keys()) {
      if (!hostSubs.has(id)) o.events.reattach(id);
    }
  };

  const onMessage = (msg: BusToHost): void => {
    switch (msg.t) {
      case 'ready': {
        const first = !everReady;
        everReady = true;
        readyAt = performance.now();
        feed({ k: 'ready' });
        o.events.ready(first);
        if (msg.p.quarantined) o.events.recovered(msg.p.quarantined);
        if (msg.p.degraded) o.events.degraded(msg.p.degraded);
        if (msg.p.orphaned) o.events.orphaned(msg.p.orphaned.names, msg.p.orphaned.bytes);
        return;
      }
      case 'beat':
        feed({ k: 'beat', at: performance.now(), lagMs: msg.p.lagMs });
        return;
      case 'metrics':
        o.events.metrics(msg.p);
        return;
      case 'result': {
        const p = msg.re === undefined ? undefined : results.get(msg.re);
        if (!p || msg.re === undefined) return;
        results.delete(msg.re);
        p.resolve(msg.p);
        return;
      }
      case 'wake':
        o.events.wake(msg.p.isolateId, msg.p.topic);
        return;
      case 'seed':
        o.events.seed(msg.p);
        return;
      case 'error':
        if (msg.p.fatal && msg.p.code !== undefined) {
          // A contracts error: deterministic, so no restart (ADR 0003, decision 7).
          fatal = true;
          failForGood({ code: msg.p.code, message: msg.p.message });
          return;
        }
        if (msg.p.fatal) {
          feed({ k: 'error', at: performance.now(), fatal: true, message: msg.p.message });
          return;
        }
        console.error(`[isoloop] bus: ${msg.p.message}`);
        return;
      default: {
        const never: never = msg;
        return never;
      }
    }
  };

  const spawn = (): void => {
    if (destroyed || down()) return;
    let w: Worker;
    try {
      w = new Worker(o.workerUrl, { type: 'module', name: 'isoloop-bus' });
    } catch (err) {
      feed({
        k: 'spawnFailed',
        at: performance.now(),
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    worker = w;
    const mine = gen;
    w.addEventListener('message', (e: MessageEvent<unknown>) => {
      o.onControlMessage?.(e.data);
      if (worker === w && isBusToHost(e.data)) onMessage(e.data);
    });
    w.addEventListener('error', (e) => {
      e.preventDefault();
      if (worker === w)
        feed({ k: 'workerError', at: performance.now(), message: e.message || 'Unknown error' });
    });
    // A persisted record is the likely cause of crashing while loading, again.
    const safeMode = loadCrashes >= SAFE_MODE_AFTER;
    if (safeMode) loadCrashes = 0;
    readyAt = undefined;
    w.postMessage({
      v: 1,
      t: 'boot',
      p: {
        contractsUrl: o.contracts.url,
        topics,
        heartbeatMs: o.heartbeatMs,
        dev: o.dev,
        ...(safeMode ? { safeMode: true } : {}),
        ...(mine > 0 ? { restart: true } : {}),
        ...(o.batch ? { batch: true } : {}),
      },
    } satisfies HostToBus);
    for (const q of queue.splice(0)) w.postMessage(q.msg, q.transfer);
    for (const p of results.values()) p.sentTo ??= mine;
    feed({ k: 'spawned', at: performance.now() });
    if (mine > 0) o.events.restart(sup.restarts);
    // Connections made to an older bus move to this one. The bus buffers
    // their publishes while it loads its contracts (ADR 0003, decision 8).
    for (const [id, c] of conns) {
      if (c.gen >= mine) continue;
      const host = hostSubs.get(id);
      if (host) bindHost(id, host.sub, true);
      else o.events.reattach(id);
    }
  };

  const run = (effects: SupervisorEffect[]): void => {
    for (const fx of effects) {
      switch (fx.k) {
        case 'terminate':
          kill();
          break;
        case 'spawn':
          clearTimeout(spawnTimer);
          spawnTimer = setTimeout(() => {
            spawnTimer = undefined;
            if (sup.state === 'restarting') spawn();
          }, fx.afterMs);
          break;
        case 'emit':
          if (fx.event === 'isolate:crash') {
            const loading =
              readyAt === undefined || performance.now() - readyAt < SAFE_MODE_WINDOW_MS;
            loadCrashes = loading ? loadCrashes + 1 : 0;
            o.events.crash(fx.data.reason, fx.data.message);
          } else if (fx.event === 'isolate:failed')
            failForGood({ reason: fx.data.reason, message: fx.data.message });
          break;
        case 'shutdown':
        case 'suspend':
        case 'wake':
        case 'showBusy':
        case 'hideBusy':
        case 'showFallback':
        case 'hideFallback':
          break;
      }
    }
  };

  function feed(input: SupervisorInput): void {
    const out = step(sup, input, o.supervisor);
    sup = out.s;
    run(out.effects);
  }

  const connect: BusController['connect'] = (isolateId, grants, opts = {}) => {
    if (down()) {
      conns.delete(isolateId);
      return deadPort();
    }
    const { port1, port2 } = new MessageChannel();
    conns.set(isolateId, { grants, gen });
    const attach: HostToBus = {
      v: 1,
      t: 'attach',
      p: { isolateId, grants, port: port2, ...(opts.reattach ? { reattach: true } : {}) },
    };
    send(attach, [port2]);
    return port1;
  };

  /** (Re)connects one host subscription and sends its subscribe. */
  const bindHost = (id: string, sub: HostSubscription, reattach: boolean): void => {
    const entry = hostSubs.get(id);
    if (!entry) return;
    entry.port?.close();
    entry.committer?.dispose();
    const port = connect(id, { publish: [], subscribe: ['*'] }, { reattach });
    const sender = createBatchSender<IsolateToBus>(
      (msg) => {
        port.postMessage(msg);
      },
      () => o.batch === true,
    );
    // One `commits` per host port per commit interval, earlier at half the
    // credit (ADR 0016, decision 1, point 4).
    const committer = createCommitter({
      send: (offsets) => {
        sender.send({ v: 1, t: 'commits', p: { offsets } });
      },
      ...(o.commitIntervalMs === undefined ? {} : { intervalMs: o.commitIntervalMs }),
    });
    // Offsets settled on the old port go first on the new one (decision 1, point 2).
    const carried = entry.committer?.pending();
    if (carried) for (const [topic, offset] of carried) committer.settle(topic, offset, 0);
    committer.flush();
    entry.port = port;
    entry.committer = committer;
    entry.sender = sender;
    port.addEventListener('message', (e: MessageEvent<unknown>) => {
      unbatch(e.data, (msg) => {
        if (!isBusToIsolate(msg) || msg.t !== 'deliver' || hostSubs.get(id)?.port !== port) return;
        for (const r of msg.p.records) {
          try {
            sub.fn(r);
          } catch (err) {
            console.error('[isoloop] kernel.subscribe handler threw', err);
          }
        }
        const last = msg.p.records.at(-1);
        if (last) committer.settle(sub.topic, last.offset, msg.p.records.length);
      });
    });
    port.start();
    sender.send({ v: 1, t: 'subscribe', p: { topic: sub.topic, from: sub.from } });
  };

  spawn();

  return {
    connect,

    detach(isolateId, opts = {}) {
      if (!conns.delete(isolateId)) return;
      const i = queue.findIndex((q) => q.msg.t === 'attach' && q.msg.p.isolateId === isolateId);
      const p = { isolateId, keepOffsets: true, ...(opts.wake ? { wake: true } : {}) };
      if (i >= 0) {
        queue.splice(i, 1);
        if (opts.wake) send({ v: 1, t: 'detach', p });
      } else if (worker) send({ v: 1, t: 'detach', p });
    },

    forget(isolateId) {
      if (worker && !conns.has(isolateId))
        send({ v: 1, t: 'detach', p: { isolateId, keepOffsets: true } });
    },

    publish(topic, key, value) {
      if (down()) return Promise.resolve(unavailable('The bus is down'));
      if (!worker && queue.filter((q) => q.msg.t === 'publish').length >= limit)
        return Promise.resolve(unavailable('The bus is restarting and its buffer is full'));
      const id = `h${++nextId}`;
      return new Promise((resolve) => {
        const p = key === undefined ? { topic, value } : { topic, key, value };
        const msg: HostToBus = { v: 1, t: 'publish', id, p: { ...p, epoch, seq: ++seq } };
        results.set(id, { resolve, sentTo: worker ? gen : undefined, resend: msg });
        send(msg);
      });
    },

    drop(topic, force) {
      if (down()) return Promise.resolve(unavailable('The bus is down'));
      const id = `h${++nextId}`;
      return new Promise((resolve) => {
        results.set(id, { resolve, sentTo: worker ? gen : undefined });
        send({ v: 1, t: 'drop', id, p: { topic, force } });
      });
    },

    subscribe(sub) {
      const id = `${HOST_CONNECTION_PREFIX}host:${++nextId}`;
      hostSubs.set(id, { sub, port: null, committer: null, sender: null });
      if (!down()) bindHost(id, sub, false);
      return () => {
        const entry = hostSubs.get(id);
        hostSubs.delete(id);
        entry?.committer?.flush();
        entry?.committer?.dispose();
        // What's queued for this task goes out before the port closes.
        entry?.sender?.flush();
        entry?.port?.close();
        if (conns.delete(id) && worker)
          send({ v: 1, t: 'detach', p: { isolateId: id, keepOffsets: false } });
      };
    },

    feed,

    get state() {
      return fatal ? 'failed' : sup.state;
    },

    flush() {
      if (worker && !down()) worker.postMessage({ v: 1, t: 'flush', p: {} } satisfies HostToBus);
    },

    crash() {
      if (worker)
        feed({
          k: 'workerError',
          at: performance.now(),
          message: 'Crashed on purpose (test hook)',
        });
    },

    destroy() {
      destroyed = true;
      clearTimeout(spawnTimer);
      for (const h of hostSubs.values()) {
        h.committer?.dispose();
        h.port?.close();
      }
      hostSubs.clear();
      worker?.terminate();
      worker = null;
    },
  };
}
