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

/** A pool the test drives member by member: ticks, busy time, stops and inits. */
function pool() {
  const worker = new Worker(new URL('./bootstrap.ts', import.meta.url), { type: 'module' });
  workers.push(worker);
  const ticks = new Map<string, number>();
  const sums = new Map<string, number>();
  const byes = new Map<string, () => void>();
  worker.addEventListener('message', (e: MessageEvent<unknown>) => {
    const d = e.data;
    if (typeof d !== 'object' || d === null) return;
    const t: unknown = Reflect.get(d, 't');
    if (t === 'tick') {
      const name = String(Reflect.get(d, 'name'));
      ticks.set(name, (ticks.get(name) ?? 0) + 1);
    } else if (isBeat(d)) {
      for (const [name, r] of Object.entries(d.p.members ?? {}))
        if (r.busyMs !== undefined) sums.set(name, (sums.get(name) ?? 0) + r.busyMs);
    } else if (t === 'bye') byes.get(String(Reflect.get(d, 'isolate')))?.();
  });
  return {
    init(name: string, config: unknown): void {
      const { port2 } = new MessageChannel();
      const init: HostToIsolate = {
        v: 1,
        t: 'init',
        isolate: name,
        p: {
          isolateId: name,
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
    },
    /** Stops `name` and resolves on its `bye`. */
    stop(name: string): Promise<void> {
      const bye = new Promise<void>((r) => byes.set(name, r));
      const msg: HostToIsolate = {
        v: 1,
        t: 'shutdown',
        isolate: name,
        p: { reason: 'stop', graceMs: 200 },
      };
      worker.postMessage(msg);
      return bye;
    },
    ticks: (name: string): number => ticks.get(name) ?? 0,
    /** Busy time since the last call. */
    take(): Map<string, number> {
      const out = new Map(sums);
      sums.clear();
      return out;
    },
  };
}

describe('a stopped pool member (ADR 0015, decision 9)', () => {
  for (const via of ['timeout', 'interval', 'raf', 'port'] as const) {
    it(`never runs its ${via} callbacks again, while a neighbour keeps running`, async () => {
      const p = pool();
      p.init('gone', { via, burnMs: 1, tick: 'gone' });
      p.init('stays', { via: 'interval', burnMs: 0, tick: 'stays' });
      await wait(400);
      expect(p.ticks('gone')).toBeGreaterThan(5);
      await p.stop('gone');
      const gone = p.ticks('gone');
      const stays = p.ticks('stays');
      await wait(500);
      expect(p.ticks('gone')).toBe(gone);
      expect(p.ticks('stays')).toBeGreaterThan(stays + 10);
    });
  }

  it('bills nothing of its old copy to a member restarted under the same name', async () => {
    const p = pool();
    // A neighbour keeps the pool open: it closes after its last member.
    p.init('other', { via: 'interval', burnMs: 0 });
    p.init('task', { via: 'interval', burnMs: 3 });
    await wait(400);
    await p.stop('task');
    // The same name again, with no work: only its own (near-zero) time counts.
    p.init('task', { via: 'interval', burnMs: 0 });
    await wait(400);
    p.take();
    await wait(1000);
    const got = p.take();
    // The beat reports it again: it did restart.
    expect(got.has('task')).toBe(true);
    expect(got.get('task') ?? 0).toBeLessThan(30);
  });
});
