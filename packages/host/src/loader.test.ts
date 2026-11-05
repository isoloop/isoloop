import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createKernel,
  KernelError,
  type Kernel,
  type KernelConfig,
  type KernelEvents,
} from './index';

// Loader hardening (plan m1-kernel, task 3). Cross-origin loading is an E2E test.

const bootstrap = `${new URL('../../runtime/src/bootstrap.ts', import.meta.url).href}?worker_file&type=module`;
const counter = new URL('./__fixtures__/counter.ts', import.meta.url).href;

const kernels: Kernel[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
});

function kernel(config: Partial<KernelConfig> = {}): Kernel {
  const k = createKernel({ workers: { isolateBootstrap: bootstrap }, ...config });
  kernels.push(k);
  return k;
}

const waitFor = (ok: () => boolean, timeout = 3000) =>
  vi.waitFor(
    () => {
      if (!ok()) throw new Error('not yet');
    },
    { timeout, interval: 10 },
  );

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof KernelError ? err.code : 'not a KernelError';
  }
  return undefined;
};

describe('placement rules (ADR 0001)', () => {
  it('rejects a pool with pools_unsupported', () => {
    const k = kernel();
    expect(codeOf(() => k.spawn({ id: 'A', src: counter, pool: 'light' }))).toBe(
      'pools_unsupported',
    );
    expect(k.isolates()).toEqual([]);
  });

  it('accepts every suspend setting, and rejects a malformed one with invalid_manifest', () => {
    const k = kernel();
    expect(codeOf(() => k.spawn({ id: 'A', src: counter, suspend: 'when-idle' }))).toBeUndefined();
    expect(
      codeOf(() => k.spawn({ id: 'B', src: counter, suspend: { whenIdle: { afterMs: 5 } } })),
    ).toBeUndefined();
    expect(codeOf(() => k.spawn({ id: 'C', src: counter, suspend: 'never' }))).toBeUndefined();
    expect(
      codeOf(() => k.spawn({ id: 'D', src: counter, suspend: { whenIdle: { afterMs: -1 } } })),
    ).toBe('invalid_manifest');
  });

  it('rejects malformed manifests with invalid_manifest', () => {
    const k = kernel();
    expect(codeOf(() => k.spawn({ id: '', src: counter }))).toBe('invalid_manifest');
    expect(codeOf(() => k.spawn({ id: 'A', src: counter, pool: '' }))).toBe('invalid_manifest');
  });

  it('warns once past the worker budget and still starts every isolate', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const k = kernel({ workers: { isolateBootstrap: bootstrap, budget: 2 } });
    const over: KernelEvents['workers:budget'][] = [];
    k.on('workers:budget', (e) => over.push(e));
    for (const id of ['A', 'B', 'C', 'D']) k.spawn({ id, src: counter });
    await waitFor(() => k.isolates().every((s) => s.state === 'running'));
    expect(over).toEqual([{ live: 3, budget: 2 }]);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('spawn failures', () => {
  it('a worker that cannot be created crashes with spawn-failed, then fails at the limit', async () => {
    const k = kernel({
      workers: { isolateBootstrap: 'http://[' },
      supervisor: { maxRestarts: 2, backoff: { initialMs: 5 } },
    });
    const crashes: KernelEvents['isolate:crash'][] = [];
    k.on('isolate:crash', (e) => crashes.push(e));
    const a = k.spawn({ id: 'A', src: counter });
    await waitFor(() => a.snapshot().state === 'failed');
    expect(crashes.map((c) => c.reason)).toEqual(['spawn-failed', 'spawn-failed', 'spawn-failed']);
  });
});

describe('shutdown', () => {
  it('stop sends shutdown and resolves on bye, well inside the grace period', async () => {
    const k = kernel();
    const a = k.spawn({ id: 'A', src: counter });
    await waitFor(() => a.snapshot().state === 'running');
    const t = performance.now();
    await a.stop();
    expect(performance.now() - t).toBeLessThan(500);
    expect(k.isolates()).toEqual([]);
  });

  it('an isolate that never says bye is terminated when the grace period runs out', async () => {
    const k = kernel();
    const a = k.spawn({ id: 'A', src: new URL('./__fixtures__/spin.ts', import.meta.url).href });
    await waitFor(() => a.snapshot().state === 'running');
    // spin.ts stops yielding 300 ms after start.
    await new Promise((r) => setTimeout(r, 400));
    const t = performance.now();
    await a.stop();
    const took = performance.now() - t;
    expect(took).toBeGreaterThanOrEqual(950);
    expect(took).toBeLessThan(1500);
  });
});
