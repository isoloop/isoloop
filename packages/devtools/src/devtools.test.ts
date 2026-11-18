// The devtools panel (M4b task 7): it mounts as a visual isolate in its own
// worker with the `inspect` grant, opens and closes from its button and the
// shortcut, restarts like any isolate, and keeps its settings across mounts.
import { createKernel, type Kernel } from '@isoloop/host';
import { afterEach, describe, expect, it, vi } from 'vitest';
import list from './__fixtures__/contracts';
import { mountDevtools, type Devtools, type DevtoolsOptions } from './index';

const worker = (path: string): string =>
  `${new URL(path, import.meta.url).href}?worker_file&type=module`;
const bootstrap = worker('../../runtime/src/bootstrap.ts');
const busWorker = worker('../../bus/src/worker.ts');
const src = new URL('./panel.tsx', import.meta.url).href;
const contractsUrl = new URL('./__fixtures__/contracts.ts', import.meta.url).href;

const kernels: Kernel[] = [];
const mounted: Devtools[] = [];

const deleteDb = () =>
  new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('isoloop-devtools');
    for (const type of ['success', 'error', 'blocked']) {
      req.addEventListener(type, () => {
        resolve();
      });
    }
  });

afterEach(async () => {
  await Promise.all(mounted.splice(0).map((d) => d.unmount()));
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
  await deleteDb();
});

function kernel(): Kernel {
  const k = createKernel({
    workers: { isolateBootstrap: bootstrap, bus: busWorker },
    contracts: { url: contractsUrl, list },
    supervisor: { maxRestarts: 5, backoff: { initialMs: 20 } },
    heartbeat: { everyMs: 50, blockedAfterMs: 400, killAfterMs: 1200 },
  });
  kernels.push(k);
  return k;
}

function mount(k: Kernel, o: DevtoolsOptions = {}): Devtools {
  const d = mountDevtools(k, { src, ...o });
  mounted.push(d);
  return d;
}

const waitFor = <T>(get: () => T | null | undefined | false, timeout = 8000): Promise<T> =>
  vi.waitFor(
    () => {
      const v = get();
      if (v === null || v === undefined || v === false) throw new Error('not yet');
      return v;
    },
    { timeout, interval: 20 },
  );

const shadow = (): ShadowRoot | null =>
  document.querySelector('[data-isoloop-devtools] iso-surface')?.shadowRoot ?? null;
const find = (sel: string): HTMLElement | null => {
  const el = shadow()?.querySelector(sel);
  return el instanceof HTMLElement ? el : null;
};
const fab = () => find('button[data-health]');
const panel = () => find('[data-isoloop-devtools-panel]');

describe('@isoloop/devtools (M4b task 7)', () => {
  it('mounts its button in the corner and opens a panel that lists itself', async () => {
    const k = kernel();
    mount(k, { position: 'top-left' });
    const button = await waitFor(fab);
    expect(button.style.top).toBe('12px');
    expect(button.style.left).toBe('12px');
    expect(k.isolates().find((i) => i.id === 'isoloop-devtools')?.pool).toBeUndefined();

    button.click();
    await waitFor(panel);
    const row = await waitFor(() => find('[data-isolate="isoloop-devtools"]'));
    expect(row.textContent).toContain('isoloop-devtools');

    find('[data-isoloop-devtools-panel] [data-isoloop-devtools-toggle]')?.click();
    await waitFor(fab);
    expect(panel()).toBeNull();
  });

  it('the surface covers the viewport without taking pointer events', async () => {
    const k = kernel();
    mount(k);
    await waitFor(fab);
    const surface = document.querySelector<HTMLElement>('[data-isoloop-devtools]');
    expect(surface?.style.position).toBe('fixed');
    expect(surface?.style.pointerEvents).toBe('none');
    expect(fab()?.style.pointerEvents).toBe('auto');
  });

  it('Alt+Shift+D and toggle() open and close it', async () => {
    const k = kernel();
    const d = mount(k);
    await waitFor(fab);
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyD', key: 'D', altKey: true, shiftKey: true }),
    );
    await waitFor(panel);
    d.toggle();
    await waitFor(fab);
  });

  it('shows an amber dot while an isolate is unwell, red once one has failed', async () => {
    const k = kernel();
    mount(k);
    await waitFor(fab);
    k.spawn({
      id: 'thrower',
      src: new URL('./__fixtures__/throws.ts', import.meta.url).href,
      grants: { publish: [], subscribe: [] },
    });
    await waitFor(() => find('[data-dot="failed"]'), 15_000);
  });

  it('restarts after a crash, like any isolate', async () => {
    const k = kernel();
    mount(k);
    await waitFor(fab);
    const states: string[] = [];
    k.on('isolate:state', (e) => {
      if (e.id === 'isoloop-devtools') states.push(e.state);
    });
    const inspector = k.inspect();
    await inspector.kill('isoloop-devtools');
    await waitFor(() => states.includes('restarting'));
    await waitFor(() => states.at(-1) === 'running');
    await waitFor(fab);
    inspector.close();
  });

  it('resizes from its inner corner and keeps open state, size and corner across mounts', async () => {
    const k = kernel();
    const d = mount(k);
    (await waitFor(fab)).click();
    const p = await waitFor(panel);
    expect(p.style.width).toBe('420px');

    const handle = await waitFor(() => find('[data-isoloop-devtools-resize]'));
    handle.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        composed: true,
        clientX: 500,
        clientY: 500,
      }),
    );
    const layer = await waitFor(() => find('[data-isoloop-devtools-drag]'));
    layer.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, composed: true, clientX: 400, clientY: 450 }),
    );
    await waitFor(() => panel()?.style.width === '520px');
    expect(panel()?.style.height).toBe('370px');

    find('[data-isoloop-devtools-move]')?.click();
    await waitFor(() => panel()?.style.left === '12px');

    // Give the write a moment, then mount afresh.
    await new Promise((r) => setTimeout(r, 200));
    await d.unmount();
    mounted.splice(mounted.indexOf(d), 1);
    mount(k);
    const again = await waitFor(panel);
    expect(again.style.width).toBe('520px');
    expect(again.style.bottom).toBe('12px');
    expect(again.style.left).toBe('12px');
  });

  it('unmount stops the isolate and removes the surface', async () => {
    const k = kernel();
    const d = mount(k);
    await waitFor(fab);
    await d.unmount();
    mounted.splice(mounted.indexOf(d), 1);
    expect(document.querySelector('[data-isoloop-devtools]')).toBeNull();
    expect(k.isolates().map((i) => i.id)).not.toContain('isoloop-devtools');
  });
});
