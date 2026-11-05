import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernel, type Kernel, type KernelConfig, type KernelEvents } from './index';

// Supervisor wiring against real workers (plan m1-kernel, task 2).

const bootstrap = `${new URL('../../runtime/src/bootstrap.ts', import.meta.url).href}?worker_file&type=module`;
const fixture = (name: string): string =>
  new URL(`./__fixtures__/${name}.ts`, import.meta.url).href;

const kernels: Kernel[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
  document.body.replaceChildren();
  setHidden(undefined);
});

/** Page visibility emulation: `undefined` restores the real `document.hidden`. */
function setHidden(hidden: boolean | undefined): void {
  if (hidden === undefined) {
    Reflect.deleteProperty(document, 'hidden');
    return;
  }
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

type Log = {
  'isolate:state': KernelEvents['isolate:state'][];
  'isolate:crash': KernelEvents['isolate:crash'][];
  'isolate:failed': KernelEvents['isolate:failed'][];
};

function setup(config: Omit<KernelConfig, 'workers'>) {
  const kernel = createKernel({ workers: { isolateBootstrap: bootstrap }, ...config });
  kernels.push(kernel);
  const log: Log = { 'isolate:state': [], 'isolate:crash': [], 'isolate:failed': [] };
  kernel.on('isolate:state', (e) => log['isolate:state'].push(e));
  kernel.on('isolate:crash', (e) => log['isolate:crash'].push(e));
  kernel.on('isolate:failed', (e) => log['isolate:failed'].push(e));
  const spawn = (id: string, src: string, extra: { fallback?: (el: HTMLElement) => void } = {}) => {
    const target = document.createElement('section');
    document.body.append(target);
    const handle = kernel.spawn({ id, src, surface: target, ...extra });
    const shadow = () => target.querySelector('iso-surface')?.shadowRoot ?? null;
    const shell = (cls: string) => shadow()?.querySelector<HTMLElement>(`.${cls}`) ?? null;
    return { handle, shadow, shell };
  };
  return { kernel, log, spawn };
}

const waitFor = (ok: () => boolean, timeout = 4000) =>
  vi.waitFor(
    () => {
      if (!ok()) throw new Error('not yet');
    },
    { timeout, interval: 10 },
  );

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('supervision', () => {
  it('an isolate that loops forever goes blocked, then crashes after killAfterMs', async () => {
    const { log, spawn } = setup({
      heartbeat: { blockedAfterMs: 200, killAfterMs: 600 },
      supervisor: { strategy: 'never' },
    });
    const a = spawn('A', fixture('spin'));
    await waitFor(() => a.handle.snapshot().state === 'blocked');
    expect(a.shell('iso-busy')?.hidden).toBe(false);
    await waitFor(() => a.handle.snapshot().state === 'failed');
    expect(a.shell('iso-busy')?.hidden).toBe(true);
    expect(log['isolate:state'].map((e) => e.state)).toEqual([
      'loading',
      'running',
      'blocked',
      'crashed',
      'failed',
    ]);
    expect(log['isolate:crash']).toMatchObject([{ id: 'A', reason: 'unresponsive' }]);
  });

  it('an isolate that throws in start fails after the restart limit and shows the fallback', async () => {
    const { log, spawn } = setup({
      supervisor: { maxRestarts: 2, backoff: { initialMs: 10 } },
    });
    const a = spawn('A', fixture('throws'));
    await waitFor(() => a.handle.snapshot().state === 'failed');
    expect(log['isolate:crash']).toHaveLength(3);
    expect(log['isolate:failed']).toMatchObject([
      { id: 'A', reason: 'error', message: 'start threw' },
    ]);
    const fallback = a.shell('iso-fallback');
    expect(fallback?.hidden).toBe(false);
    expect(fallback?.textContent).toContain('start threw');

    // Retry respawns with a fresh window: three more crashes before failing again.
    fallback?.querySelector('button')?.click();
    expect(a.shell('iso-fallback')?.hidden).toBe(true);
    await waitFor(() => log['isolate:failed'].length === 2);
    expect(log['isolate:crash']).toHaveLength(6);
  });

  it('the host can render its own fallback', async () => {
    const { spawn } = setup({ supervisor: { strategy: 'never' } });
    const a = spawn('A', fixture('throws'), {
      fallback: (el) => {
        el.textContent = 'custom fallback';
      },
    });
    await waitFor(() => a.handle.snapshot().state === 'failed');
    expect(a.shell('iso-fallback')?.textContent).toBe('custom fallback');
  });

  it('I14: hiding the page for longer than killAfterMs restarts nothing', async () => {
    const counter = fixture('counter');
    const { log, spawn } = setup({ heartbeat: { blockedAfterMs: 100, killAfterMs: 300 } });
    const a = spawn('A', counter);
    const b = spawn('B', counter);
    await waitFor(() => a.handle.snapshot().state === 'running');
    await waitFor(() => b.handle.snapshot().state === 'running');

    setHidden(true);
    // A goes silent for 700 ms, more than twice killAfterMs, while the page is hidden.
    const button = [...(a.shadow()?.querySelectorAll('button') ?? [])].find(
      (el) => el.textContent === 'block',
    );
    button?.click();
    await sleep(900);
    expect(a.handle.snapshot().state).toBe('running');
    expect(a.shell('iso-busy')?.hidden).toBe(true);

    setHidden(false);
    await sleep(400);
    expect(log['isolate:crash']).toEqual([]);
    expect(a.handle.snapshot()).toMatchObject({ state: 'running', restarts: 0 });
    expect(b.handle.snapshot()).toMatchObject({ state: 'running', restarts: 0 });
  });
});
