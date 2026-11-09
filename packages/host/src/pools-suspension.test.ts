// Pool suspension (M2c task 6, ADR 0001), on the real runtime and bus worker:
// a pool suspends only as a whole, and any member's wake condition wakes it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import list, { count, report } from './__fixtures__/contracts';
import { createKernel, type Kernel } from './index';

const worker = (path: string): string =>
  `${new URL(path, import.meta.url).href}?worker_file&type=module`;
const src = new URL('./__fixtures__/sleepy.ts', import.meta.url).href;
const ALL = { publish: ['*'], subscribe: ['*'] };
const IDLE = { whenIdle: { afterMs: 300 } } as const;

type Report = { id: string; instance: string; values: unknown[] };

const until = <T>(fn: () => T, timeout = 4000) => vi.waitUntil(fn, { timeout, interval: 20 });

const kernels: Kernel[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
});

function setup() {
  const kernel = createKernel({
    contracts: { url: new URL('./__fixtures__/contracts.ts', import.meta.url).href, list },
    workers: {
      isolateBootstrap: worker('../../runtime/src/bootstrap.ts'),
      bus: worker('../../bus/src/worker.ts'),
    },
  });
  kernels.push(kernel);
  const reports: Report[] = [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fixture's shape
  kernel.subscribe(report, (r) => reports.push(r.value as unknown as Report), { from: 'earliest' });
  const latest = (id: string): Report | undefined => {
    for (let i = reports.length - 1; i >= 0; i--) if (reports[i]?.id === id) return reports[i];
    return undefined;
  };
  const state = (id: string) => kernel.isolates().find((s) => s.id === id)?.state;
  return { kernel, latest, state };
}

describe('pool suspension (M2c)', () => {
  it('an idle pool suspends as a whole, and a record for one member wakes them all', async () => {
    const { kernel, latest, state } = setup();
    kernel.spawn({
      id: 'A',
      src,
      grants: ALL,
      suspend: IDLE,
      pool: 'p',
      config: { topic: 'count.v1' },
    });
    kernel.spawn({
      id: 'B',
      src,
      grants: ALL,
      suspend: IDLE,
      pool: 'p',
      config: { topic: 'small.v1' },
    });
    await until(() => state('A') === 'running' && state('B') === 'running');
    const firstB = await until(() => latest('B'));
    await until(() => state('A') === 'suspended' && state('B') === 'suspended');
    expect(kernel.debug.workers()).toEqual({ live: 0, pools: {} });
    // A record for A only: A wakes and replays it, and B wakes with it.
    void kernel.publish(count, { value: 7 });
    await until(() => latest('A')?.values.length === 1);
    expect(latest('A')?.values).toEqual([7]);
    await until(() => latest('B')?.instance !== firstB.instance);
    expect(state('B')).toBe('running');
    const members = [...(kernel.debug.workers().pools['p'] ?? [])];
    members.sort();
    expect(members).toEqual(['A', 'B']);
  });

  it('a pool with a member that never suspends never suspends, and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { kernel, state } = setup();
    kernel.spawn({
      id: 'A',
      src,
      grants: ALL,
      suspend: IDLE,
      pool: 'p',
      config: { topic: 'count.v1' },
    });
    kernel.spawn({ id: 'N', src, grants: ALL, pool: 'p', config: { topic: 'small.v1' } });
    kernel.spawn({
      id: 'C',
      src,
      grants: ALL,
      suspend: IDLE,
      pool: 'p',
      config: { topic: 'count.v1' },
    });
    await until(() => state('A') === 'running' && state('N') === 'running');
    await new Promise((r) => setTimeout(r, 1200));
    expect([state('A'), state('N'), state('C')]).toEqual(['running', 'running', 'running']);
    const calls = warn.mock.calls.filter((c) => String(c[0]).includes('pool "p"'));
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toContain('"N" never suspends');
  });
});
