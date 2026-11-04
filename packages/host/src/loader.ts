/*
 * Turns a manifest into a running worker (design §4.2): a module worker from
 * the bootstrap URL, then `init`. In M0 the bus port is an unused channel end,
 * since bus traffic still goes through the main thread.
 */
import { PROTOCOL, type Grants, type HostToIsolate } from '@isoloop/protocol';

export type LoadedWorker = { worker: Worker; busPort: MessagePort };

export type LoadOptions = {
  bootstrapUrl: string;
  id: string;
  src: string;
  config: unknown;
  grants: Grants;
  renderFmt: string;
  heartbeatMs: number;
};

export function load(o: LoadOptions): LoadedWorker {
  const worker = new Worker(o.bootstrapUrl, { type: 'module', name: o.id });
  const { port1, port2 } = new MessageChannel();
  const init: HostToIsolate = {
    v: 1,
    t: 'init',
    p: {
      isolateId: o.id,
      protocol: { min: PROTOCOL.min, max: PROTOCOL.v },
      renderFmt: o.renderFmt,
      config: o.config,
      grants: o.grants,
      busPort: port2,
      heartbeatMs: o.heartbeatMs,
      src: new URL(o.src, document.baseURI).href,
    },
  };
  worker.postMessage(init, [port2]);
  return { worker, busPort: port1 };
}
