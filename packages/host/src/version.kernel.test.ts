import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernel, type Kernel, type KernelEvents } from './index';

// ADR 0012 decision 4 end to end: a real bootstrap reports `requires` in
// ready, and the kernel checks it against `[FLOOR, VERSION]`, here 0.3 to 0.5.
vi.mock('./version', async (orig) => {
  const real = await orig<typeof import('./version')>();
  const range = { floor: '0.3', version: '0.5' };
  return {
    ...real,
    FLOOR: range.floor,
    VERSION: range.version,
    checkRequires: (r: string | undefined) => real.checkRequires(r, range),
  };
});

const bootstrap = `${new URL('../../runtime/src/bootstrap.ts', import.meta.url).href}?worker_file&type=module`;
const fixture = (name: string): string =>
  new URL(`./__fixtures__/${name}.ts`, import.meta.url).href;

const kernels: Kernel[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
  document.body.replaceChildren();
});

const waitFor = (ok: () => boolean, timeout = 4000) =>
  vi.waitFor(
    () => {
      if (!ok()) throw new Error('not yet');
    },
    { timeout, interval: 10 },
  );

function spawn(src: string) {
  const kernel = createKernel({ workers: { isolateBootstrap: bootstrap } });
  kernels.push(kernel);
  const failed: KernelEvents['isolate:failed'][] = [];
  const states: string[] = [];
  kernel.on('isolate:failed', (e) => failed.push(e));
  kernel.on('isolate:state', (e) => states.push(e.state));
  const surface = document.createElement('section');
  document.body.append(surface);
  const handle = kernel.spawn({ id: 'V', src, surface });
  const text = () => surface.querySelector('iso-surface')?.shadowRoot?.textContent ?? '';
  return { handle, failed, states, text };
}

describe('the [FLOOR, VERSION] check (ADR 0012)', () => {
  it('runs an isolate stamped inside the range', async () => {
    const { handle, text } = spawn(fixture('stamped-0-4'));
    await waitFor(() => handle.snapshot().state === 'running');
    await waitFor(() => text().includes('built for 0.4'));
  });

  it.each([
    ['stamped-0-6', 'runtime-too-old', 'built for 0.6, this host runs 0.3 to 0.5'],
    ['stamped-0-2', 'isolate-too-old', 'built for 0.2, this host runs 0.3 to 0.5'],
  ])('%s fails with %s, final', async (name, reason, message) => {
    const { handle, failed, states } = spawn(fixture(name));
    await waitFor(() => handle.snapshot().state === 'failed');
    expect(failed).toMatchObject([{ id: 'V', reason }]);
    expect(failed[0]?.message).toContain(message);
    await new Promise((r) => setTimeout(r, 400));
    expect(states).toEqual(['loading', 'crashed', 'failed']);
    expect(handle.snapshot().restarts).toBe(0);
  });

  it('runs an unstamped { start } isolate', async () => {
    const { handle } = spawn(fixture('dom-counter'));
    await waitFor(() => handle.snapshot().state === 'running');
  });
});
