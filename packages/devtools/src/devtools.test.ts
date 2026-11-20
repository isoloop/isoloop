// The devtools panel (M4b task 7): it mounts as a visual isolate in its own
// worker with the `inspect` grant, opens and closes from its button and the
// shortcut, restarts like any isolate, and keeps its settings across mounts.
import { createKernel, type Kernel } from '@isoloop/host';
import { afterEach, describe, expect, it, vi } from 'vitest';
import list from './__fixtures__/contracts';
import { connectDevtools, type DevtoolsOptions } from './index';
import { stepPosition } from './panel';

const worker = (path: string): string =>
  `${new URL(path, import.meta.url).href}?worker_file&type=module`;
const bootstrap = worker('../../runtime/src/bootstrap.ts');
const busWorker = worker('../../bus/src/worker.ts');
const src = new URL('./panel.tsx', import.meta.url).href;
const contractsUrl = new URL('./__fixtures__/contracts.ts', import.meta.url).href;

const kernels: Kernel[] = [];
const mounted: (() => Promise<void>)[] = [];

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
  await Promise.all(mounted.splice(0).map((d) => d()));
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

function mount(k: Kernel, o: DevtoolsOptions = {}): () => Promise<void> {
  const d = connectDevtools(k, { src, ...o });
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
const shortcut = () =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'KeyD', key: 'D', altKey: true, shiftKey: true }),
  );
const fab = () => find('button[data-health]');
const panel = () => find('[data-isoloop-devtools-panel]');

const hover = (el: HTMLElement) =>
  el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));

describe('stepPosition', () => {
  it('moves one corner across or up and down, never diagonally', () => {
    expect(stepPosition('bottom-left', 'horizontal')).toBe('bottom-right');
    expect(stepPosition('bottom-left', 'vertical')).toBe('top-left');
    expect(stepPosition('top-right', 'horizontal')).toBe('top-left');
    expect(stepPosition('top-right', 'vertical')).toBe('bottom-right');
  });
});

describe('@isoloop/devtools (M4b task 7)', () => {
  it('mounts its button in the corner and opens a panel that lists itself', async () => {
    const k = kernel();
    mount(k, { position: 'top-left' });
    const button = await waitFor(fab);
    const box = button.parentElement;
    expect(box?.style.top).toBe('12px');
    expect(box?.style.left).toBe('12px');
    expect([box?.style.width, box?.style.height]).toEqual(['70px', '70px']);
    expect(k.isolates().find((i) => i.id === 'isoloop-devtools')?.pool).toBeUndefined();

    button.click();
    await waitFor(panel);
    const row = await waitFor(() => find('[data-isolate="isoloop-devtools"]'));
    expect(row.textContent).toContain('isoloop-devtools');
    // Every column has a header, the row buttons' too, and the headers stay in view.
    const heads = [...(shadow()?.querySelectorAll('[data-view="isolates"] th') ?? [])].map(
      (h) => h.textContent,
    );
    expect(heads).toContain('Actions');
    expect(heads.every((h) => h !== '')).toBe(true);
    expect(shadow()?.querySelector('.dt-scroll')).not.toBeNull();
    // The inner edges resize too, not only the corner.
    expect(find('[data-isoloop-devtools-resize-x]')).not.toBeNull();
    expect(find('[data-isoloop-devtools-resize-y]')).not.toBeNull();

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
    expect(fab()?.parentElement?.style.pointerEvents).toBe('auto');
  });

  it('Alt+Shift+D opens and closes it', async () => {
    const k = kernel();
    mount(k);
    await waitFor(fab);
    shortcut();
    await waitFor(panel);
    shortcut();
    await waitFor(fab);
    expect(panel()).toBeNull();
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
    await waitFor(() => find('button[data-health="failed"]'), 15_000);
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

  it('resizes from its inner corner and keeps open state and size across mounts', async () => {
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

    // Give the write a moment, then mount afresh.
    await new Promise((r) => setTimeout(r, 200));
    await d();
    mounted.splice(mounted.indexOf(d), 1);
    mount(k);
    const again = await waitFor(panel);
    expect(again.style.width).toBe('520px');
    // The open panel docks flush, so it can be dragged to the very edge.
    expect(again.style.bottom).toBe('0px');
    expect(again.style.right).toBe('0px');
  });

  it('moves the button one corner at a time with the arrows shown on hover, and keeps the corner', async () => {
    const k = kernel();
    const d = mount(k);
    const button = await waitFor(fab);
    expect(find('[data-isoloop-devtools-move]')).toBeNull();

    hover(button);
    await waitFor(() => find('[data-isoloop-devtools-move]'));
    expect(shadow()?.querySelectorAll('[data-isoloop-devtools-move]').length).toBe(2);
    find('[data-isoloop-devtools-move="horizontal"]')?.click();
    await waitFor(() => fab()?.parentElement?.style.left === '12px');
    expect(fab()?.parentElement?.style.bottom).toBe('12px');

    hover(await waitFor(fab));
    await waitFor(() => find('[data-isoloop-devtools-move="vertical"]'));
    find('[data-isoloop-devtools-move="vertical"]')?.click();
    await waitFor(() => fab()?.parentElement?.style.top === '12px');
    expect(fab()?.parentElement?.style.left).toBe('12px');

    // A move away from the button ends the hover.
    const away = await waitFor(() => find('[data-isoloop-devtools-fab-away]'));
    away.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));
    await waitFor(() => find('[data-isoloop-devtools-move]') === null);

    await new Promise((r) => setTimeout(r, 200));
    await d();
    mounted.splice(mounted.indexOf(d), 1);
    mount(k);
    expect((await waitFor(fab)).parentElement?.style.top).toBe('12px');
  });

  it('has a second level of tabs: pools under Isolates, topics, subscriptions and rejected under Bus', async () => {
    const k = kernel();
    mount(k);
    (await waitFor(fab)).click();
    await waitFor(panel);

    // The kernel has no pools here, so Isolates has nothing to split.
    await waitFor(() => find('[data-isolate="isoloop-devtools"]'));
    expect(find('[data-subtab]')).toBeNull();

    find('[data-tab="bus"]')?.click();
    const topics = await waitFor(() => find('[data-subtab="topics"]'));
    expect(topics.getAttribute('aria-selected')).toBe('true');
    expect(shadow()?.querySelectorAll('[data-subtab]').length).toBe(3);
    await waitFor(() => find('[data-view="topics"]'));

    // Only the selected part is shown (this kernel has no subscriptions to list).
    find('[data-subtab="subscriptions"]')?.click();
    await waitFor(
      () => find('[data-subtab="subscriptions"]')?.getAttribute('aria-selected') === 'true',
    );
    await waitFor(() => find('[data-view="topics"]') === null);
    expect(shadow()?.textContent).toContain('No subscriptions');

    // The choice is kept while the panel is open, even across the other tabs.
    find('[data-tab="messages"]')?.click();
    await waitFor(() => find('[data-view="messages"]'));
    // The log's toolbar sits outside the part that scrolls.
    expect(find('.dt-log-rows')?.contains(find('.dt-log-bar'))).toBe(false);
    expect(find('[data-subtab]')).toBeNull();
    find('[data-tab="bus"]')?.click();
    await waitFor(
      () => find('[data-subtab="subscriptions"]')?.getAttribute('aria-selected') === 'true',
    );

    // Arrow keys move between them, as for the main tabs.
    find('[role="tablist"][aria-label="Bus views"]')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }),
    );
    await waitFor(() => find('[data-subtab="rejected"]')?.getAttribute('aria-selected') === 'true');
  });

  it('resizes one way from the inner edges', async () => {
    const k = kernel();
    mount(k);
    (await waitFor(fab)).click();
    expect((await waitFor(panel)).style.width).toBe('420px');

    const drag = async (edge: string, from: [number, number], to: [number, number]) => {
      const handle = await waitFor(() => find(`[data-isoloop-devtools-resize-${edge}]`));
      handle.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          composed: true,
          clientX: from[0],
          clientY: from[1],
        }),
      );
      const layer = await waitFor(() => find('[data-isoloop-devtools-drag]'));
      layer.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          composed: true,
          clientX: to[0],
          clientY: to[1],
        }),
      );
      await waitFor(() => find('[data-isoloop-devtools-drag]') === null);
    };

    // Docked bottom right: dragging the left edge to the left widens, height stays.
    await drag('x', [500, 500], [400, 450]);
    await waitFor(() => panel()?.style.width === '520px');
    expect(panel()?.style.height).toBe('320px');
    // The top edge, up, makes it taller, width stays.
    await drag('y', [500, 500], [450, 450]);
    await waitFor(() => panel()?.style.height === '370px');
    expect(panel()?.style.width).toBe('520px');
  });

  it('copies the text a panel button carries, from the page', async () => {
    const k = kernel();
    mount(k);
    await waitFor(fab);
    const write = vi.fn(() => Promise.resolve());
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(write);
    const button = document.createElement('button');
    button.setAttribute('data-isoloop-copy', '{"a": 1}');
    document.querySelector('[data-isoloop-devtools]')?.append(button);
    button.click();
    expect(write).toHaveBeenCalledWith('{"a": 1}');
    button.remove();
  });

  it('lists the kernel events, newest first, and opens one to its data', async () => {
    const k = kernel();
    mount(k);
    (await waitFor(fab)).click();
    await waitFor(panel);
    await waitFor(() => find('[data-tab="events"]'));
    find('[data-tab="events"]')?.click();
    const row = await waitFor(() =>
      shadow()?.querySelector('[data-event="isolate:state"][data-level]'),
    );
    expect(row?.textContent).toContain('isoloop-devtools');
    expect(find('[data-events-table]')).not.toBeNull();

    // The filter narrows the list; a miss says so.
    const filter = await waitFor(() => find('[data-events-filter]'));
    if (!(filter instanceof HTMLInputElement)) throw new Error('no filter');
    filter.value = 'no-such-isolate';
    filter.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await waitFor(() => shadow()?.textContent?.includes('No events match'));
    filter.value = '';
    filter.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await waitFor(() => find('[data-events-table]'));

    // A row opens into its data.
    shadow()?.querySelector<HTMLElement>('[data-event="isolate:state"] .dt-chev')?.click();
    const detail = await waitFor(() => find('[data-event-detail]'));
    expect(detail.textContent).toContain('"state"');
  });

  it('stretches across the width or fills the window, and restores', async () => {
    const k = kernel();
    mount(k);
    (await waitFor(fab)).click();
    expect((await waitFor(panel)).style.width).toBe('420px');

    find('[data-isoloop-devtools-stretch]')?.click();
    await waitFor(() => panel()?.style.width === 'auto');
    // Pinned to both side edges, not `100vw`, which counts the page's scrollbar.
    expect([panel()?.style.left, panel()?.style.right]).toEqual(['0px', '0px']);
    expect(panel()?.style.height).toBe('320px');

    // Stretched, the top edge still sets the height; the side edge and the corner are gone.
    expect(find('[data-isoloop-devtools-resize-x]')).toBeNull();
    expect(find('[data-isoloop-devtools-resize]')).toBeNull();
    const top = await waitFor(() => find('[data-isoloop-devtools-resize-y]'));
    top.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        composed: true,
        clientX: 500,
        clientY: 500,
      }),
    );
    const layer = await waitFor(() => find('[data-isoloop-devtools-drag]'));
    layer.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, composed: true, clientX: 500, clientY: 450 }),
    );
    await waitFor(() => panel()?.style.height === '370px');
    expect(panel()?.style.width).toBe('auto');

    find('[data-isoloop-devtools-maximize]')?.click();
    await waitFor(() => panel()?.style.height === 'auto');
    expect([panel()?.style.top, panel()?.style.bottom]).toEqual(['0px', '0px']);
    expect(panel()?.style.width).toBe('auto');

    find('[data-isoloop-devtools-maximize]')?.click();
    // Back to normal: the width it had, and the height set while stretched.
    await waitFor(() => panel()?.style.width === '420px');
    expect(panel()?.style.height).toBe('370px');
  });

  it('disconnecting stops the isolate and removes the surface', async () => {
    const k = kernel();
    const d = mount(k);
    await waitFor(fab);
    await d();
    mounted.splice(mounted.indexOf(d), 1);
    expect(document.querySelector('[data-isoloop-devtools]')).toBeNull();
    expect(k.isolates().map((i) => i.id)).not.toContain('isoloop-devtools');
  });
});
