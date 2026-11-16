/*
 * Busy time through the bootstrap (ADR 0017): in a pool, each member's
 * `busyMs` in the beat is its own work, whether it runs from a timer chain,
 * an interval, animation frames or a port it made; an own worker reports it
 * in `idle`.
 */
import type { HostToIsolate, IdleReport } from '@isoloop/protocol';
import { afterEach, describe, expect, it } from 'vitest';

const workers: Worker[] = [];
afterEach(() => {
  for (const w of workers.splice(0)) w.terminate();
});

const src = new URL('./__fixtures__/busy-member.ts', import.meta.url).href;

type Beat = { t: 'beat'; p: { idle?: IdleReport; members?: Record<string, IdleReport> } };
const isBeat = (d: unknown): d is Beat =>
  typeof d === 'object' && d !== null && Reflect.get(d, 't') === 'beat';

/** Starts a worker with `members` (by name; `undefined`: an own worker) and sums their busy time. */
function start(members: { name: string | undefined; config: unknown }[]) {
  const worker = new Worker(new URL('./bootstrap.ts', import.meta.url), { type: 'module' });
  workers.push(worker);
  const sums = new Map<string, number>();
  worker.addEventListener('message', (e: MessageEvent<unknown>) => {
    if (!isBeat(e.data)) return;
    const { idle, members: by } = e.data.p;
    if (idle?.busyMs !== undefined) sums.set('(own)', (sums.get('(own)') ?? 0) + idle.busyMs);
    for (const [name, r] of Object.entries(by ?? {}))
      if (r.busyMs !== undefined) sums.set(name, (sums.get(name) ?? 0) + r.busyMs);
  });
  for (const { name, config } of members) {
    const { port2 } = new MessageChannel();
    const init: HostToIsolate = {
      v: 1,
      t: 'init',
      ...(name === undefined ? {} : { isolate: name }),
      p: {
        isolateId: name ?? 'own',
        protocol: { min: 1, max: 1 },
        renderFmt: 'none',
        config,
        grants: { publish: [], subscribe: [] },
        busPort: port2,
        heartbeatMs: 100,
        src,
      },
    };
    worker.postMessage(init, [port2]);
  }
  return {
    /** Sums since the last call. */
    take(): Map<string, number> {
      const out = new Map(sums);
      sums.clear();
      return out;
    },
  };
}

const wait = (ms: number): Promise<void> =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

describe('busy time in the beat', () => {
  for (const via of ['timeout', 'interval', 'raf', 'port'] as const) {
    it(`bills a pool member's work from ${via} to it, not its neighbour`, async () => {
      const w = start([
        { name: 'heavy', config: { via, burnMs: 3 } },
        { name: 'light', config: { via, burnMs: 0 } },
      ]);
      await wait(500);
      w.take();
      await wait(1500);
      const sums = w.take();
      const heavy = sums.get('heavy') ?? 0;
      const light = sums.get('light') ?? 0;
      // At least 3 ms per run, every 10 ms or every frame: well over 100 ms in 1.5 s.
      expect(heavy).toBeGreaterThan(100);
      expect(light).toBeLessThan(heavy / 10);
    });
  }

  it("reports an own worker's busy time in idle", async () => {
    const w = start([{ name: undefined, config: { via: 'interval', burnMs: 3 } }]);
    await wait(500);
    w.take();
    await wait(1000);
    expect(w.take().get('(own)') ?? 0).toBeGreaterThan(80);
  });
});
