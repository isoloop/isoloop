import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernel, type Kernel, type KernelEvents } from './index';

// The bootstrap is loaded by URL, as in production: host never imports runtime.
// `?worker_file&type=module` makes Vite serve it as a worker entry; otherwise
// Vitest's browser runner rewrites its dynamic import() for the page.
const bootstrap = `${new URL('../../runtime/src/bootstrap.ts', import.meta.url).href}?worker_file&type=module`;
const counter = new URL('./__fixtures__/counter.ts', import.meta.url).href;

const kernels: Kernel[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
  document.body.replaceChildren();
});

function setup(o: { backoffMs?: number } = {}) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync('.n { color: rgb(1, 2, 3); }');
  const kernel = createKernel({
    workers: { isolateBootstrap: bootstrap },
    supervisor: { backoff: { initialMs: o.backoffMs ?? 200 } },
    styles: [sheet],
  });
  kernels.push(kernel);
  const events: { [E in keyof KernelEvents]: KernelEvents[E][] } = {
    'isolate:state': [],
    'isolate:ready': [],
    'isolate:crash': [],
    'isolate:failed': [],
    'isolate:error': [],
    'bus:publish': [],
  };
  kernel.on('isolate:state', (e) => {
    events['isolate:state'].push(e);
  });
  kernel.on('isolate:crash', (e) => {
    events['isolate:crash'].push(e);
  });
  kernel.on('isolate:error', (e) => {
    events['isolate:error'].push(e);
  });
  kernel.on('bus:publish', (e) => {
    events['bus:publish'].push(e);
  });
  const spawn = (id: string) => {
    const target = document.createElement('section');
    document.body.append(target);
    const handle = kernel.spawn({ id, src: counter, surface: target });
    const shadow = () => target.querySelector('iso-surface')?.shadowRoot ?? null;
    const q = (sel: string) => shadow()?.querySelector(sel) ?? null;
    const text = () => q('.n')?.textContent ?? null;
    const click = (label: string) => {
      const button = [...(shadow()?.querySelectorAll('button') ?? [])].find(
        (b) => b.textContent === label,
      );
      if (!button) throw new Error(`no button ${label}`);
      button.click();
    };
    return { handle, target, shadow, q, text, click };
  };
  return { kernel, events, spawn };
}

const waitFor = (ok: () => boolean, timeout = 3000) =>
  vi.waitFor(
    () => {
      if (!ok()) throw new Error('not yet');
    },
    { timeout, interval: 10 },
  );

describe('kernel', () => {
  it('spawns an isolate into a shadow surface with the kernel styles', async () => {
    const { spawn } = setup();
    const a = spawn('A');
    await waitFor(() => a.text() === '0');
    expect(a.target.querySelector('iso-surface')?.getAttribute('data-isolate-id')).toBe('A');
    const n = a.q('.n');
    expect(n && getComputedStyle(n).color).toBe('rgb(1, 2, 3)');
    await waitFor(() => a.handle.snapshot().state === 'running');
  });

  it('delivers a click to the isolate and applies the patch', async () => {
    const { spawn } = setup();
    const a = spawn('A');
    await waitFor(() => a.text() === '0');
    a.click('inc');
    await waitFor(() => a.text() === '1');
    expect(a.handle.snapshot().surface?.rejected).toBe(0);
  });

  it('routes the main-thread bus to other subscribers only', async () => {
    const { spawn, events } = setup();
    const a = spawn('A');
    const b = spawn('B');
    await waitFor(() => a.text() === '0' && b.text() === '0');
    a.click('inc');
    // B receives A's count; A doesn't receive its own.
    await waitFor(() => b.text() === '100');
    expect(a.text()).toBe('1');
    await waitFor(() => events['bus:publish'].some((d) => d.topic === 'seen'));
    expect(events['bus:publish'][0]).toEqual({
      from: 'A',
      topic: 'count',
      value: 1,
      targets: ['B'],
    });
  });

  it('stop removes the surface and the isolate', async () => {
    const { kernel, spawn } = setup();
    const a = spawn('A');
    await waitFor(() => a.text() === '0');
    await a.handle.stop();
    expect(a.target.querySelector('iso-surface')).toBeNull();
    expect(kernel.isolates()).toEqual([]);
  });

  it('restarts a crashed isolate after the backoff and counts it', async () => {
    const { spawn, events } = setup({ backoffMs: 200 });
    const a = spawn('A');
    await waitFor(() => a.text() === '0');
    a.click('inc');
    await waitFor(() => a.text() === '1');
    a.click('crash');
    await waitFor(() => a.handle.snapshot().state === 'restarting');
    expect(a.handle.snapshot()).toMatchObject({ reason: 'worker-error', restarts: 1 });
    expect(a.handle.snapshot().error).toContain('fixture crash');
    expect(events['isolate:crash']).toMatchObject([{ id: 'A', reason: 'worker-error' }]);
    await waitFor(() => a.handle.snapshot().state === 'running');
    // Fresh state after the restart, same surface.
    await waitFor(() => a.text() === '0');
    expect(a.handle.snapshot().restarts).toBe(1);
    expect(a.target.querySelectorAll('iso-surface')).toHaveLength(1);
  });

  it('shows a blocked isolate as blocked, then running again', async () => {
    const { spawn, events } = setup();
    const a = spawn('A');
    await waitFor(() => a.text() === '0' && a.handle.snapshot().state === 'running');
    a.click('block');
    await waitFor(() => a.handle.snapshot().state === 'blocked');
    await waitFor(() => a.handle.snapshot().state === 'running');
    const states = events['isolate:state'].map((e) => e.state);
    expect(states).toEqual(['loading', 'running', 'blocked', 'running']);
  });

  it('a manual restart is not counted', async () => {
    const { spawn } = setup();
    const a = spawn('A');
    await waitFor(() => a.text() === '0');
    a.click('inc');
    await waitFor(() => a.text() === '1');
    await a.handle.restart();
    await waitFor(() => a.text() === '0' && a.handle.snapshot().state === 'running');
    expect(a.handle.snapshot().restarts).toBe(0);
  });
});
