// Memory per isolate (ADR 0020, decision 4): reading the browser's report,
// the feed's measurement loop, and the kernel's attribution to own workers
// and pools. The browser's real measurement needs a cross-origin isolated
// page in full Chromium; that's the E2E (e2e/memory.spec.ts). Here the
// measurement is stubbed with a report built from the workers the kernel
// started.
import { INSPECT_MEMORY_MS, type InspectMessage } from '@isoloop/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInspectFeed, type InspectSources } from './inspect';
import { createKernel, type Kernel } from './index';
import { workerUrl } from './loader';
import { bytesByWorkerUrl, memoryByIsolate, memoryMeasure } from './memory';

const bootstrap = `${new URL('../../runtime/src/bootstrap.ts', import.meta.url).href}?worker_file&type=module`;
const counter = new URL('./__fixtures__/counter.ts', import.meta.url).href;

const worker = (url: string, bytes: number) => ({
  bytes,
  attribution: [{ url, scope: 'DedicatedWorkerGlobalScope' }],
});

describe('reading the report', () => {
  it('sums the bytes of each worker URL and ignores the page and shared entries', () => {
    const report = {
      bytes: 0,
      breakdown: [
        worker('https://a/w.js#isoloop-worker=1', 100),
        worker('https://a/w.js#isoloop-worker=1', 20),
        worker('https://a/w.js#isoloop-worker=2', 300),
        { bytes: 999, attribution: [{ url: 'https://a/', scope: 'Window' }] },
        {
          bytes: 50,
          attribution: [
            { url: 'https://a/w.js#isoloop-worker=1', scope: 'DedicatedWorkerGlobalScope' },
            { url: 'https://a/w.js#isoloop-worker=2', scope: 'DedicatedWorkerGlobalScope' },
          ],
        },
        { bytes: 7, attribution: [] },
      ],
    };
    expect(Object.fromEntries(bytesByWorkerUrl(report))).toEqual({
      'https://a/w.js#isoloop-worker=1': 120,
      'https://a/w.js#isoloop-worker=2': 300,
    });
  });

  it('gives nothing for a report it can’t read', () => {
    for (const r of [undefined, null, 1, {}, { breakdown: 'x' }, { breakdown: [{ bytes: '1' }] }])
      expect(bytesByWorkerUrl(r).size).toBe(0);
  });

  it('gives an own worker’s bytes to its isolate and a pool’s to every member, shared', () => {
    const report = { breakdown: [worker('u1', 10), worker('u2', 40)] };
    const m = memoryByIsolate(
      report,
      [
        { url: 'u1', ids: ['a'], pool: false },
        { url: 'u2', ids: ['p1', 'p2'], pool: true },
        { url: 'u3', ids: ['missing'], pool: false },
      ],
      5,
    );
    expect(Object.fromEntries(m)).toEqual({
      a: { bytes: 10, at: 5 },
      p1: { bytes: 40, at: 5, shared: true },
      p2: { bytes: 40, at: 5, shared: true },
    });
  });

  it('gives every worker a URL of its own, keeping a fragment already there', () => {
    const a = workerUrl('https://a/w.js');
    const b = workerUrl('https://a/w.js');
    expect(a).not.toBe(b);
    expect(a.startsWith('https://a/w.js#isoloop-worker=')).toBe(true);
    expect(workerUrl('https://a/w.js#x').startsWith('https://a/w.js#x&isoloop-worker=')).toBe(true);
  });

  it('has no measurement on a page that isn’t cross-origin isolated', () => {
    // The test page sends no COOP/COEP.
    expect(crossOriginIsolated).toBe(false);
    expect(memoryMeasure()).toBeUndefined();
  });
});

const sources = (measure: () => Promise<unknown>): InspectSources => ({
  isolates: () => [{ id: 'a', state: 'running', lastBeatAt: 0, lagMs: 0, restarts: 0, dropped: 0 }],
  pools: () => [],
  busState: () => 'none',
  tap: () => () => {},
  read: () => Promise.resolve({ ok: true, value: [] }),
  control: () => {},
  workers: () => [{ url: 'u1', ids: ['a'], pool: false }],
  measure,
});

describe('the feed’s measurement loop', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('measures nothing until a reader listens, then at most every 5 s', async () => {
    vi.useFakeTimers();
    const measure = vi.fn(() => Promise.resolve({ breakdown: [worker('u1', 1234)] }));
    const feed = createInspectFeed(sources(measure));
    const inspector = feed.open();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(measure).not.toHaveBeenCalled();
    expect(inspector.snapshot().isolates[0]?.memory).toBeUndefined();

    const got: InspectMessage[] = [];
    const off = inspector.on((m) => got.push(m));
    await vi.advanceTimersByTimeAsync(0);
    expect(measure).toHaveBeenCalledTimes(1);
    const memory = got.filter((m) => m.t === 'memory');
    expect(memory).toHaveLength(1);
    const first = memory[0]?.p.isolates;
    expect(first).toHaveLength(1);
    expect(first?.[0]?.id).toBe('a');
    expect(first?.[0]?.memory.bytes).toBe(1234);
    expect(first?.[0]?.memory.shared).toBeUndefined();
    expect(inspector.snapshot().isolates[0]?.memory?.bytes).toBe(1234);

    await vi.advanceTimersByTimeAsync(INSPECT_MEMORY_MS - 100);
    expect(measure).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(measure).toHaveBeenCalledTimes(2);

    off();
    await vi.advanceTimersByTimeAsync(INSPECT_MEMORY_MS * 3);
    expect(measure).toHaveBeenCalledTimes(2);
    // The last figure stays readable.
    expect(inspector.snapshot().isolates[0]?.memory?.bytes).toBe(1234);
    feed.destroy();
  });

  it('never overlaps measurements, however slow the browser answers', async () => {
    vi.useFakeTimers();
    let answer: ((r: unknown) => void) | undefined;
    const measure = vi.fn(
      () =>
        new Promise<unknown>((done) => {
          answer = done;
        }),
    );
    const feed = createInspectFeed(sources(measure));
    feed.open().on(() => {});
    await vi.advanceTimersByTimeAsync(15_000);
    expect(measure).toHaveBeenCalledTimes(1);
    answer?.({ breakdown: [] });
    // It took longer than 5 s, so the next one starts at once.
    await vi.advanceTimersByTimeAsync(0);
    expect(measure).toHaveBeenCalledTimes(2);
    feed.destroy();
  });

  it('stops measuring for good once a measurement fails', async () => {
    vi.useFakeTimers();
    const measure = vi.fn(() => Promise.reject(new DOMException('no', 'SecurityError')));
    const feed = createInspectFeed(sources(measure));
    const inspector = feed.open();
    const off = inspector.on(() => {});
    await vi.advanceTimersByTimeAsync(INSPECT_MEMORY_MS * 3);
    off();
    inspector.on(() => {});
    await vi.advanceTimersByTimeAsync(INSPECT_MEMORY_MS * 3);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(inspector.snapshot().isolates[0]?.memory).toBeUndefined();
    feed.destroy();
  });
});

describe('the kernel’s attribution', () => {
  const kernels: Kernel[] = [];
  afterEach(async () => {
    await Promise.all(kernels.splice(0).map((k) => k.destroy()));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('gives own isolates their worker’s figure and pool members the pool’s, shared', async () => {
    // Every worker the kernel starts, by URL, and a stubbed measurement that
    // reports a different size for each.
    const urls: string[] = [];
    const Real = Worker;
    vi.stubGlobal(
      'Worker',
      class extends Real {
        constructor(url: string | URL, o?: WorkerOptions) {
          super(url, o);
          urls.push(String(url));
        }
      },
    );
    vi.stubGlobal('crossOriginIsolated', true);
    const measure = vi.fn(() =>
      Promise.resolve({ breakdown: urls.map((u, i) => worker(u, (i + 1) * 1000)) }),
    );
    Object.defineProperty(performance, 'measureUserAgentSpecificMemory', {
      value: measure,
      configurable: true,
    });
    try {
      const k = createKernel({ workers: { isolateBootstrap: bootstrap } });
      kernels.push(k);
      k.spawn({ id: 'o1', src: counter });
      k.spawn({ id: 'o2', src: counter });
      k.spawn({ id: 'p1', src: counter, pool: 'p' });
      k.spawn({ id: 'p2', src: counter, pool: 'p' });
      await vi.waitFor(() => {
        if (!k.isolates().every((i) => i.state === 'running')) throw new Error('not yet');
      });
      expect(new Set(urls).size).toBe(3);

      const inspector = k.inspect();
      const got: InspectMessage[] = [];
      inspector.on((m) => got.push(m));
      await vi.waitFor(() => {
        if (!got.some((m) => m.t === 'memory')) throw new Error('not yet');
      });
      const byId = Object.fromEntries(inspector.snapshot().isolates.map((i) => [i.id, i.memory]));
      expect(byId['o1']?.bytes).not.toBe(byId['o2']?.bytes);
      expect(byId['o1']?.shared).toBeUndefined();
      expect(byId['p1']).toEqual({ ...byId['p2'], at: byId['p1']?.at });
      expect(byId['p1']?.shared).toBe(true);
      inspector.close();
    } finally {
      Reflect.deleteProperty(performance, 'measureUserAgentSpecificMemory');
    }
  });

  it('shows no memory where the page can’t be measured', async () => {
    const k = createKernel({ workers: { isolateBootstrap: bootstrap } });
    kernels.push(k);
    k.spawn({ id: 'a', src: counter });
    const inspector = k.inspect();
    inspector.on(() => {});
    await vi.waitFor(() => {
      if (k.isolates()[0]?.state !== 'running') throw new Error('not yet');
    });
    expect(inspector.snapshot().isolates[0]?.memory).toBeUndefined();
    inspector.close();
  });
});
