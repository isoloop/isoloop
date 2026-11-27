// The isolate BusClient on the real runtime and bus worker (plan m2-bus task 9).
import { afterEach, describe, expect, it, vi } from 'vitest';
import list, { count, report, saved } from '../__fixtures__/contracts';
import { createKernel, type Kernel, type KernelEvents } from '../index';

const worker = (path: string): string =>
  `${new URL(path, import.meta.url).href}?worker_file&type=module`;
const src = new URL('../__fixtures__/bus-isolate.ts', import.meta.url).href;

type Seen = {
  id: string;
  values?: unknown[];
  failed?: number;
  views?: Record<string, [string | null, unknown][]>;
  calls?: number;
};

const kernels: Kernel[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
  // The watch test writes a persistent topic to this origin's OPFS: start every test empty.
  const origin = await navigator.storage.getDirectory();
  await vi.waitUntil(() =>
    origin.removeEntry('isoloop', { recursive: true }).then(
      () => true,
      (e: unknown) => e instanceof DOMException && e.name === 'NotFoundError',
    ),
  );
});

function setup(commitIntervalMs?: number) {
  const kernel = createKernel({
    ...(commitIntervalMs === undefined ? {} : { bus: { commitIntervalMs } }),
    contracts: { url: new URL('../__fixtures__/contracts.ts', import.meta.url).href, list },
    workers: {
      isolateBootstrap: worker('../../../runtime/src/bootstrap.ts'),
      bus: worker('../../../bus/src/worker.ts'),
    },
    supervisor: { backoff: { initialMs: 50 } },
  });
  kernels.push(kernel);
  const reports: Seen[] = [];
  kernel.subscribe(report, (r) => reports.push(r.value), { from: 'earliest' });
  const log = <E extends keyof KernelEvents>(e: E): KernelEvents[E][] => {
    const got: KernelEvents[E][] = [];
    kernel.on(e, (x) => got.push(x));
    return got;
  };
  return { kernel, reports, log };
}

const ALL = { publish: ['*'], subscribe: ['*'] };

describe('BusClient', () => {
  it('a handler that throws commits nothing more; the record comes back after a restart', async () => {
    const { kernel, reports, log } = setup();
    const errors = log('isolate:error');
    const ready = log('isolate:ready');
    kernel.spawn({ id: 'F', src, grants: ALL, config: { mode: 'flaky' } });
    await vi.waitUntil(() => ready.length === 1);
    // oxlint-disable-next-line no-await-in-loop -- in order on purpose
    for (const value of [1, 2, 3]) await kernel.publish(count, value);
    await vi.waitUntil(() => reports.some((r) => r.values?.length === 3));
    expect(errors.map((e) => e.message)).toEqual(['flaky handler']);

    // `restart` kills the worker, as a crash would. Commits go out once per
    // interval (ADR 0016, decision 1): let one pass so 1's commit reaches the bus.
    await new Promise((r) => setTimeout(r, 200));
    reports.length = 0;
    await kernel.restart('F');
    // 1 was committed; 2 threw, so 2 and 3 are delivered again (at least once).
    await vi.waitUntil(() => reports.some((r) => r.values?.length === 2), { timeout: 3000 });
    expect(reports.find((r) => r.values?.length === 2)?.values).toEqual([2, 3]);
  });

  it('a kill within the commit interval redelivers what was handled in it (ADR 0016, decision 1)', async () => {
    // The cost decision 1 accepts: a worker killed without a graceful
    // shutdown loses the offsets settled since the last send.
    const { kernel, reports, log } = setup(1000);
    const ready = log('isolate:ready');
    kernel.spawn({ id: 'F', src, grants: ALL, config: { mode: 'flaky' } });
    await vi.waitUntil(() => ready.length === 1);
    // oxlint-disable-next-line no-await-in-loop -- in order on purpose
    for (const value of [1, 2, 3]) await kernel.publish(count, value);
    await vi.waitUntil(() => reports.some((r) => r.values?.length === 3));
    reports.length = 0;
    await kernel.restart('F');
    // Nothing was committed yet: 1 comes again too.
    await vi.waitUntil(() => reports.some((r) => r.values?.length === 3), { timeout: 3000 });
    expect(reports.find((r) => r.values?.length === 3)?.values).toEqual([1, 2, 3]);
  });

  it('publishes made during a bus restart arrive after it, in order, and none rejects', async () => {
    const { kernel, reports, log } = setup();
    const busReady = log('bus:ready');
    kernel.spawn({ id: 'P', src, grants: ALL, config: { mode: 'publisher' } });
    await vi.waitUntil(() => busReady.length === 1);
    await new Promise((r) => setTimeout(r, 100));
    kernel.debug.crashBus();
    await vi.waitUntil(() => busReady.length === 2, { timeout: 3000 });

    const values: number[] = [];
    kernel.subscribe(count, (r) => values.push(r.value), { from: 'earliest' });
    await vi.waitUntil(() => values.length > 30, { timeout: 3000 });
    // The new log starts at the first publish the old bus never answered,
    // and nothing after it is lost or reordered.
    const first = values[0] ?? 0;
    expect(values).toEqual(values.map((_, i) => first + i));
    expect(first).toBeGreaterThan(0);
    expect(reports.some((r) => (r.failed ?? 0) > 0)).toBe(false);
  });

  it('watches across a bus restart: a persistent topic keeps its values, a memory topic resets to empty (ADR 0023)', async () => {
    const { kernel, reports, log } = setup();
    const ready = log('isolate:ready');
    const busReady = log('bus:ready');
    kernel.spawn({ id: 'W', src, grants: ALL, config: { mode: 'watcher' } });
    await vi.waitUntil(() => ready.length === 1);
    await kernel.publish(count, 1, { key: 'a' });
    await kernel.publish(count, 2, { key: 'b' });
    await kernel.publish(saved, 3, { key: 'a' });
    await kernel.publish(saved, 4, { key: 'a' });
    const last = (): Seen | undefined => {
      for (let i = reports.length - 1; i >= 0; i--) if (reports[i]?.id === 'W') return reports[i];
      return undefined;
    };
    await vi.waitUntil(
      () =>
        last()?.views?.['count.v1']?.length === 2 && last()?.views?.['saved.v1']?.[0]?.[1] === 4,
      { timeout: 3000 },
    );
    expect(last()?.views).toEqual({
      'count.v1': [
        ['a', 1],
        ['b', 2],
      ],
      'saved.v1': [['a', 4]],
    });

    kernel.debug.crashBus();
    await vi.waitUntil(() => busReady.length === 2, { timeout: 3000 });
    // The memory topic was lost: its view is empty. The persistent one is as it was.
    await vi.waitUntil(() => last()?.views?.['count.v1']?.length === 0, { timeout: 3000 });
    expect(last()?.views?.['saved.v1']).toEqual([['a', 4]]);

    // Both read on from the new bus.
    await kernel.publish(count, 5, { key: 'c' });
    await kernel.publish(saved, 6, { key: 'b' });
    await vi.waitUntil(
      () => last()?.views?.['count.v1']?.length === 1 && last()?.views?.['saved.v1']?.length === 2,
      { timeout: 3000 },
    );
    expect(last()?.views).toEqual({
      'count.v1': [['c', 5]],
      'saved.v1': [
        ['a', 4],
        ['b', 6],
      ],
    });
  });
});
