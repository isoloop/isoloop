// Visual pools (M2d task 4, ADR 0015) on the real runtime, bus worker and
// compositor: visual isolates join pools, alone or with headless members;
// each renders into its own surface; a hang in any member restarts its whole
// pool, which redraws, while other pools and own workers keep drawing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import list, { count, report } from './__fixtures__/contracts';
import { createKernel, type Kernel, type KernelEvents } from './index';

const worker = (path: string): string =>
  `${new URL(path, import.meta.url).href}?worker_file&type=module`;
const widget = new URL('./__fixtures__/pool-widget.ts', import.meta.url).href;
const feed = new URL('./__fixtures__/pool-feed.ts', import.meta.url).href;
const reach = new URL('./__fixtures__/pool-reach.ts', import.meta.url).href;

const kernels: Kernel[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
  document.body.replaceChildren();
});

const ALL = { publish: ['*'], subscribe: ['*'] };

function setup() {
  const kernel = createKernel({
    contracts: { url: new URL('./__fixtures__/contracts.ts', import.meta.url).href, list },
    workers: {
      isolateBootstrap: worker('../../runtime/src/bootstrap.ts'),
      bus: worker('../../bus/src/worker.ts'),
    },
    heartbeat: { everyMs: 50, blockedAfterMs: 200, killAfterMs: 600 },
    supervisor: { backoff: { initialMs: 50, maxMs: 50 } },
  });
  kernels.push(kernel);
  const log = <E extends keyof KernelEvents>(e: E): KernelEvents[E][] => {
    const got: KernelEvents[E][] = [];
    kernel.on(e, (x) => got.push(x));
    return got;
  };
  const surfaces = new Map<string, HTMLElement>();
  const spawn = (id: string, o: { pool?: string; config?: unknown } = {}): void => {
    const surface = document.createElement('section');
    document.body.append(surface);
    surfaces.set(id, surface);
    kernel.spawn({ id, src: widget, surface, grants: ALL, ...o });
  };
  const shadow = (id: string) => surfaces.get(id)?.querySelector('iso-surface')?.shadowRoot;
  const value = (id: string) => shadow(id)?.querySelector('.v')?.textContent;
  const button = (id: string) => shadow(id)?.querySelector('button') ?? null;
  return { kernel, log, spawn, value, button };
}

const until = (ok: () => boolean, timeout = 5000) => vi.waitUntil(ok, { timeout, interval: 10 });

describe('visual pools (M2d)', () => {
  it('pool members render into their own surfaces, next to an own worker', async () => {
    const { kernel, spawn, value, button } = setup();
    spawn('W1', { pool: 'p' });
    spawn('W2', { pool: 'p' });
    spawn('W3');
    await until(() => ['W1', 'W2', 'W3'].every((id) => value(id) === '-'));
    expect(kernel.debug.workers()).toEqual({ live: 2, pools: { p: ['W1', 'W2'] } });
    await kernel.publish(count, { value: 7 });
    await until(() => ['W1', 'W2', 'W3'].every((id) => value(id) === '7'));
    // Clicks reach only their own member.
    button('W1')?.click();
    button('W1')?.click();
    button('W2')?.click();
    await until(() => button('W1')?.textContent === '2' && button('W2')?.textContent === '1');
    expect(button('W3')?.textContent).toBe('0');
  });

  it('a hanging widget restarts its pool’s surfaces; another pool keeps drawing', async () => {
    const { kernel, log, spawn, value, button } = setup();
    const crashes = log('isolate:crash');
    const ready = log('isolate:ready');
    spawn('W1', { pool: 'p', config: { spin: true } });
    spawn('W2', { pool: 'p' });
    spawn('W3', { pool: 'q' });
    await until(() => ['W1', 'W2', 'W3'].every((id) => value(id) === '-'));
    await kernel.publish(count, { value: 1 });
    await until(() => crashes.some((c) => c.id === 'W2'));
    expect(crashes.find((c) => c.id === 'W2')).toMatchObject({ reason: 'unresponsive', pool: 'p' });
    // The other pool kept drawing and handling clicks.
    await kernel.publish(count, { value: 2 });
    await until(() => value('W3') === '2');
    button('W3')?.click();
    await until(() => button('W3')?.textContent === '1');
    expect(crashes.some((c) => c.id === 'W3')).toBe(false);
    // W2 comes back in the pool's new worker and redraws the latest value.
    await until(() => ready.filter((e) => e.id === 'W2').length >= 2);
    await until(() => value('W2') === '2');
  });

  it('a mixed pool restarts as a whole when either kind hangs; the feed reads on from its commits', async () => {
    for (const spinner of ['feed', 'widget'] as const) {
      const { kernel, log, spawn, value } = setup();
      const crashes = log('isolate:crash');
      const ready = log('isolate:ready');
      const reports: { id: string; values?: unknown[] }[] = [];
      kernel.subscribe(report, (r) => reports.push(r.value), { from: 'earliest' });
      kernel.spawn({
        id: 'F',
        src: feed,
        grants: ALL,
        pool: 'm',
        ...(spinner === 'feed' ? { config: { spin: true } } : {}),
      });
      spawn('W1', { pool: 'm', ...(spinner === 'widget' ? { config: { spin: true } } : {}) });
      spawn('W2', { pool: 'm' });
      // oxlint-disable-next-line no-await-in-loop -- one scenario at a time
      await until(() => ready.length >= 3);
      // oxlint-disable-next-line no-await-in-loop
      await kernel.publish(count, { value: 1 });
      // oxlint-disable-next-line no-await-in-loop
      await until(() => ['F', 'W1', 'W2'].every((id) => crashes.some((c) => c.id === id)));
      for (const id of ['F', 'W1', 'W2'])
        expect(
          crashes.find((c) => c.id === id),
          `${spinner}: ${id}`,
        ).toMatchObject({ pool: 'm' });
      // After the restart: a new record reaches the feed (from its committed
      // offset, so 1 comes again if it hadn't been committed) and the widget.
      // oxlint-disable-next-line no-await-in-loop
      await until(() => ready.filter((e) => e.id === 'W2').length >= 2);
      // oxlint-disable-next-line no-await-in-loop
      await kernel.publish(count, { value: 2 });
      // oxlint-disable-next-line no-await-in-loop
      await until(() => value('W2') === '2');
      if (spinner === 'widget') {
        // oxlint-disable-next-line no-await-in-loop
        await until(() => reports.some((r) => r.id === 'F' && r.values?.includes(2)));
        const fromF = reports.filter((r) => r.id === 'F').map((r) => r.values?.at(-1));
        expect(fromF.at(-1)).toBe(2);
      }
      // oxlint-disable-next-line no-await-in-loop
      await kernel.destroy();
      document.body.replaceChildren();
    }
  });

  describe('host calls and events per member (M2d task 5)', () => {
    it("a member can't reach another member's node, through ctx.host or a forged call", async () => {
      const { kernel } = setup();
      const reports: Record<string, unknown>[] = [];
      kernel.subscribe(report, (r) => reports.push(r.value), { from: 'earliest' });
      for (const [id, role] of [
        ['T', 'target'],
        ['P', 'prober'],
      ] as const) {
        const surface = document.createElement('section');
        document.body.append(surface);
        kernel.spawn({ id, src: reach, surface, grants: ALL, pool: 'p', config: { role } });
      }
      await until(() => reports.some((r) => r['id'] === 'P'));
      expect(reports.find((r) => r['id'] === 'P')).toEqual({
        id: 'P',
        // The shared document lets it find the node (ADR 0015, decision 6)...
        found: true,
        // ...but the host answers only about its own.
        ownMeasure: 'ok',
        otherMeasure: 'not_found',
        otherFocus: 'not_found',
        forged: 'not_found',
      });
    });
  });
});
