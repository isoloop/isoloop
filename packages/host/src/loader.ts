/*
 * Turns a manifest into a running worker (design §4.2): a module worker from
 * the bootstrap URL, then `init` with the bus port transferred. The bus
 * controller made that port and attached its other end to the bus worker.
 */
import { PROTOCOL, type Grants, type HostToIsolate } from '@isoloop/protocol';

export type LoadedWorker = { worker: Worker };

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
};

export function load(o: LoadOptions): LoadedWorker {
  const worker = new Worker(o.bootstrapUrl, { type: 'module', name: o.id });
  const init: HostToIsolate = {
    v: 1,
    t: 'init',
    p: {
      isolateId: o.id,
      protocol: { min: PROTOCOL.min, max: PROTOCOL.v },
      renderFmt: o.renderFmt,
      config: o.config,
      grants: o.grants,
      busPort: o.busPort,
      heartbeatMs: o.heartbeatMs,
      src: new URL(o.src, document.baseURI).href,
    },
  };
  worker.postMessage(init, [o.busPort]);
  return { worker };
}
