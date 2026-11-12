// The isolate BusClient on the real runtime and bus worker (plan m2-bus task 9).
import { afterEach, describe, expect, it, vi } from 'vitest';
import list, { count, report } from './__fixtures__/contracts';
import { createKernel, type Kernel, type KernelEvents } from './index';

const worker = (path: string): string =>
  `${new URL(path, import.meta.url).href}?worker_file&type=module`;
const src = new URL('./__fixtures__/bus-isolate.ts', import.meta.url).href;

type Seen = { id: string; values?: unknown[]; failed?: number };

const kernels: Kernel[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
});

function setup(commitIntervalMs?: number) {
  const kernel = createKernel({
    ...(commitIntervalMs === undefined ? {} : { bus: { commitIntervalMs } }),
    contracts: { url: new URL('./__fixtures__/contracts.ts', import.meta.url).href, list },
    workers: {
      isolateBootstrap: worker('../../runtime/src/bootstrap.ts'),
      bus: worker('../../bus/src/worker.ts'),
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
    for (const value of [1, 2, 3]) await kernel.publish(count, { value });
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
    for (const value of [1, 2, 3]) await kernel.publish(count, { value });
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
});
