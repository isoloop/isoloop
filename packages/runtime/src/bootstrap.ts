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
 * isolates the same way, one per `init` naming it in `isolate`, and never
 * closes itself: the host's loader terminates it after its last member.
 */
import {
  MAX_BLOCK_MS,
  PROTOCOL,
  isHostToIsolate,
  type HostToIsolate,
  type IdleReport,
  type InitPayload,
  type IsolateToHost,
  type ShutdownReason,
} from '@isoloop/protocol';
import { busy, installBusy, type Life } from './busy';
import { freezeBuiltins } from './freeze';
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
  /** This instance's life: its callbacks stop running when it ends (ADR 0015, decision 9). */
  life: Life;
  post: (msg: IsolateToHost) => void;
  /** Set once it has started: runs its onShutdown handlers. */
  shutdownHook: ((reason: ShutdownReason) => Promise<void>) | null;
  /** Set once it has started: what the beat reports for suspension (ADR 0001). */
  idleReport: (() => IdleReport) | null;
  /** Messages for it once it has started. */
  receive: ((msg: unknown) => void) | null;
  /** The `inspect` port, kept if it arrives before the runtime is built (ADR 0020). */
  inspectPort: MessagePort | null;
  /** Set once the runtime is built: hands it the `inspect` port. */
  onInspect: ((port: MessagePort) => void) | null;
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

/**
 * `block { ms }` (ADR 0020, decision 4): a real busy loop, so the beat goes
 * late and the supervisor acts as it would for a stuck isolate.
 */
export function blockFor(ms: number): void {
  const until = performance.now() + Math.min(Math.max(0, ms), MAX_BLOCK_MS);
  // The loop is the point.
  while (performance.now() < until) {}
}

/** Once per worker, after the first isolate's protocol check. */
function startHeartbeat(everyMs: number): void {
  if (beating) return;
  beating = true;
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const lagMs = Math.max(0, now - last - everyMs);
    // An own worker reports its isolate's idleness; a pool every member's,
    // by name, so the host can suspend the pool as a whole (ADR 0001).
    if (mode === 'pool') {
      const reports: Record<string, IdleReport> = {};
      for (const m of members.values())
        if (m.name !== undefined && m.idleReport) reports[m.name] = m.idleReport();
      postWorker({ v: 1, t: 'beat', p: { lagMs, members: reports } });
    } else {
      const idle = members.get(undefined)?.idleReport?.();
      postWorker({ v: 1, t: 'beat', p: idle ? { lagMs, idle } : { lagMs } });
    }
    last = now;
  }, everyMs);
}

/** `shutdown` for a member: `bye` once its handlers settle or the grace runs out. */
function shutdownMember(m: Member, graceMs: number, reason: ShutdownReason): void {
  // Out of the routing table at once, so a new `init` with the same name (a
  // restart) gets a fresh member while this one finishes.
  if (members.get(m.name) === m) members.delete(m.name);
  m.receive = null;
  const hook = m.shutdownHook;
  const done =
    (hook ? busy.run(busy.of(m.name, m.life), hook, undefined, [reason]) : undefined) ??
    Promise.resolve();
  const grace = new Promise((r) => setTimeout(r, Math.max(0, graceMs - 50)));
  void Promise.race([done, grace]).finally(() => {
    // Its handlers settled: what it registered no longer runs, so a stopped
    // member doesn't keep working in the pool it left.
    busy.end(m.life);
    m.post({ v: 1, t: 'bye', p: {} });
    // An own worker closes after its isolate. A pool stays open for the host
    // to terminate: other members may still be shutting down (they left the
    // routing table at once), and the host may have sent a new member's
    // `init` already. Closing here dropped both, so every later start in the
    // pool timed out waiting for `ready` (M3j).
    if (mode !== 'pool' && members.size === 0) self.close();
  });
}

/** Routes one message from the host to the member it is for. */
function route(msg: HostToIsolate): void {
  const m = members.get(mode === 'pool' ? msg.isolate : undefined);
  if (!m) return;
  if (msg.t === 'shutdown') shutdownMember(m, msg.p.graceMs, msg.p.reason);
  else if (msg.t === 'inspect') {
    // Sent just after `init`, usually before the runtime is built.
    const port: unknown = msg.p.port;
    if (!(port instanceof MessagePort)) return;
    if (m.onInspect) m.onInspect(port);
    else m.inspectPort = port;
  } else if (msg.t === 'block') {
    // Billed to the member, as its own busy loop would be (ADR 0017).
    const ms: unknown = msg.p.ms;
    if (typeof ms === 'number') busy.run(busy.of(m.name, m.life), blockFor, undefined, [ms]);
  } else if (m.receive) busy.run(busy.of(m.name, m.life), m.receive, undefined, [msg]);
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
  // In the member's frame: what it registers while being built (its bus
  // port's listener, among others) is billed to it (ADR 0017).
  const runtime = busy.run(busy.of(m.name, m.life), createVanillaIsolate, undefined, [
    init,
    m.post,
    self,
    mode === 'pool',
    m.name,
  ]);
  m.onInspect = (port) => {
    runtime.attachInspect(port);
  };
  if (m.inspectPort) {
    m.onInspect(m.inspectPort);
    m.inspectPort = null;
  }

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
  m.idleReport = () => ({ ...runtime.idle(), busyMs: busy.take(m.name) });
  m.post({
    v: 1,
    t: 'ready',
    p: {
      runtime: '@isoloop/runtime',
      adapter: 'vanilla',
      renderFmt: runtime.renderFmt,
      ...(requires === undefined ? {} : { requires }),
      ...(Reflect.get(self, Symbol.for('isoloop.worker-entry')) === true ? { entry: true } : {}),
    },
  });
  try {
    await busy.run(busy.of(m.name, m.life), start, undefined, [runtime.ctx]);
  } catch (err) {
    fatal(m, `start() threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Handles one message from the host: `init` boots a member, the rest is routed. */
function onMessage(e: MessageEvent<unknown>): void {
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
  if (mode === null) {
    mode = wants;
    // Pool members share this realm: freeze the built-ins before any member
    // loads, so one can't patch them for the others (M2c decision 6).
    if (mode === 'pool') freezeBuiltins();
  }
  if (members.has(name)) return;
  const m: Member = {
    name,
    life: busy.begin(name),
    post: memberPost(name),
    shutdownHook: null,
    idleReport: null,
    receive: null,
    inspectPort: null,
    onInspect: null,
  };
  members.set(name, m);
  boot(m, msg.p).catch((err: unknown) => {
    fatal(m, err instanceof Error ? err.message : String(err));
  });
}

/*
 * Once per worker. WebKit evaluates a module worker's entry a second time
 * when one of its modules imports it by URL (bundlers put shared code in the
 * entry chunk), and both instances would keep a listener: a second instance
 * would boot restarted pool members twice and close the worker when its copy
 * left. So every side effect starts here, under a marker on the worker's
 * global, and a second instance stays inert (docs/investigations/engine-constraints.md).
 */
const STARTED = Symbol.for('isoloop.bootstrap');

function startOnce(): void {
  // Before any member loads and before a pool freezes the built-ins: every
  // callback a member registers is billed to it (ADR 0017).
  installBusy(self, busy);
  self.addEventListener('message', onMessage);
}

if (Reflect.get(self, STARTED) === true) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Vite's import.meta.env, absent elsewhere
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV === true)
    console.warn('isoloop: worker entry evaluated twice; ignoring');
} else {
  Reflect.set(self, STARTED, true);
  startOnce();
}
