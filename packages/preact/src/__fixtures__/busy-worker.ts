// Starts the real bootstrap with visual members and sums each member's
// `busyMs` from the beats (ADR 0017), for the adapters' busy-time tests.
import type { HostToIsolate } from '@isoloop/protocol';

const live: Worker[] = [];

type Member = { name: string; config: unknown };

const wait = (ms: number): Promise<void> =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

const membersOf = (d: unknown): Record<string, unknown> | undefined => {
  if (typeof d !== 'object' || d === null || Reflect.get(d, 't') !== 'beat') return undefined;
  const p: unknown = Reflect.get(d, 'p');
  const m: unknown = typeof p === 'object' && p !== null ? Reflect.get(p, 'members') : undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the beat's shape (protocol)
  return typeof m === 'object' && m !== null ? (m as Record<string, unknown>) : undefined;
};

/** `worker` runs the bootstrap; made by the test, so Vite sees `new Worker(new URL(…))`. */
export type BusyWorker = {
  /** Waits `ms`, then forgets what was summed so far (start-up). */
  settle(ms: number): Promise<void>;
  /** What each member was billed over the next `ms`. */
  sum(ms: number): Promise<Map<string, number>>;
};

export function busyWorker(worker: Worker, src: string, members: Member[]): BusyWorker {
  live.push(worker);
  const sums = new Map<string, number>();
  worker.addEventListener('message', (e: MessageEvent<unknown>) => {
    for (const [name, r] of Object.entries(membersOf(e.data) ?? {})) {
      const ms: unknown = typeof r === 'object' && r !== null ? Reflect.get(r, 'busyMs') : 0;
      if (typeof ms === 'number') sums.set(name, (sums.get(name) ?? 0) + ms);
    }
  });
  for (const { name, config } of members) {
    const { port2 } = new MessageChannel();
    const init: HostToIsolate = {
      v: 1,
      t: 'init',
      isolate: name,
      p: {
        isolateId: name,
        protocol: { min: 1, max: 1 },
        renderFmt: 'isoloop-dom@1',
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
    async settle(ms: number): Promise<void> {
      await wait(ms);
      sums.clear();
    },
    async sum(ms: number): Promise<Map<string, number>> {
      await wait(ms);
      return new Map(sums);
    },
  };
}

/** Terminates every worker `busyWorker` was given. */
export function stopBusyWorkers(): void {
  for (const w of live.splice(0)) w.terminate();
}
