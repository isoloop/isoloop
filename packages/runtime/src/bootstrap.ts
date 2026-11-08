/// <reference lib="webworker" />
/*
 * Isolate worker entry, built as isolate-bootstrap.js. Waits for `init`,
 * checks the protocol range, starts the heartbeat, installs the DOM subset
 * (when it has a surface), then imports the isolate module from `init.src`
 * and starts it. The module's default export is
 * `{ start(ctx) }`: rendered with isoloop-dom@1 into `ctx.root`, the DOM
 * subset installed as `document` when it has a surface.
 *
 * On `shutdown` it says `bye` and closes. A pool (M2c) hosts several
 * isolates the same way, one per `init` naming it in `isolate`, and closes
 * after its last member says `bye`.
 */
import {
  PROTOCOL,
  isHostToIsolate,
  type HostToIsolate,
  type IdleReport,
  type InitPayload,
  type IsolateToHost,
  type ShutdownReason,
} from '@isoloop/protocol';
import type { VanillaRuntime } from './vanilla';

declare const self: DedicatedWorkerGlobalScope;

/*
 * Own worker or pool (M2c, ADR 0001). An `init` without `isolate` makes this
 * an own worker: one isolate, envelopes without `isolate`, exactly as before
 * pools. An `init` with `isolate` makes it a pool: every later `init` adds a
 * member, every message to or from a member names it in `isolate`, and the
 * beat is the worker's. A worker is one or the other for its whole life.
 */
type Mode = 'own' | 'pool';
let mode: Mode | null = null;

/** One isolate hosted here: an own worker has one, a pool several. */
type Member = {
  /** `isolate` on its envelopes; undefined on an own worker. */
  name: string | undefined;
  post: (msg: IsolateToHost) => void;
  /** Set once it has started: runs its onShutdown handlers. */
  shutdownHook: ((reason: ShutdownReason) => Promise<void>) | null;
  /** Set once it has started: what the beat reports for suspension (ADR 0001). */
  idleReport: (() => IdleReport) | null;
  /** Messages for it once it has started. */
  receive: ((msg: unknown) => void) | null;
};

const members = new Map<string | undefined, Member>();

const postWorker = (msg: IsolateToHost): void => {
  self.postMessage(msg);
};

const memberPost =
  (name: string | undefined) =>
  (msg: IsolateToHost): void => {
    self.postMessage(name === undefined ? msg : { ...msg, isolate: name });
  };

const fatal = (m: Member, message: string, code?: 'protocol_mismatch'): void => {
  m.post({ v: 1, t: 'error', p: code ? { message, fatal: true, code } : { message, fatal: true } });
};

let beating = false;

/** Once per worker, after the first isolate's protocol check. */
function startHeartbeat(everyMs: number): void {
  if (beating) return;
  beating = true;
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const lagMs = Math.max(0, now - last - everyMs);
    // An own worker reports its isolate's idleness; a pool's beat is the
    // worker's alone (suspension of a pool as a whole is M2c task 6).
    const own = mode === 'own' ? members.get(undefined) : undefined;
    const idle = own?.idleReport?.();
    postWorker({ v: 1, t: 'beat', p: idle ? { lagMs, idle } : { lagMs } });
    last = now;
  }, everyMs);
}

/** `shutdown` for a member: `bye` once its handlers settle or the grace runs out. */
function shutdownMember(m: Member, graceMs: number, reason: ShutdownReason): void {
  const done = m.shutdownHook?.(reason) ?? Promise.resolve();
  const grace = new Promise((r) => setTimeout(r, Math.max(0, graceMs - 50)));
  void Promise.race([done, grace]).finally(() => {
    m.post({ v: 1, t: 'bye', p: {} });
    members.delete(m.name);
    // An own worker closes after its isolate; a pool after its last member.
    if (members.size === 0) self.close();
  });
}

/** Routes one message from the host to the member it is for. */
function route(msg: HostToIsolate): void {
  const m = members.get(mode === 'pool' ? msg.isolate : undefined);
  if (!m) return;
  if (msg.t === 'shutdown') shutdownMember(m, msg.p.graceMs, msg.p.reason);
  else m.receive?.(msg);
}

async function boot(m: Member, init: InitPayload): Promise<void> {
  if (init.protocol.min > PROTOCOL.v || init.protocol.max < PROTOCOL.min) {
    fatal(
      m,
      `Host speaks protocol ${init.protocol.min}–${init.protocol.max}, this runtime ${PROTOCOL.min}–${PROTOCOL.v}`,
      'protocol_mismatch',
    );
    return;
  }
  startHeartbeat(init.heartbeatMs);

  // The runtime first, so the DOM subset is the worker's `document` before
  // the isolate module loads: React checks for a DOM at load time (M3a).
  // Loaded on demand, so a worker's first beat doesn't wait for the subset.
  const { createVanillaIsolate } = await import('./vanilla');
  const runtime = createVanillaIsolate(init, m.post, self);

  let mod: unknown;
  try {
    mod = await import(/* @vite-ignore */ init.src);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    const cross = new URL(init.src).origin !== self.location.origin;
    fatal(
      m,
      `Could not import ${init.src}: ${why}${cross ? ' (a cross-origin isolate needs CORS headers; see docs/guide/hosting.md)' : ''}`,
    );
    return;
  }
  const main: unknown =
    typeof mod === 'object' && mod !== null && 'default' in mod ? mod.default : undefined;
  if (typeof main === 'object' && main !== null && 'start' in main) {
    const start: unknown = main.start;
    if (typeof start === 'function') {
      const requires: unknown = 'requires' in main ? main.requires : undefined;
      await startIsolate(
        m,
        runtime,
        (ctx) => Reflect.apply(start, main, [ctx]),
        typeof requires === 'string' ? requires : undefined,
      );
      return;
    }
  }
  fatal(m, `${init.src} has no default export with start(ctx)`);
}

async function startIsolate(
  m: Member,
  runtime: VanillaRuntime,
  start: (ctx: unknown) => unknown,
  /** The definition's `requires` stamp (ADR 0012), reported in `ready` for the host to check. */
  requires: string | undefined,
): Promise<void> {
  m.receive = (msg) => {
    runtime.receive(msg);
  };
  m.shutdownHook = (reason) => runtime.shutdown(reason);
  m.idleReport = () => runtime.idle();
  m.post({
    v: 1,
    t: 'ready',
    p: {
      runtime: '@isoloop/runtime',
      adapter: 'vanilla',
      renderFmt: runtime.renderFmt,
      ...(requires === undefined ? {} : { requires }),
    },
  });
  try {
    await start(runtime.ctx);
  } catch (err) {
    fatal(m, `start() threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

self.addEventListener('message', (e: MessageEvent<unknown>) => {
  const msg = e.data;
  if (!isHostToIsolate(msg)) return;
  if (msg.t !== 'init') {
    route(msg);
    return;
  }
  const name = msg.isolate;
  const wants: Mode = name === undefined ? 'own' : 'pool';
  // An own worker takes one init; a pool takes one per member.
  if (mode === 'own' || (mode === 'pool' && wants === 'own')) return;
  mode ??= wants;
  if (members.has(name)) return;
  const m: Member = {
    name,
    post: memberPost(name),
    shutdownHook: null,
    idleReport: null,
    receive: null,
  };
  members.set(name, m);
  boot(m, msg.p).catch((err: unknown) => {
    fatal(m, err instanceof Error ? err.message : String(err));
  });
});
