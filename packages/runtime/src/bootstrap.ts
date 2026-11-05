/// <reference lib="webworker" />
/*
 * Isolate worker entry, built as isolate-bootstrap.js. Waits for `init`,
 * checks the protocol range, starts the heartbeat, then imports the isolate
 * module from `init.src` and starts it. Two module shapes:
 *
 * - a default export function: an M0 legacy isolate (legacy-vdom@1);
 * - a default export `{ start(ctx) }`: rendered with isoloop-dom@1 into
 *   `ctx.root`, the DOM subset installed as `document` when it has a surface.
 *   The full vanilla API (styles, onShutdown, host calls) is M1 task 11.
 *
 * On `shutdown` it says `bye` and closes.
 */
import {
  PROTOCOL,
  isHostToIsolate,
  type InitPayload,
  type IsolateToHost,
  type LegacyIsolateToHost,
  type ShutdownReason,
} from '@isoloop/protocol';
import { createLegacyIsolate } from './legacy/runtime';
import { LEGACY_VDOM } from './legacy/vdom';
import { createVanillaIsolate } from './vanilla';

declare const self: DedicatedWorkerGlobalScope;

const RUNTIME = '@isoloop/runtime legacy';

const post = (msg: IsolateToHost | LegacyIsolateToHost): void => {
  self.postMessage(msg);
};

const fatal = (message: string, code?: 'protocol_mismatch'): void => {
  post({ v: 1, t: 'error', p: code ? { message, fatal: true, code } : { message, fatal: true } });
};

function startHeartbeat(everyMs: number): void {
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    post({ v: 1, t: 'beat', p: { lagMs: Math.max(0, now - last - everyMs) } });
    last = now;
  }, everyMs);
}

async function boot(init: InitPayload): Promise<void> {
  if (init.protocol.min > PROTOCOL.v || init.protocol.max < PROTOCOL.min) {
    fatal(
      `Host speaks protocol ${init.protocol.min}–${init.protocol.max}, this runtime ${PROTOCOL.min}–${PROTOCOL.v}`,
      'protocol_mismatch',
    );
    return;
  }

  // `bye` once the isolate's onShutdown handlers settle, or when the grace runs out.
  self.addEventListener('message', (e: MessageEvent<unknown>) => {
    const msg = e.data;
    if (!isHostToIsolate(msg) || msg.t !== 'shutdown') return;
    const done = shutdownHook?.(msg.p.reason) ?? Promise.resolve();
    const grace = new Promise((r) => setTimeout(r, Math.max(0, msg.p.graceMs - 50)));
    void Promise.race([done, grace]).finally(() => {
      post({ v: 1, t: 'bye', p: {} });
      self.close();
    });
  });
  startHeartbeat(init.heartbeatMs);

  let mod: unknown;
  try {
    mod = await import(/* @vite-ignore */ init.src);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    const cross = new URL(init.src).origin !== self.location.origin;
    fatal(
      `Could not import ${init.src}: ${why}${cross ? ' (a cross-origin isolate needs CORS headers; see docs/guide/hosting.md)' : ''}`,
    );
    return;
  }
  const main: unknown =
    typeof mod === 'object' && mod !== null && 'default' in mod ? mod.default : undefined;
  if (typeof main === 'function') {
    startLegacy(init, main);
    return;
  }
  if (typeof main === 'object' && main !== null && 'start' in main) {
    const start: unknown = main.start;
    if (typeof start === 'function') {
      await startIsolate(init, (ctx) => Reflect.apply(start, main, [ctx]));
      return;
    }
  }
  fatal(`${init.src} has no default export: a function, or an object with start(ctx)`);
}

/** Set by a `{ start(ctx) }` isolate: runs its onShutdown handlers. */
let shutdownHook: ((reason: ShutdownReason) => Promise<void>) | null = null;

const isShutdown = (e: MessageEvent<unknown>): boolean =>
  isHostToIsolate(e.data) && e.data.t === 'shutdown';

function startLegacy(init: InitPayload, main: Function): void {
  const runtime = createLegacyIsolate({
    id: init.isolateId,
    config: init.config,
    initial: {},
    post,
  });
  self.addEventListener('message', (e: MessageEvent<unknown>) => {
    if (!isShutdown(e)) runtime.receive(e.data);
  });
  const renderFmt = init.renderFmt === 'none' ? 'none' : LEGACY_VDOM;
  post({ v: 1, t: 'ready', p: { runtime: RUNTIME, adapter: 'legacy', renderFmt } });
  // Called untyped: the module's own LegacyIsolate<State> is checked where it's written.
  Reflect.apply(main, undefined, [runtime.iso]);
}

async function startIsolate(init: InitPayload, start: (ctx: unknown) => unknown): Promise<void> {
  const runtime = createVanillaIsolate(init, post, self);
  self.addEventListener('message', (e: MessageEvent<unknown>) => {
    runtime.receive(e.data);
  });
  shutdownHook = (reason) => runtime.shutdown(reason);
  post({
    v: 1,
    t: 'ready',
    p: { runtime: '@isoloop/runtime', adapter: 'vanilla', renderFmt: runtime.renderFmt },
  });
  try {
    await start(runtime.ctx);
  } catch (err) {
    fatal(`start() threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const onInit = (e: MessageEvent<unknown>): void => {
  const msg = e.data;
  if (!isHostToIsolate(msg) || msg.t !== 'init') return;
  self.removeEventListener('message', onInit);
  boot(msg.p).catch((err: unknown) => {
    fatal(err instanceof Error ? err.message : String(err));
  });
};
self.addEventListener('message', onInit);
