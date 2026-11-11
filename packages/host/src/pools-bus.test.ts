// Per-member errors in a pool (M2c task 4), on the real runtime and bus
// worker: a member whose bus handler throws reports a (non-fatal) error under
// its own id, the other members keep running, and restarting that member
// alone replays it from its own committed offset.
import { afterEach, describe, expect, it, vi } from 'vitest';
import list, { count, report } from './__fixtures__/contracts';
import { createKernel, type Kernel, type KernelEvents } from './index';

const worker = (path: string): string =>
  `${new URL(path, import.meta.url).href}?worker_file&type=module`;
const src = new URL('./__fixtures__/bus-isolate.ts', import.meta.url).href;

type Seen = { id: string; values?: unknown[] };

const kernels: Kernel[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
});

function setup() {
  const kernel = createKernel({
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

describe('per-member errors in a pool (M2c)', () => {
  it('a throwing handler is that member’s error; restarting it alone replays its own records', async () => {
    const { kernel, reports, log } = setup();
    const errors = log('isolate:error');
    const crashes = log('isolate:crash');
    const ready = log('isolate:ready');
    kernel.spawn({ id: 'F', src, grants: ALL, config: { mode: 'flaky' }, pool: 'p' });
    kernel.spawn({ id: 'G', src, grants: ALL, pool: 'p' });
    await vi.waitUntil(() => ready.length === 2);
    expect(kernel.debug.workers().pools).toEqual({ p: ['F', 'G'] });
    // oxlint-disable-next-line no-await-in-loop -- in order on purpose
    for (const value of [1, 2, 3]) await kernel.publish(count, { value });
    await vi.waitUntil(() => reports.some((r) => r.id === 'F' && r.values?.length === 3));
    expect(errors).toEqual([{ id: 'F', message: 'flaky handler' }]);
    expect(crashes).toEqual([]);
    expect(kernel.isolates().map((s) => [s.id, s.state])).toEqual([
      ['F', 'running'],
      ['G', 'running'],
    ]);

    // `restart` kills F, as a crash would; let one commit interval pass so
    // 1's commit reaches the bus first (ADR 0016, decision 1).
    await new Promise((r) => setTimeout(r, 200));
    reports.length = 0;
    await kernel.restart('F');
    // 1 was committed; 2 threw, so 2 and 3 come again (at least once), to F only.
    await vi.waitUntil(() => reports.some((r) => r.id === 'F' && r.values?.length === 2), {
      timeout: 3000,
    });
    expect(reports.find((r) => r.id === 'F' && r.values?.length === 2)?.values).toEqual([2, 3]);
    // G was never restarted, and F came back into the same pool worker.
    expect(ready.filter((e) => e.id === 'G')).toHaveLength(1);
    expect(kernel.debug.workers()).toEqual({ live: 1, pools: { p: ['G', 'F'] } });
  });
});
