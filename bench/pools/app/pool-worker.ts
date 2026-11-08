/// <reference lib="webworker" />
/*
 * The gate's prototype worker (M2c task 0). It hosts the members it is told
 * to, each with its own runtime context (createVanillaIsolate, headless, its
 * own bus port), and starts them. With one member it is an own worker; with
 * twenty it is a pool. Same script both ways, so the only difference measured
 * is how many workers the members are spread over.
 */
import { PROTOCOL, type InitPayload } from '@isoloop/protocol';
import { createVanillaIsolate } from '../../../packages/runtime/src/vanilla.ts';
import members from 'virtual:members';

declare const self: DedicatedWorkerGlobalScope;

type Start = { members: number[]; ports: MessagePort[] };

self.addEventListener('message', (e: MessageEvent<Start>) => {
  const { members: ids, ports } = e.data;
  void Promise.all(
    ids.map(async (n, k) => {
      const port = ports[k];
      if (!port) throw new Error(`no bus port for member ${n}`);
      const init: InitPayload = {
        isolateId: `m${n}`,
        protocol: { min: PROTOCOL.min, max: PROTOCOL.v },
        renderFmt: 'none',
        config: undefined,
        grants: { publish: [], subscribe: [] },
        busPort: port,
        heartbeatMs: 1000,
        src: '',
      };
      const runtime = createVanillaIsolate(init, () => {}, self);
      const load = members[n];
      if (!load) throw new Error(`no member ${n}`);
      const mod = await load();
      await mod.default.start(runtime.ctx);
      self.postMessage({ ready: n });
    }),
  );
});
