import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernel, type Kernel, type KernelEvents } from '../index';

// isoloop-dom@1 end to end: a real isolate worker, the kernel and the compositor.

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

const waitFor = (ok: () => boolean, timeout = 4000) =>
  vi.waitFor(
    () => {
      if (!ok()) throw new Error('not yet');
    },
    { timeout, interval: 10 },
  );

function spawn(isolateBootstrap: string, src: string) {
  const kernel = createKernel({ workers: { isolateBootstrap } });
  kernels.push(kernel);
  const log = {
    state: [] as KernelEvents['isolate:state'][],
    failed: [] as KernelEvents['isolate:failed'][],
  };
  kernel.on('isolate:state', (e) => log.state.push(e));
  kernel.on('isolate:failed', (e) => log.failed.push(e));
  const target = document.createElement('section');
  document.body.append(target);
  const handle = kernel.spawn({ id: 'A', src, surface: target });
  const shadow = () => target.querySelector('iso-surface')?.shadowRoot ?? null;
  return { handle, log, shadow };
}

describe('isoloop-dom in the kernel', () => {
  it('renders a start(ctx) isolate and round-trips clicks and typing', async () => {
    const { handle, shadow } = spawn(bootstrap, fixture('dom-counter'));
    await waitFor(() => shadow()?.querySelector('.n') !== null);
    expect(handle.snapshot().state).toBe('running');
    const button = shadow()?.querySelector('button');
    button?.click();
    button?.click();
    await waitFor(() => shadow()?.querySelector('.n')?.textContent === '2');

    const input = shadow()?.querySelector('input');
    if (!input) throw new Error('no input');
    input.value = 'hello';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await waitFor(() => shadow()?.querySelector('.echo')?.textContent === 'hello');
    expect(input.value).toBe('hello');
  });

  it('an isolate reporting another renderFmt fails with render-fmt-mismatch and is not restarted', async () => {
    const { handle, log } = spawn(worker('../__fixtures__/bogus-fmt-bootstrap.ts'), 'unused');
    await waitFor(() => handle.snapshot().state === 'failed');
    expect(log.failed).toMatchObject([{ id: 'A', reason: 'render-fmt-mismatch' }]);
    expect(log.failed[0]?.message).toContain('bogus@9');
    // Give a restart time to happen if it were going to.
    await new Promise((r) => setTimeout(r, 400));
    expect(log.state.map((e) => e.state)).toEqual(['loading', 'crashed', 'failed']);
    expect(handle.snapshot().restarts).toBe(0);
  });
});
