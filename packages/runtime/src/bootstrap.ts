/// <reference lib="webworker" />
/*
 * Isolate worker entry, built as isolate-bootstrap.js. Waits for `init`,
 * checks the protocol range, starts the heartbeat, then imports the isolate
 * module from `init.src` and calls its default export.
 */
import {
  PROTOCOL,
  isHostToIsolate,
  type InitPayload,
  type IsolateToHost,
  type LegacyIsolateToHost,
} from '@isoloop/protocol';
import { createLegacyIsolate } from './legacy/runtime';
import { LEGACY_VDOM } from './legacy/vdom';

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

  const runtime = createLegacyIsolate({
    id: init.isolateId,
    config: init.config,
    initial: {},
    post,
  });
  self.addEventListener('message', (e: MessageEvent<unknown>) => {
    runtime.receive(e.data);
  });
  startHeartbeat(init.heartbeatMs);

  const mod: unknown = await import(/* @vite-ignore */ init.src);
  const main: unknown =
    typeof mod === 'object' && mod !== null && 'default' in mod ? mod.default : undefined;
  if (typeof main !== 'function') {
    fatal(`${init.src} has no default export function`);
    return;
  }
  post({ v: 1, t: 'ready', p: { runtime: RUNTIME, adapter: 'legacy', renderFmt: LEGACY_VDOM } });
  // Called untyped: the module's own LegacyIsolate<State> is checked where it's written.
  Reflect.apply(main, undefined, [runtime.iso]);
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
