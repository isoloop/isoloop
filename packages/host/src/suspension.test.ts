// Opt-in suspension (plan m2-bus task 12b, ADR 0001), on the real runtime and
// bus worker.
import { afterEach, describe, expect, it, vi } from 'vitest';
import list, { count, notes, report, small } from './__fixtures__/contracts';
import { createKernel, type Kernel, type KernelConfig, type KernelEvents } from './index';

const worker = (path: string): string =>
  `${new URL(path, import.meta.url).href}?worker_file&type=module`;
const src = new URL('./__fixtures__/sleepy.ts', import.meta.url).href;
const ALL = { publish: ['*'], subscribe: ['*'] };
const IDLE = { whenIdle: { afterMs: 300 } } as const;

type Report = {
  id: string;
  instance: string;
  values: unknown[];
  keys: string[];
  gaps: { from: number; to: number }[];
};

const until = <T>(fn: () => T, timeout = 4000) => vi.waitUntil(fn, { timeout, interval: 20 });
const groupConfig = (id: string) => ({ topic: 'count.v1', group: 'g', id });

const kernels: Kernel[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
  document.body.replaceChildren();
});

function setup(extra: Partial<KernelConfig> = {}) {
  const kernel = createKernel({
    contracts: { url: new URL('./__fixtures__/contracts.ts', import.meta.url).href, list },
    workers: {
      isolateBootstrap: worker('../../runtime/src/bootstrap.ts'),
      bus: worker('../../bus/src/worker.ts'),
    },
    ...extra,
  });
  kernels.push(kernel);
  const reports: Report[] = [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fixture's shape
  kernel.subscribe(report, (r) => reports.push(r.value as unknown as Report), { from: 'earliest' });
  const latest = (id: string): Report | undefined => {
    for (let i = reports.length - 1; i >= 0; i--) if (reports[i]?.id === id) return reports[i];
    return undefined;
  };
  const states: KernelEvents['isolate:state'][] = [];
  kernel.on('isolate:state', (e) => states.push(e));
  const state = (id: string) => kernel.isolates().find((s) => s.id === id)?.state;
  return { kernel, reports, latest, states, state };
}

/** A surface inside a container that can be hidden with `display: none`. */
function hiddenSurface(): { el: HTMLElement; show(): void } {
  const box = document.createElement('div');
  box.style.display = 'none';
  const el = document.createElement('section');
  el.style.height = '20px';
  box.append(el);
  document.body.append(box);
  return {
    el,
    show: () => {
      box.style.display = 'block';
    },
  };
}

describe('suspension', () => {
  it("a 'when-idle' headless isolate suspends, wakes on a record, and replays what it missed in order (I13)", async () => {
    const { kernel, latest, state } = setup();
    kernel.spawn({ id: 'H', src, grants: ALL, suspend: IDLE, config: { topic: 'count.v1' } });
    await until(() => state('H') === 'running');
    const first = await until(() => latest('H'));
    await until(() => state('H') === 'suspended');
    for (const value of [1, 2, 3]) void kernel.publish(count, { value });
    await until(() => latest('H')?.values.length === 3);
    expect(latest('H')?.values).toEqual([1, 2, 3]);
    expect(latest('H')?.instance).not.toBe(first.instance);
    expect(kernel.isolates().find((s) => s.id === 'H')?.restarts).toBe(0);
  });

  it('a held keepAwake prevents suspension; releasing it allows it', async () => {
    const { kernel, state } = setup();
    kernel.spawn({
      id: 'K',
      src,
      grants: ALL,
      suspend: IDLE,
      config: { topic: 'count.v1', hold: true },
    });
    await until(() => state('K') === 'running');
    await new Promise((r) => setTimeout(r, 800));
    expect(state('K')).toBe('running');
    expect(kernel.isolates().find((s) => s.id === 'K')?.holds?.[0]?.stack).toBeTypeOf('string');
    await kernel.publish(notes, { value: 'release' });
    await until(() => state('K') === 'suspended');
  });

  it('a hidden visual isolate is not woken by records, but replays them when shown', async () => {
    const { kernel, latest, state } = setup();
    const s = hiddenSurface();
    kernel.spawn({
      id: 'V',
      src,
      surface: s.el,
      grants: ALL,
      suspend: IDLE,
      config: { topic: 'count.v1' },
    });
    await until(() => state('V') === 'suspended');
    await kernel.publish(count, { value: 7 });
    await kernel.publish(count, { value: 8 });
    await new Promise((r) => setTimeout(r, 400));
    expect(state('V')).toBe('suspended');
    s.show();
    await until(() => latest('V')?.values.length === 2);
    expect(latest('V')?.values).toEqual([7, 8]);
    await until(() => s.el.querySelector('iso-surface')?.shadowRoot?.textContent?.includes('7,8'));
  });

  it('a last-n: 3 topic with 5 publishes while suspended delivers a gap', async () => {
    const { kernel, latest, state } = setup();
    kernel.spawn({ id: 'G', src, grants: ALL, suspend: IDLE, config: { topic: 'small.v1' } });
    await until(() => state('G') === 'running');
    await until(() => latest('G'));
    await kernel.publish(small, { value: 0 });
    await until(() => latest('G')?.values.length === 1);
    await until(() => state('G') === 'suspended');
    for (const value of [1, 2, 3, 4, 5]) void kernel.publish(small, { value });
    await until(() => (latest('G')?.values.length ?? 0) >= 3 && latest('G')?.instance);
    await until(() => latest('G')?.gaps.length === 1);
    expect(latest('G')?.gaps).toEqual([{ from: 1, to: 2 }]);
    expect(latest('G')?.values).toEqual([3, 4, 5]);
  });

  it('10 suspended visual isolates shown together start at most 4 at a time', async () => {
    const { kernel, states, state } = setup();
    const box = document.createElement('div');
    box.style.display = 'none';
    document.body.append(box);
    const ids = Array.from({ length: 10 }, (_, i) => `V${i}`);
    for (const id of ids) {
      const el = document.createElement('section');
      el.style.height = '10px';
      box.append(el);
      kernel.spawn({
        id,
        src,
        surface: el,
        grants: ALL,
        suspend: IDLE,
        config: { topic: 'count.v1' },
      });
    }
    await until(() => ids.every((id) => state(id) === 'suspended'), 6000);
    states.length = 0;
    box.style.display = 'block';
    await until(() => ids.every((id) => state(id) === 'running'), 8000);
    let loading = 0;
    let peak = 0;
    for (const e of states) {
      if (e.state === 'loading') peak = Math.max(peak, ++loading);
      if (e.prev === 'loading') loading--;
    }
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(0);
    // Visible surfaces wake in on-screen order.
    const order = states.filter((e) => e.state === 'loading').map((e) => e.id);
    expect(order).toEqual(ids);
  });

  it("suspend: 'never' is never suspended, even hidden", async () => {
    const { kernel, state } = setup();
    const s = hiddenSurface();
    kernel.spawn({
      id: 'N',
      src,
      surface: s.el,
      grants: ALL,
      suspend: 'never',
      config: { topic: 'count.v1' },
    });
    await until(() => state('N') === 'running');
    await new Promise((r) => setTimeout(r, 800));
    expect(state('N')).toBe('running');
  });

  it('a suspended group member leaves its group and rejoins on resume', async () => {
    const { kernel, latest, state } = setup();
    kernel.spawn({ id: 'X', src, grants: ALL, suspend: IDLE, config: groupConfig('X') });
    kernel.spawn({ id: 'Y', src, grants: ALL, config: groupConfig('Y') });
    await until(() => state('X') === 'running' && state('Y') === 'running');
    await until(() => latest('X') && latest('Y'));
    await until(() => state('X') === 'suspended');
    const keys = Array.from({ length: 20 }, (_, i) => `k${i}`);
    for (const key of keys) void kernel.publish(count, { key, value: 1 });
    // Y took the whole stream, and X wasn't woken: Y is still in the group.
    await until(() => latest('Y')?.keys.length === 20);
    expect(state('X')).toBe('suspended');
    await kernel.resume('X');
    await until(() => state('X') === 'running');
    await until(() => latest('X')?.instance !== undefined);
    for (const key of keys) void kernel.publish(count, { key, value: 2 });
    await until(() => (latest('X')?.keys.length ?? 0) + (latest('Y')?.keys.length ?? 0) === 40);
    expect(latest('X')?.keys.length).toBeGreaterThan(0);
  });
});
