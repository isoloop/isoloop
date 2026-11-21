// `kernel.stop(id)` and, without awaiting it, `kernel.spawn()` with the same
// id, on the real runtime and bus worker. The old instance takes a while to
// shut down, so its `bye` comes after the new one has started: the new one
// must keep its bus subscription, its pool member and its surface.
import { afterEach, describe, expect, it, vi } from 'vitest';
import list, { count, report } from '../__fixtures__/contracts';
import { createKernel, type IsolateManifest, type Kernel } from '../index';

const worker = (path: string): string =>
  `${new URL(path, import.meta.url).href}?worker_file&type=module`;
const src = new URL('../__fixtures__/respawned.ts', import.meta.url).href;
const ALL = { publish: ['*'], subscribe: ['*'] };
const SLOW_STOP_MS = 300;

type Report = { id: string; instance: string; values: unknown[] };

/** An own-worker headless `X` that takes `SLOW_STOP_MS` to shut down. */
const slow = (instance: string): IsolateManifest => ({
  id: 'X',
  src,
  grants: ALL,
  config: { instance, slowStopMs: SLOW_STOP_MS },
});

const until = (ok: () => unknown, timeout = 5000) => vi.waitUntil(ok, { timeout, interval: 10 });

const kernels: Kernel[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
  document.body.replaceChildren();
});

function setup() {
  const kernel = createKernel({
    contracts: { url: new URL('../__fixtures__/contracts.ts', import.meta.url).href, list },
    workers: {
      isolateBootstrap: worker('../../../runtime/src/bootstrap.ts'),
      bus: worker('../../../bus/src/worker.ts'),
    },
  });
  kernels.push(kernel);
  const reports: Report[] = [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fixture's shape
  kernel.subscribe(report, (r) => reports.push(r.value as unknown as Report), { from: 'earliest' });
  const seen = (instance: string): unknown[] | undefined => {
    for (let i = reports.length - 1; i >= 0; i--)
      if (reports[i]?.instance === instance) return reports[i]?.values;
    return undefined;
  };
  const state = (id: string) => kernel.isolates().find((s) => s.id === id)?.state;
  return { kernel, seen, state };
}

type Variant = {
  name: string;
  pool?: string;
  /** Another member that shares the pool's worker. */
  neighbour?: boolean;
  visual?: boolean;
};

const variants: Variant[] = [
  { name: 'own worker, headless' },
  { name: 'own worker, visual', visual: true },
  { name: 'pool, alone', pool: 'p' },
  { name: 'pool, with a neighbour', pool: 'p', neighbour: true },
  { name: 'visual pool, with a neighbour', pool: 'p', neighbour: true, visual: true },
];

describe('stop, then spawn the same id at once', () => {
  it.for(variants)(
    '$name: the new instance keeps its subscription',
    async ({ pool, neighbour, visual }) => {
      const { kernel, seen, state } = setup();
      const surface = visual ? document.createElement('section') : undefined;
      if (surface) document.body.append(surface);
      const shown = (instance: string) =>
        surface
          ?.querySelector('iso-surface')
          ?.shadowRoot?.querySelector(`.value[data-instance="${instance}"]`)?.textContent;
      const manifest = (instance: string): IsolateManifest => ({
        id: 'X',
        src,
        grants: ALL,
        config: { instance, slowStopMs: SLOW_STOP_MS },
        ...(pool === undefined ? {} : { pool }),
        ...(surface ? { surface } : {}),
      });
      if (neighbour && pool !== undefined)
        kernel.spawn({ id: 'N', src, grants: ALL, config: { instance: 'n' }, pool });
      await kernel.publish(count, { value: 1 });
      kernel.spawn(manifest('a'));
      await until(() => seen('a')?.length === 1);
      if (neighbour) await until(() => seen('n')?.length === 1);

      const stopped = kernel.stop('X');
      kernel.spawn(manifest('b'));
      await stopped; // the old instance said `bye` (or ran out of grace)
      await until(() => seen('b')?.length === 1);
      await kernel.publish(count, { value: 2 });
      await until(() => seen('b')?.length === 2);
      expect(seen('b')).toEqual([1, 2]);
      expect(state('X')).toBe('running');
      if (surface) await until(() => shown('b') === '2');
      if (neighbour) {
        await until(() => seen('n')?.length === 2);
        expect(state('N')).toBe('running');
      }
    },
  );

  it('stopped while its suspend is still shutting down: the new instance keeps its subscription', async () => {
    const { kernel, seen, state } = setup();
    await kernel.publish(count, { value: 1 });
    kernel.spawn({
      id: 'X',
      src,
      grants: ALL,
      config: { instance: 'a', slowStopMs: SLOW_STOP_MS },
      suspend: { whenIdle: { afterMs: 200 } },
    });
    await until(() => seen('a')?.length === 1);
    // At the moment it suspends, its worker is still running its shutdown handlers.
    let stopped: Promise<void> | undefined;
    const off = kernel.on('isolate:state', (e) => {
      if (e.id !== 'X' || e.state !== 'suspended' || stopped) return;
      stopped = kernel.stop('X');
      kernel.spawn({ id: 'X', src, grants: ALL, config: { instance: 'b' } });
    });
    await until(() => stopped !== undefined, 4000);
    off();
    await stopped;
    await until(() => seen('b')?.length === 1);
    await kernel.publish(count, { value: 2 });
    await until(() => seen('b')?.length === 2);
    expect(seen('b')).toEqual([1, 2]);
    expect(state('X')).toBe('running');
  });

  it('a second stop and spawn while the first old instance still shuts down', async () => {
    const { kernel, seen, state } = setup();
    await kernel.publish(count, { value: 1 });
    kernel.spawn(slow('a'));
    await until(() => seen('a')?.length === 1);
    const first = kernel.stop('X');
    kernel.spawn(slow('b'));
    const second = kernel.stop('X');
    kernel.spawn(slow('c'));
    await Promise.all([first, second]);
    await until(() => seen('c')?.length === 1);
    await kernel.publish(count, { value: 2 });
    await until(() => seen('c')?.length === 2);
    expect(seen('c')).toEqual([1, 2]);
    expect(seen('b')).toBeUndefined(); // stopped before it started
    expect(state('X')).toBe('running');
  });
});
