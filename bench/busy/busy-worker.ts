/// <reference lib="dom" />
import { createBusy, installBusy } from '../../packages/runtime/src/pools/busy.ts';
import { WORKLOADS } from './workloads.ts';

/*
 * One variant in a fresh worker: `plain` leaves the globals native, `wrapped`
 * installs the busy-time wrapping the bootstrap installs in every worker
 * (ADR 0017, decision 2) and runs each workload as a member's code, inside a
 * frame, the way the runtime runs `start` and host messages.
 */
onmessage = async (e: MessageEvent<{ variant: string }>): Promise<void> => {
  const wrapped = e.data.variant === 'wrapped';
  const busy = createBusy();
  if (wrapped) installBusy(globalThis, busy);
  const owner = busy.of('member', busy.begin('member'));
  const out: Record<string, number | null> = {};
  for (const [name, w] of Object.entries(WORKLOADS)) {
    if (w.needs !== undefined && typeof Reflect.get(globalThis, w.needs) !== 'function') {
      out[name] = null;
      continue;
    }
    const go = (n: number): Promise<number> =>
      wrapped ? busy.run(owner, w.run, undefined, [n]) : w.run(n);
    // oxlint-disable-next-line no-await-in-loop -- one workload at a time, for clean timings
    await go(Math.max(1, Math.floor(w.n / 10))); // warm-up
    const t0 = performance.now();
    // oxlint-disable-next-line no-await-in-loop
    await go(w.n);
    out[name] = performance.now() - t0;
  }
  postMessage(out);
};
