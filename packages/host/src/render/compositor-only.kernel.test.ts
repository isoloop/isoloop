import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernel, type Kernel } from '../index';

// I1 (design §8): only the compositor writes to the DOM under a surface. The
// compositor reports when it starts and stops writing (kernel.debug.onSurfaceWrite);
// a MutationObserver on every surface sorts each mutation into inside or
// outside those sections. MutationObserver delivers asynchronously, so the
// records are taken synchronously at both ends of each section: what's
// pending at `start` happened outside, what's pending at `end` inside, and
// anything the callback still receives happened outside.

const worker = (path: string): string =>
  `${new URL(path, import.meta.url).href}?worker_file&type=module`;
const bootstrap = worker('../../../runtime/src/bootstrap.ts');
const fixture = (name: string): string =>
  new URL(`../__fixtures__/${name}.ts`, import.meta.url).href;

const kernels: Kernel[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
  document.body.replaceChildren();
});

const waitFor = (ok: () => boolean, timeout = 6000) =>
  vi.waitFor(
    () => {
      if (!ok()) throw new Error('not yet');
    },
    { timeout, interval: 10 },
  );

const describeRecord = (r: MutationRecord): string => {
  const target = r.target instanceof Element ? r.target.localName : r.target.nodeName;
  return `${r.type} on ${target}${r.attributeName ? ` [${r.attributeName}]` : ''}`;
};

describe('I1: only the compositor writes under a surface', () => {
  it('renders, events, host calls, styles, busy, crash, restart, failure and retry all write inside compositor sections', async () => {
    const kernel = createKernel({
      workers: { isolateBootstrap: bootstrap },
      heartbeat: { blockedAfterMs: 150, killAfterMs: 500 },
      supervisor: { maxRestarts: 1, backoff: { initialMs: 50 } },
    });
    kernels.push(kernel);

    const outside: string[] = [];
    let inside = 0;
    const observer = new MutationObserver((records) => {
      for (const r of records) outside.push(describeRecord(r));
    });
    kernel.debug.onSurfaceWrite((phase) => {
      const records = observer.takeRecords();
      if (phase === 'start') outside.push(...records.map(describeRecord));
      else inside += records.length;
    });

    const shadows = new Map<string, ShadowRoot>();
    const spawn = (id: string, name: string): void => {
      const target = document.createElement('section');
      document.body.append(target);
      kernel.spawn({ id, src: fixture(name), surface: target });
      const shadow = target.querySelector('iso-surface')?.shadowRoot;
      if (!shadow) throw new Error(`no surface for ${id}`);
      observer.observe(shadow, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      shadows.set(id, shadow);
    };
    const $ = (id: string, sel: string) => shadows.get(id)?.querySelector(sel) ?? null;
    const state = (id: string) => kernel.isolates().find((s) => s.id === id)?.state;

    spawn('A', 'dom-counter');
    spawn('M', 'dom-measure');
    spawn('S', 'dom-styles');
    spawn('P', 'spin');
    spawn('T', 'throws');

    // Renders and events.
    await waitFor(() => $('A', '.n') !== null);
    const button = $('A', 'button');
    if (!(button instanceof HTMLButtonElement)) throw new Error('no button');
    button.click();
    button.click();
    await waitFor(() => $('A', '.n')?.textContent === '2');
    const input = $('A', 'input');
    if (!(input instanceof HTMLInputElement)) throw new Error('no input');
    input.value = 'hi';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await waitFor(() => $('A', '.echo')?.textContent === 'hi');

    // Host calls (measure, focus) after a resize patch.
    await waitFor(() => $('M', '.grow') !== null);
    const grow = $('M', '.grow');
    if (!(grow instanceof HTMLButtonElement)) throw new Error('no grow');
    grow.click();
    await waitFor(() => ($('M', '.out')?.textContent ?? '') !== '');

    // Styles.
    await waitFor(() => $('S', '.tok') !== null);

    // A spinning isolate: busy overlay, kill, restart, then failed with the fallback.
    await waitFor(() => $('P', '.iso-busy:not([hidden])') !== null);
    await waitFor(() => state('P') === 'failed', 10_000);
    await waitFor(() => $('P', '.iso-fallback:not([hidden]) button') !== null);

    // An isolate that throws at start fails too; Retry respawns it.
    await waitFor(() => state('T') === 'failed', 10_000);
    const retry = $('T', '.iso-fallback button');
    if (!(retry instanceof HTMLButtonElement)) throw new Error('no retry');
    retry.click();
    await waitFor(() => $('T', '.iso-fallback[hidden]') !== null || state('T') !== 'failed');

    // Let any last records arrive.
    await new Promise((r) => setTimeout(r, 50));
    outside.push(...observer.takeRecords().map(describeRecord));
    observer.disconnect();

    expect(outside).toEqual([]);
    expect(inside).toBeGreaterThan(20);
  });
});
